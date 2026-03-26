"""
SSE Subscription Demo — Python

A self-contained demo that runs both an SSE server and client in the same
process to illustrate the MCP Subscribe/Notify extension over Server-Sent
Events (SSE).

This is a reference implementation, not production code.
No external dependencies required (stdlib only: asyncio, json, uuid).

Usage:
    python sse_subscription_demo.py
"""

# SECURITY WARNING:
# The subscription_id acts as a bearer token — anyone who knows it can
# connect to the SSE stream and receive events. In production, SSE
# connections MUST be authenticated independently (e.g., via an
# Authorization header or short-lived token) rather than relying on
# subscription_id secrecy alone.

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any

# =============================================================================
# Server State
# =============================================================================

subscriptions: dict[str, dict[str, Any]] = {}
# subscription_id -> { "events": [...], "filter": {...}, "writer": StreamWriter | None, "closed": bool }


# =============================================================================
# HTTP Parsing Helpers (minimal, demo-only)
# =============================================================================

async def read_http_request(reader: asyncio.StreamReader) -> tuple[str, str, dict[str, str], str]:
    """Read a raw HTTP request. Returns (method, path, headers, body)."""
    # Read headers
    raw_headers = b""
    while True:
        line = await reader.readline()
        raw_headers += line
        if line == b"\r\n" or line == b"":
            break

    header_text = raw_headers.decode("utf-8")
    lines = header_text.strip().split("\r\n")
    if not lines:
        return "", "", {}, ""

    # Request line
    parts = lines[0].split(" ", 2)
    method = parts[0] if len(parts) > 0 else ""
    path = parts[1] if len(parts) > 1 else ""

    # Headers
    headers: dict[str, str] = {}
    for h in lines[1:]:
        if ":" in h:
            key, val = h.split(":", 1)
            headers[key.strip().lower()] = val.strip()

    # Body
    body = ""
    content_length = int(headers.get("content-length", "0"))
    if content_length > 0:
        body_bytes = await reader.readexactly(content_length)
        body = body_bytes.decode("utf-8")

    return method, path, headers, body


def http_response(status: int, status_text: str, body: str, content_type: str = "application/json") -> bytes:
    """Build a raw HTTP response."""
    body_bytes = body.encode("utf-8")
    return (
        f"HTTP/1.1 {status} {status_text}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        f"\r\n"
    ).encode("utf-8") + body_bytes


def sse_headers() -> bytes:
    """Build SSE response headers (no Content-Length — streamed)."""
    return (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n"
        "\r\n"
    ).encode("utf-8")


# =============================================================================
# Demo Event Data
# =============================================================================

def demo_events(subscription_id: str) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "jsonrpc": "2.0",
            "method": "notifications/event",
            "params": {
                "subscription_id": subscription_id,
                "event_type": "commit_to_main",
                "timestamp": now,
                "payload": {"commit_sha": "abc123", "author": "alice", "message": "fix: resolve login race condition"},
            },
        },
        {
            "jsonrpc": "2.0",
            "method": "notifications/event",
            "params": {
                "subscription_id": subscription_id,
                "event_type": "pr_review_requested",
                "timestamp": now,
                "payload": {"pr_number": 42, "title": "Add dark mode support", "reviewer": "bob"},
            },
        },
        {
            "jsonrpc": "2.0",
            "method": "notifications/event",
            "params": {
                "subscription_id": subscription_id,
                "event_type": "commit_to_main",
                "timestamp": now,
                "payload": {"commit_sha": "def456", "author": "carol", "message": "feat: add retry logic"},
            },
        },
    ]


# =============================================================================
# Server
# =============================================================================

async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Handle one HTTP request per connection."""
    try:
        method, path, headers, body = await read_http_request(reader)

        # POST /subscribe
        if method == "POST" and path == "/subscribe":
            data = json.loads(body) if body else {}
            sub_id = str(uuid.uuid4())
            subscriptions[sub_id] = {
                "events": data.get("events", []),
                "filter": data.get("filter", {}),
                "writer": None,
                "closed": False,
            }
            resp = http_response(200, "OK", json.dumps({
                "subscription_id": sub_id,
                "status": "active",
                "supported_events": ["commit_to_main", "pr_review_requested", "issue_updated"],
            }))
            writer.write(resp)
            await writer.drain()
            writer.close()
            await writer.wait_closed()
            return

        # GET /events/:subscription_id
        if method == "GET" and path.startswith("/events/"):
            sub_id = path[len("/events/"):]
            sub = subscriptions.get(sub_id)
            if not sub:
                resp = http_response(404, "Not Found", json.dumps({"error": "subscription not found"}))
                writer.write(resp)
                await writer.drain()
                writer.close()
                await writer.wait_closed()
                return

            # Start SSE stream
            writer.write(sse_headers())
            await writer.drain()
            sub["writer"] = writer

            # Keep connection open until subscription is closed
            try:
                while not sub["closed"]:
                    await asyncio.sleep(0.05)
            except (asyncio.CancelledError, ConnectionError):
                pass
            finally:
                if not writer.is_closing():
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass
            return

        # POST /unsubscribe
        if method == "POST" and path == "/unsubscribe":
            data = json.loads(body) if body else {}
            sub_id = data.get("subscription_id", "")
            sub = subscriptions.get(sub_id)
            if not sub:
                resp = http_response(404, "Not Found", json.dumps({"error": "subscription not found"}))
                writer.write(resp)
                await writer.drain()
                writer.close()
                await writer.wait_closed()
                return

            sub["closed"] = True
            sse_writer = sub.get("writer")
            if sse_writer and not sse_writer.is_closing():
                sse_writer.close()
            del subscriptions[sub_id]

            resp = http_response(200, "OK", json.dumps({"status": "cancelled"}))
            writer.write(resp)
            await writer.drain()
            writer.close()
            await writer.wait_closed()
            return

        # Fallback
        resp = http_response(404, "Not Found", json.dumps({"error": "not found"}))
        writer.write(resp)
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    except Exception as exc:
        if not writer.is_closing():
            writer.close()


# =============================================================================
# Client Helpers
# =============================================================================

async def http_client_request(port: int, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    """Send an HTTP request and return (status_code, response_body)."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)

    payload = json.dumps(body).encode("utf-8") if body else b""
    request_lines = [
        f"{method} {path} HTTP/1.1",
        f"Host: 127.0.0.1:{port}",
    ]
    if payload:
        request_lines.append("Content-Type: application/json")
        request_lines.append(f"Content-Length: {len(payload)}")
    request_lines.append("")
    request_lines.append("")

    raw_request = "\r\n".join(request_lines).encode("utf-8")
    if payload:
        # Replace the last \r\n with payload
        raw_request = raw_request + payload

    writer.write(raw_request)
    await writer.drain()

    # Read response headers
    raw_headers = b""
    while True:
        line = await reader.readline()
        raw_headers += line
        if line == b"\r\n" or line == b"":
            break

    header_text = raw_headers.decode("utf-8")
    lines = header_text.strip().split("\r\n")
    status_code = int(lines[0].split(" ", 2)[1]) if lines else 0

    headers: dict[str, str] = {}
    for h in lines[1:]:
        if ":" in h:
            key, val = h.split(":", 1)
            headers[key.strip().lower()] = val.strip()

    resp_body = ""
    cl = int(headers.get("content-length", "0"))
    if cl > 0:
        resp_bytes = await reader.readexactly(cl)
        resp_body = resp_bytes.decode("utf-8")

    writer.close()
    await writer.wait_closed()
    return status_code, resp_body


async def sse_client_connect(port: int, path: str) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Open an SSE connection, consume response headers, return reader/writer."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)

    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        f"\r\n"
    ).encode("utf-8")
    writer.write(request)
    await writer.drain()

    # Read response headers
    while True:
        line = await reader.readline()
        if line == b"\r\n" or line == b"":
            break

    return reader, writer


async def read_sse_events(reader: asyncio.StreamReader, count: int) -> list[dict[str, Any]]:
    """Read `count` SSE events from the stream."""
    events: list[dict[str, Any]] = []
    buffer = ""

    while len(events) < count:
        chunk = await reader.read(4096)
        if not chunk:
            break
        buffer += chunk.decode("utf-8")

        while "\n\n" in buffer:
            message, buffer = buffer.split("\n\n", 1)
            for line in message.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: "):]))

    return events


# =============================================================================
# Main Demo
# =============================================================================

async def main() -> None:
    # Start server on random port
    srv = await asyncio.start_server(handle_client, "127.0.0.1", 0)
    port = srv.sockets[0].getsockname()[1]

    print("=== SSE Subscription Demo ===")
    print(f"  Server listening on 127.0.0.1:{port}")
    print()

    # --- Subscribe ---
    print("--- Subscribe ---")
    status, resp_body = await http_client_request(port, "POST", "/subscribe", {
        "events": ["commit_to_main", "pr_review_requested"],
        "filter": {"repo": "example/project"},
    })
    sub_data = json.loads(resp_body)
    subscription_id = sub_data["subscription_id"]
    print(f"  Subscription ID: {subscription_id}")
    print(f"  Status: {sub_data['status']}")
    print()

    # --- Connect SSE Stream ---
    print("--- SSE Stream ---")
    sse_reader, sse_writer = await sse_client_connect(port, f"/events/{subscription_id}")

    # Wait for SSE connection to be established
    await asyncio.sleep(0.05)

    # Server emits 3 events at 100ms intervals
    sub = subscriptions[subscription_id]
    notifications = demo_events(subscription_id)
    for notification in notifications:
        await asyncio.sleep(0.1)
        sse_w = sub["writer"]
        data_line = f"data: {json.dumps(notification)}\n\n"
        sse_w.write(data_line.encode("utf-8"))
        await sse_w.drain()

    # Small delay to let client receive all events
    await asyncio.sleep(0.05)

    # Read events from client side
    received_events = await read_sse_events(sse_reader, 3)

    for i, evt in enumerate(received_events):
        params = evt["params"]
        print(f"  Event {i + 1}: {params['event_type']} - {json.dumps(params['payload'])}")
    print()

    # --- Unsubscribe ---
    print("--- Unsubscribe ---")
    status, resp_body = await http_client_request(port, "POST", "/unsubscribe", {
        "subscription_id": subscription_id,
    })
    unsub_data = json.loads(resp_body)
    print("  Subscription cancelled")
    print()

    # Close SSE client connection
    sse_writer.close()
    try:
        await sse_writer.wait_closed()
    except Exception:
        pass

    # Verify
    if len(received_events) != 3:
        print(f"  ERROR: Expected 3 events, got {len(received_events)}")
        srv.close()
        await srv.wait_closed()
        raise SystemExit(1)

    if unsub_data.get("status") != "cancelled":
        print(f"  ERROR: Expected cancelled status, got {unsub_data.get('status')}")
        srv.close()
        await srv.wait_closed()
        raise SystemExit(1)

    # Shutdown
    srv.close()
    await srv.wait_closed()
    print("=== Demo complete ===")


if __name__ == "__main__":
    asyncio.run(main())
