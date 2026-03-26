"""
Data Reference Demo -- Self-contained signed-URL data transfer

Runs Server A (data source), Server B (data consumer), and a client
all in the same process to demonstrate zero-copy-through-client
data references with HMAC-signed URLs.

Usage:  python data_reference_demo.py

Stdlib only: asyncio, json, uuid, hmac, hashlib, time, sys, urllib.parse
"""

import asyncio
import json
import uuid
import hmac
import hashlib
import time
import sys
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# SECURITY WARNING: This secret is hard-coded for demo purposes only.
# In production, use a securely generated secret stored in a secrets manager.
# ---------------------------------------------------------------------------
SIGNING_SECRET = b"demo-secret-do-not-use-in-production"

# ---------------------------------------------------------------------------
# Mock clock for TTL test
# ---------------------------------------------------------------------------
_time_offset = 0


def get_time() -> float:
    """Return current time in seconds, adjustable via _time_offset."""
    return time.time() + _time_offset


# ---------------------------------------------------------------------------
# Ticket dataset
# ---------------------------------------------------------------------------
TICKETS = [
    {"id": "TICKET-1", "title": "Fix login bug", "status": "open", "priority": "high"},
    {"id": "TICKET-2", "title": "Add dark mode", "status": "in-progress", "priority": "medium"},
]

# ---------------------------------------------------------------------------
# HMAC helpers
# ---------------------------------------------------------------------------


def sign_url(ref_id: str, exp_timestamp: str) -> str:
    msg = (ref_id + exp_timestamp).encode()
    return hmac.new(SIGNING_SECRET, msg, hashlib.sha256).hexdigest()


def verify_signature(ref_id: str, sig: str, exp: str) -> bool:
    try:
        expires_ms = int(exp)
    except ValueError:
        return False
    now_ms = int(get_time() * 1000)
    if now_ms > expires_ms:
        return False
    expected = sign_url(ref_id, exp)
    return hmac.compare_digest(sig, expected)


# ---------------------------------------------------------------------------
# In-memory data store for Server A
# ---------------------------------------------------------------------------
stored_data: dict[str, bytes] = {}

# Server ports (filled at runtime)
port_a: int = 0
port_b: int = 0

# ---------------------------------------------------------------------------
# Minimal HTTP parsing helpers
# ---------------------------------------------------------------------------


def parse_request_line(data: bytes):
    """Return (method, path, headers_dict, body) from raw HTTP request bytes."""
    header_end = data.find(b"\r\n\r\n")
    if header_end == -1:
        header_end = len(data)
        body = b""
    else:
        body = data[header_end + 4:]

    header_section = data[:header_end].decode("utf-8", errors="replace")
    lines = header_section.split("\r\n")
    request_line = lines[0]
    parts = request_line.split(" ", 2)
    method = parts[0]
    path = parts[1] if len(parts) > 1 else "/"
    headers = {}
    for line in lines[1:]:
        if ": " in line:
            k, v = line.split(": ", 1)
            headers[k.lower()] = v
    return method, path, headers, body


def http_response(status: int, status_text: str, body: str, content_type: str = "application/json") -> bytes:
    body_bytes = body.encode("utf-8")
    header = (
        f"HTTP/1.1 {status} {status_text}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        f"Connection: close\r\n"
        f"\r\n"
    )
    return header.encode("utf-8") + body_bytes


# ---------------------------------------------------------------------------
# Server A — data source
# ---------------------------------------------------------------------------


async def handle_server_a(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
    except asyncio.TimeoutError:
        writer.close()
        return

    method, path, headers, body = parse_request_line(data)

    # POST /export
    if method == "POST" and path == "/export":
        ref_id = f"ref-{uuid.uuid4()}"
        payload = json.dumps(TICKETS).encode("utf-8")
        stored_data[ref_id] = payload

        ttl_ms = 5000
        now_ms = int(get_time() * 1000)
        exp_timestamp = str(now_ms + ttl_ms)
        sig = sign_url(ref_id, exp_timestamp)
        checksum = hashlib.sha256(payload).hexdigest()

        from datetime import datetime, timezone
        expires_at = datetime.fromtimestamp((now_ms + ttl_ms) / 1000, tz=timezone.utc).isoformat()

        data_ref = {
            "ref_id": ref_id,
            "origin_server": "project-tracker",
            "mime_type": "application/json",
            "size_bytes": len(payload),
            "expires_at": expires_at,
            "access_url": f"http://localhost:{port_a}/data/{ref_id}?sig={sig}&exp={exp_timestamp}",
            "checksum": {"algorithm": "sha256", "value": checksum},
        }

        writer.write(http_response(200, "OK", json.dumps(data_ref)))
        await writer.drain()
        writer.close()
        return

    # POST /export-short-ttl — immediately expired
    if method == "POST" and path == "/export-short-ttl":
        ref_id = f"ref-{uuid.uuid4()}"
        payload = json.dumps(TICKETS).encode("utf-8")
        stored_data[ref_id] = payload

        now_ms = int(get_time() * 1000)
        exp_timestamp = str(now_ms - 1000)  # expired 1 second ago
        sig = sign_url(ref_id, exp_timestamp)
        checksum = hashlib.sha256(payload).hexdigest()

        from datetime import datetime, timezone
        expires_at = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).isoformat()

        data_ref = {
            "ref_id": ref_id,
            "origin_server": "project-tracker",
            "mime_type": "application/json",
            "size_bytes": len(payload),
            "expires_at": expires_at,
            "access_url": f"http://localhost:{port_a}/data/{ref_id}?sig={sig}&exp={exp_timestamp}",
            "checksum": {"algorithm": "sha256", "value": checksum},
        }

        writer.write(http_response(200, "OK", json.dumps(data_ref)))
        await writer.drain()
        writer.close()
        return

    # GET /data/<ref_id>?sig=...&exp=...
    if method == "GET" and path.startswith("/data/"):
        question_mark = path.find("?")
        if question_mark != -1:
            ref_id = path[6:question_mark]
            qs = parse_qs(path[question_mark + 1:])
        else:
            ref_id = path[6:]
            qs = {}

        sig = qs.get("sig", [""])[0]
        exp = qs.get("exp", [""])[0]

        if not verify_signature(ref_id, sig, exp):
            writer.write(http_response(403, "Forbidden", "403 Forbidden", "text/plain"))
            await writer.drain()
            writer.close()
            return

        payload = stored_data.get(ref_id)
        if payload is None:
            writer.write(http_response(404, "Not Found", "404 Not Found", "text/plain"))
            await writer.drain()
            writer.close()
            return

        writer.write(http_response(200, "OK", payload.decode("utf-8")))
        await writer.drain()
        writer.close()
        return

    writer.write(http_response(404, "Not Found", "Not Found", "text/plain"))
    await writer.drain()
    writer.close()


# ---------------------------------------------------------------------------
# Server B — data consumer
# ---------------------------------------------------------------------------


async def handle_server_b(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
    except asyncio.TimeoutError:
        writer.close()
        return

    method, path, headers, body = parse_request_line(data)

    if method == "POST" and path == "/import":
        data_ref = json.loads(body.decode("utf-8"))
        access_url = data_ref["access_url"]

        # Fetch from Server A
        fetch_status, fetch_body = await http_get(access_url)
        if fetch_status != 200:
            result = {"status": "failed", "error": fetch_body}
            writer.write(http_response(502, "Bad Gateway", json.dumps(result)))
            await writer.drain()
            writer.close()
            return

        records = json.loads(fetch_body)
        checksum = hashlib.sha256(fetch_body.encode("utf-8")).hexdigest()
        checksum_ok = checksum == data_ref.get("checksum", {}).get("value", "")

        result = {
            "status": "imported",
            "rows_imported": len(records),
            "checksum_verified": checksum_ok,
        }
        writer.write(http_response(200, "OK", json.dumps(result)))
        await writer.drain()
        writer.close()
        return

    writer.write(http_response(404, "Not Found", "Not Found", "text/plain"))
    await writer.drain()
    writer.close()


# ---------------------------------------------------------------------------
# HTTP client helpers (raw asyncio sockets)
# ---------------------------------------------------------------------------


async def http_request(method: str, url: str, body: str = "") -> tuple[int, str]:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    req_port = parsed.port or 80
    path = parsed.path
    if parsed.query:
        path += "?" + parsed.query

    reader, writer = await asyncio.open_connection(host, req_port)

    body_bytes = body.encode("utf-8")
    request_lines = [
        f"{method} {path} HTTP/1.1",
        f"Host: {host}:{req_port}",
        f"Content-Type: application/json",
        f"Content-Length: {len(body_bytes)}",
        "Connection: close",
        "",
        "",
    ]
    writer.write("\r\n".join(request_lines).encode("utf-8") + body_bytes)
    await writer.drain()

    response_data = await reader.read(65536)
    writer.close()

    response_str = response_data.decode("utf-8", errors="replace")
    # Parse status code
    first_line = response_str.split("\r\n", 1)[0]
    status_code = int(first_line.split(" ", 2)[1])
    # Parse body
    body_start = response_str.find("\r\n\r\n")
    resp_body = response_str[body_start + 4:] if body_start != -1 else ""
    return status_code, resp_body


async def http_get(url: str) -> tuple[int, str]:
    return await http_request("GET", url)


async def http_post(url: str, body: str) -> tuple[int, str]:
    return await http_request("POST", url, body)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main():
    global port_a, port_b, _time_offset

    # Startup security warning
    sys.stderr.write("SECURITY WARNING: Using hard-coded demo secret. Do NOT use in production.\n")

    server_a = await asyncio.start_server(handle_server_a, "localhost", 0)
    port_a = server_a.sockets[0].getsockname()[1]

    server_b = await asyncio.start_server(handle_server_b, "localhost", 0)
    port_b = server_b.sockets[0].getsockname()[1]

    print("=== Data Reference Demo ===")
    print(f"  Server A (data source) listening on port {port_a}")
    print(f"  Server B (data consumer) listening on port {port_b}")

    # --- Export from Server A ---
    print("\n--- Export from Server A ---")
    _, export_body = await http_post(f"http://localhost:{port_a}/export", "{}")
    data_ref = json.loads(export_body)

    print(f"  ref_id: {data_ref['ref_id']}")
    print(f"  mime_type: {data_ref['mime_type']}")
    print(f"  size_bytes: {data_ref['size_bytes']}")
    print(f"  access_url: {data_ref['access_url']}")
    print("  (data NOT shown — zero-copy-through-client)")

    # --- Import to Server B ---
    print("\n--- Import to Server B ---")
    print("  Server B fetching from Server A...")
    _, import_body = await http_post(
        f"http://localhost:{port_b}/import", json.dumps(data_ref)
    )
    import_result = json.loads(import_body)
    checksum_msg = "checksum verified" if import_result["checksum_verified"] else "checksum mismatch"
    print(f"  Import result: {import_result['rows_imported']} records imported, {checksum_msg}")

    # --- TTL Expiry Test ---
    print("\n--- TTL Expiry Test ---")
    print("  Attempting fetch with expired URL...")
    # Use the short-ttl endpoint so the URL is born expired
    _, expired_export_body = await http_post(
        f"http://localhost:{port_a}/export-short-ttl", "{}"
    )
    expired_ref = json.loads(expired_export_body)
    expired_status, _ = await http_get(expired_ref["access_url"])
    print(f"  Result: {expired_status} Forbidden (expected)")

    # --- Invalid Signature Test ---
    print("\n--- Invalid Signature Test ---")
    print("  Attempting fetch with tampered signature...")
    import re
    tampered_url = re.sub(r"sig=[^&]+", "sig=tampered0000", data_ref["access_url"])
    tampered_status, _ = await http_get(tampered_url)
    print(f"  Result: {tampered_status} Forbidden (expected)")

    print("\n=== Demo complete ===")

    server_a.close()
    server_b.close()
    await server_a.wait_closed()
    await server_b.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
