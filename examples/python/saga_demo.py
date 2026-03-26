"""
Cross-Server Saga Orchestration Demo (HTTP Transport)

Demonstrates the client-side Saga pattern described in SEP-0000 (Cross-Server
Coordination section).  A SagaOrchestrator drives a multi-step workflow across
three independent HTTP servers, compensating completed steps on failure.

Scenario A: All compensations succeed (clean rollback).
Scenario B: One compensation fails because the target server is shut down.

Each server is a real asyncio TCP server speaking HTTP/JSON-RPC.

Stdlib only.  Usage:
    python saga_demo.py
"""

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# ---------------------------------------------------------------------------
# Minimal HTTP parsing helpers (same pattern as data_reference_demo.py)
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


def http_response(status: int, status_text: str, body: str,
                  content_type: str = "application/json") -> bytes:
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
# JSON-RPC helpers
# ---------------------------------------------------------------------------

def jsonrpc_result(request_id: Any, result: Any) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result})


def jsonrpc_error(request_id: Any, code: int, message: str) -> str:
    return json.dumps({
        "jsonrpc": "2.0", "id": request_id,
        "error": {"code": code, "message": message},
    })


# ---------------------------------------------------------------------------
# Jira server
# ---------------------------------------------------------------------------

TICKETS_JIRA: dict[str, dict] = {}
counter_jira: int = 0


async def handle_jira(reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
    global counter_jira
    try:
        data = await reader.read(65536)
        if not data:
            writer.close()
            return
        _method, _path, _headers, body = parse_request_line(data)
        msg = json.loads(body)
        request_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params", {})

        if method != "tools/call":
            resp_body = jsonrpc_error(request_id, -32601, "Method not found")
        else:
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            if tool_name == "create_ticket":
                counter_jira += 1
                ticket_id = f"PROJ-{counter_jira}"
                TICKETS_JIRA[ticket_id] = {
                    "id": ticket_id, "title": arguments.get("title", ""),
                }
                resp_body = jsonrpc_result(request_id, {
                    "ticket": {"id": ticket_id, "title": arguments.get("title", "")},
                    "created": True,
                })
            elif tool_name == "delete_ticket":
                ticket_id = arguments.get("ticket_id", "")
                if ticket_id not in TICKETS_JIRA:
                    resp_body = jsonrpc_result(request_id, {
                        "error": {
                            "code": "RESOURCE_NOT_FOUND",
                            "message": f"Ticket {ticket_id} does not exist.",
                            "category": "permanent",
                        }
                    })
                else:
                    del TICKETS_JIRA[ticket_id]
                    resp_body = jsonrpc_result(request_id, {
                        "deleted": True, "ticket_id": ticket_id,
                    })
            else:
                resp_body = jsonrpc_error(request_id, -32601, "Method not found")

        writer.write(http_response(200, "OK", resp_body))
        await writer.drain()
    finally:
        writer.close()


# ---------------------------------------------------------------------------
# Confluence server
# ---------------------------------------------------------------------------

TICKETS_CONF: dict[str, dict] = {}
counter_conf: int = 0


async def handle_confluence(reader: asyncio.StreamReader,
                            writer: asyncio.StreamWriter) -> None:
    global counter_conf
    try:
        data = await reader.read(65536)
        if not data:
            writer.close()
            return
        _method, _path, _headers, body = parse_request_line(data)
        msg = json.loads(body)
        request_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params", {})

        if method != "tools/call":
            resp_body = jsonrpc_error(request_id, -32601, "Method not found")
        else:
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            if tool_name == "create_ticket":
                counter_conf += 1
                ticket_id = f"PROJ-{counter_conf}"
                TICKETS_CONF[ticket_id] = {
                    "id": ticket_id, "title": arguments.get("title", ""),
                }
                resp_body = jsonrpc_result(request_id, {
                    "ticket": {"id": ticket_id, "title": arguments.get("title", "")},
                    "created": True,
                })
            elif tool_name == "delete_ticket":
                ticket_id = arguments.get("ticket_id", "")
                if ticket_id not in TICKETS_CONF:
                    resp_body = jsonrpc_result(request_id, {
                        "error": {
                            "code": "RESOURCE_NOT_FOUND",
                            "message": f"Ticket {ticket_id} does not exist.",
                            "category": "permanent",
                        }
                    })
                else:
                    del TICKETS_CONF[ticket_id]
                    resp_body = jsonrpc_result(request_id, {
                        "deleted": True, "ticket_id": ticket_id,
                    })
            else:
                resp_body = jsonrpc_error(request_id, -32601, "Method not found")

        writer.write(http_response(200, "OK", resp_body))
        await writer.drain()
    finally:
        writer.close()


# ---------------------------------------------------------------------------
# Slack server — supports NO tools
# ---------------------------------------------------------------------------

async def handle_slack(reader: asyncio.StreamReader,
                       writer: asyncio.StreamWriter) -> None:
    try:
        data = await reader.read(65536)
        if not data:
            writer.close()
            return
        _method, _path, _headers, body = parse_request_line(data)
        msg = json.loads(body)
        request_id = msg.get("id")
        resp_body = jsonrpc_error(request_id, -32601, "Method not found")
        writer.write(http_response(200, "OK", resp_body))
        await writer.drain()
    finally:
        writer.close()


# ---------------------------------------------------------------------------
# HTTP client helper
# ---------------------------------------------------------------------------

async def http_post(url: str, body: str) -> str:
    """Send an HTTP POST and return the response body as a string.

    Raises ConnectionRefusedError / OSError if the server is unreachable.
    """
    # Parse url of form http://host:port
    # Strip scheme
    without_scheme = url.replace("http://", "")
    host, port_str = without_scheme.split(":")
    port = int(port_str)

    reader, writer = await asyncio.open_connection(host, port)
    try:
        body_bytes = body.encode("utf-8")
        request = (
            f"POST / HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body_bytes)}\r\n"
            f"Connection: close\r\n"
            f"\r\n"
        ).encode("utf-8") + body_bytes
        writer.write(request)
        await writer.drain()

        response_data = await reader.read(65536)
        # Extract body from HTTP response
        header_end = response_data.find(b"\r\n\r\n")
        if header_end == -1:
            return response_data.decode("utf-8", errors="replace")
        return response_data[header_end + 4:].decode("utf-8", errors="replace")
    finally:
        writer.close()


# ---------------------------------------------------------------------------
# JSON-RPC request builder (client side)
# ---------------------------------------------------------------------------

def build_jsonrpc_request(method: str, params: Optional[dict] = None,
                          request_id: Any = None) -> str:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    msg["id"] = request_id or str(uuid.uuid4())
    return json.dumps(msg)


# ==========================================================================
# Saga Orchestrator
# ==========================================================================

@dataclass
class CompensationEntry:
    server_url: str
    server_label: str
    step_id: str
    compensation_tool: str
    compensation_arguments: dict
    idempotency_key: str
    status: str = "pending"  # pending | compensated | compensation_failed


class SagaOrchestrator:
    """Client-side Saga orchestrator (HTTP transport)."""

    def __init__(self) -> None:
        self.compensation_log: list[CompensationEntry] = []
        self._step_number: int = 0

    async def execute_step(
        self,
        server_url: str,
        server_label: str,
        tool_name: str,
        arguments: dict,
        compensation_tool: str,
        compensation_args_fn: Optional[Callable] = None,
    ) -> dict:
        self._step_number += 1
        step_num = self._step_number

        envelope = build_jsonrpc_request(
            "tools/call",
            {"name": tool_name, "arguments": arguments},
        )

        try:
            raw_response = await http_post(server_url, envelope)
        except (ConnectionRefusedError, OSError) as exc:
            print(f"  Step {step_num} [{server_label}]: {tool_name} "
                  f"-> FAILED (Connection refused)")
            return {"success": False, "step": step_num}

        response = json.loads(raw_response)

        # JSON-RPC level error
        if "error" in response:
            err = response["error"]
            code = err.get("code", "?")
            msg = err.get("message", "Unknown error")
            print(f"  Step {step_num} [{server_label}]: {tool_name} "
                  f"-> FAILED ({code}: {msg})")
            return {"success": False, "step": step_num}

        result = response.get("result", {})

        # Application-level structured error
        if "error" in result:
            print(f"  Step {step_num} [{server_label}]: {tool_name} -> FAILED")
            return {"success": False, "step": step_num}

        # Derive compensation arguments
        comp_args = compensation_args_fn(result) if compensation_args_fn else {}

        ticket_id = result.get("ticket", {}).get("id", f"step-{step_num}")
        step_id = f"create-{ticket_id}"

        entry = CompensationEntry(
            server_url=server_url,
            server_label=server_label,
            step_id=step_id,
            compensation_tool=compensation_tool,
            compensation_arguments=comp_args,
            idempotency_key=f"compensate-{uuid.uuid4()}",
        )
        self.compensation_log.append(entry)

        print(f"  Step {step_num} [{server_label}]: {tool_name} "
              f"-> success ({ticket_id})")
        return {"success": True, "step": step_num, "result": result}

    async def rollback(self) -> None:
        """Compensate completed steps in reverse order."""
        print("  Initiating rollback...")
        for entry in reversed(self.compensation_log):
            idx = self.compensation_log.index(entry) + 1
            envelope = build_jsonrpc_request(
                "tools/call",
                {
                    "name": entry.compensation_tool,
                    "arguments": entry.compensation_arguments,
                    "_meta": {"idempotency_key": entry.idempotency_key},
                },
            )

            try:
                raw = await http_post(entry.server_url, envelope)
            except (ConnectionRefusedError, OSError):
                entry.status = "compensation_failed"
                print(f"  Compensate Step {idx} [{entry.server_label}]: "
                      f"{entry.compensation_tool} -> FAILED (Connection refused)")
                continue

            resp = json.loads(raw)
            result = resp.get("result", {})

            if "error" in resp or "error" in result:
                entry.status = "compensation_failed"
                print(f"  Compensate Step {idx} [{entry.server_label}]: "
                      f"{entry.compensation_tool} -> FAILED (compensation_failed)")
            else:
                entry.status = "compensated"
                print(f"  Compensate Step {idx} [{entry.server_label}]: "
                      f"{entry.compensation_tool} -> success")

        succeeded = sum(1 for e in self.compensation_log if e.status == "compensated")
        failed = sum(1 for e in self.compensation_log if e.status == "compensation_failed")
        total = len(self.compensation_log)

        if failed == 0:
            print(f"  Result: Clean rollback - all compensations succeeded")
        else:
            print(f"  Result: Partial rollback - {failed} of {total} compensations failed")

    def print_compensation_log(self) -> None:
        print()
        print("  Compensation Log:")
        for i, entry in enumerate(self.compensation_log, 1):
            print(f"    [{i}] {entry.server_label} / {entry.step_id}: {entry.status}")


# ==========================================================================
# Store reset helpers
# ==========================================================================

def reset_stores() -> None:
    global counter_jira, counter_conf
    TICKETS_JIRA.clear()
    TICKETS_CONF.clear()
    counter_jira = 0
    counter_conf = 0


# ==========================================================================
# Demo Scenarios
# ==========================================================================

async def scenario_a(url_jira: str, url_conf: str, url_slack: str) -> None:
    """Clean rollback: all compensations succeed."""
    reset_stores()
    saga = SagaOrchestrator()

    # Step 1: Jira -> create_ticket
    r1 = await saga.execute_step(
        server_url=url_jira,
        server_label="jira",
        tool_name="create_ticket",
        arguments={"title": "Deploy v2.1"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 2: Confluence -> create_ticket
    r2 = await saga.execute_step(
        server_url=url_conf,
        server_label="confluence",
        tool_name="create_ticket",
        arguments={"title": "Link deployment docs"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 3: Slack -> create_ticket (will fail: -32601)
    r3 = await saga.execute_step(
        server_url=url_slack,
        server_label="slack",
        tool_name="create_ticket",
        arguments={"title": "Notify channel"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {},
    )

    # Step 3 failed — trigger rollback
    if not r3["success"]:
        await saga.rollback()

    saga.print_compensation_log()


async def scenario_b(url_jira: str, url_conf: str, url_slack: str,
                     server_jira: asyncio.AbstractServer) -> None:
    """Partial rollback: Jira server becomes unavailable during compensation."""
    reset_stores()
    saga = SagaOrchestrator()

    # Step 1: Jira -> create_ticket
    r1 = await saga.execute_step(
        server_url=url_jira,
        server_label="jira",
        tool_name="create_ticket",
        arguments={"title": "Migration step 1"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 2: Confluence -> create_ticket
    r2 = await saga.execute_step(
        server_url=url_conf,
        server_label="confluence",
        tool_name="create_ticket",
        arguments={"title": "Migration step 2"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 3: Slack -> create_ticket (will fail: -32601)
    r3 = await saga.execute_step(
        server_url=url_slack,
        server_label="slack",
        tool_name="create_ticket",
        arguments={"title": "Notify channel"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {},
    )

    # Shut down Jira server before rollback
    if not r3["success"]:
        print("  Shutting down Jira server to simulate unavailability...")
        server_jira.close()
        await server_jira.wait_closed()
        # Small delay to ensure the port is fully released
        await asyncio.sleep(0.1)
        await saga.rollback()

    saga.print_compensation_log()


# ==========================================================================
# Main
# ==========================================================================

async def main() -> None:
    # Start three independent servers on ephemeral ports
    server_jira = await asyncio.start_server(handle_jira, "127.0.0.1", 0)
    server_conf = await asyncio.start_server(handle_confluence, "127.0.0.1", 0)
    server_slack = await asyncio.start_server(handle_slack, "127.0.0.1", 0)

    port_jira = server_jira.sockets[0].getsockname()[1]
    port_conf = server_conf.sockets[0].getsockname()[1]
    port_slack = server_slack.sockets[0].getsockname()[1]

    url_jira = f"http://127.0.0.1:{port_jira}"
    url_conf = f"http://127.0.0.1:{port_conf}"
    url_slack = f"http://127.0.0.1:{port_slack}"

    print("=== Cross-Server Saga Demo (HTTP Transport) ===")
    print()
    print(f"  Jira server:       {url_jira}")
    print(f"  Confluence server:  {url_conf}")
    print(f"  Slack server:      {url_slack}")
    print()

    print("--- Scenario A: Clean Rollback ---")
    await scenario_a(url_jira, url_conf, url_slack)
    print()

    print("--- Scenario B: Partial Rollback (Server Unavailability) ---")
    await scenario_b(url_jira, url_conf, url_slack, server_jira)
    print()

    print("=== Demo complete ===")

    # Shut down remaining servers
    for srv in (server_jira, server_conf, server_slack):
        srv.close()
    for srv in (server_jira, server_conf, server_slack):
        try:
            await srv.wait_closed()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
