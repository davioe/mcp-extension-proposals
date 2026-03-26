"""
Cross-Server Saga Orchestration Demo

Demonstrates the client-side Saga pattern described in SEP-0000 (Cross-Server
Coordination section).  A SagaOrchestrator drives a multi-step workflow across
simulated MCP servers, compensating completed steps on failure.

Scenario A: All compensations succeed (clean rollback).
Scenario B: One compensation fails (partial rollback).

NOTE: The three "servers" (jira-server, confluence-server, slack-server) are
simulated by routing every call through the same in-memory process_jsonrpc()
function.  They share one ticket store.  In a real deployment each server_id
would correspond to a separate MCP server connection.

Stdlib only.  Usage:
    python saga_demo.py
"""

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# =============================================================================
# Minimal infrastructure (lightweight subset of server.py)
# =============================================================================

@dataclass
class Ticket:
    id: str
    title: str
    status: str = "open"
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


TICKETS: dict[str, Ticket] = {}
TICKET_COUNTER: int = 0


def reset_store() -> None:
    """Reset the in-memory store between scenarios."""
    global TICKET_COUNTER
    TICKETS.clear()
    TICKET_COUNTER = 0


# --- Structured error helper ------------------------------------------------

def structured_error(code: str, message: str, category: str, **kwargs) -> dict:
    err: dict[str, Any] = {
        "error": {"code": code, "message": message, "category": category}
    }
    err["error"].update(kwargs)
    return err


# --- Tool handlers -----------------------------------------------------------

def handle_create_ticket(params: dict) -> dict:
    global TICKET_COUNTER
    TICKET_COUNTER += 1
    ticket_id = f"PROJ-{TICKET_COUNTER}"
    ticket = Ticket(id=ticket_id, title=params["title"])
    TICKETS[ticket_id] = ticket
    return {"ticket": {"id": ticket_id, "title": ticket.title}, "created": True}


def handle_delete_ticket(params: dict) -> dict:
    ticket_id = params["ticket_id"]
    if ticket_id not in TICKETS:
        return structured_error(
            "RESOURCE_NOT_FOUND",
            f"Ticket {ticket_id} does not exist.",
            "permanent",
        )
    del TICKETS[ticket_id]
    return {"deleted": True, "ticket_id": ticket_id}


# --- Request router ----------------------------------------------------------

async def handle_request(request: dict) -> dict:
    tool = request.get("tool")
    params = request.get("parameters", {})

    if tool == "create_ticket":
        return handle_create_ticket(params)
    elif tool == "delete_ticket":
        return handle_delete_ticket(params)
    else:
        return structured_error(
            "RESOURCE_NOT_FOUND",
            f"Unknown tool: {tool}",
            "permanent",
        )


# --- JSON-RPC 2.0 layer (from server.py) ------------------------------------

def build_jsonrpc_request(
    method: str, params: dict | None = None, request_id: Any = None
) -> str:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    msg["id"] = request_id or str(uuid.uuid4())
    return json.dumps(msg)


def build_jsonrpc_response(request_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def build_jsonrpc_error(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


async def process_jsonrpc(raw_json: str) -> str:
    """Top-level JSON-RPC 2.0 entry point (simplified from server.py)."""
    try:
        msg = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError) as exc:
        return json.dumps(build_jsonrpc_error(None, -32700, f"Parse error: {exc}"))

    request_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params", {})

    if method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        internal = {"tool": tool_name, "parameters": arguments}
        try:
            result = await handle_request(internal)
        except Exception as exc:
            return json.dumps(build_jsonrpc_error(request_id, -32603, str(exc)))
        return json.dumps(build_jsonrpc_response(request_id, result))

    return json.dumps(build_jsonrpc_error(request_id, -32601, f"Method not found: {method}"))


# =============================================================================
# Saga Orchestrator
# =============================================================================

@dataclass
class CompensationEntry:
    server_id: str
    step_id: str
    compensation_tool: str
    compensation_arguments: dict
    idempotency_key: str
    status: str = "pending"  # pending | compensated | compensation_failed


class SagaOrchestrator:
    """Client-side Saga orchestrator as described in SEP-0000 Cross-Server Coordination."""

    def __init__(self) -> None:
        self.compensation_log: list[CompensationEntry] = []
        self._step_number: int = 0

    async def execute_step(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict,
        compensation_tool: str,
        compensation_args_fn: Any = None,
    ) -> dict:
        """Execute one forward step.  On success register compensation; on failure trigger rollback.

        compensation_args_fn: a callable that receives the step result and returns
        the compensation arguments dict.  This lets the caller derive the
        compensation args from the actual result (e.g. the created ticket id).
        """
        self._step_number += 1
        step_num = self._step_number

        # Build JSON-RPC tools/call envelope
        request = build_jsonrpc_request(
            "tools/call",
            {"name": tool_name, "arguments": arguments},
        )

        # All "servers" route through the same process_jsonrpc — see module docstring.
        raw_response = await process_jsonrpc(request)
        response = json.loads(raw_response)

        # Check for JSON-RPC level error
        if "error" in response:
            print(f"  Step {step_num} [{server_id}]: {tool_name} -> FAILED")
            await self.rollback()
            return {"success": False, "step": step_num}

        result = response.get("result", {})

        # Check for application-level structured error
        if "error" in result:
            print(f"  Step {step_num} [{server_id}]: {tool_name} -> FAILED")
            await self.rollback()
            return {"success": False, "step": step_num}

        # Derive compensation arguments from result
        comp_args = compensation_args_fn(result) if compensation_args_fn else {}

        # Derive a human-readable step_id
        ticket_id = result.get("ticket", {}).get("id", f"step-{step_num}")
        step_id = f"create-{ticket_id}"

        entry = CompensationEntry(
            server_id=server_id,
            step_id=step_id,
            compensation_tool=compensation_tool,
            compensation_arguments=comp_args,
            idempotency_key=f"compensate-{uuid.uuid4()}",
        )
        self.compensation_log.append(entry)

        print(f"  Step {step_num} [{server_id}]: {tool_name} -> success ({ticket_id})")
        return {"success": True, "step": step_num, "result": result}

    async def rollback(self) -> None:
        """Compensate completed steps in reverse order."""
        print("  Initiating rollback...")
        for entry in reversed(self.compensation_log):
            request = build_jsonrpc_request(
                "tools/call",
                {
                    "name": entry.compensation_tool,
                    "arguments": entry.compensation_arguments,
                    "_meta": {"idempotency_key": entry.idempotency_key},
                },
            )
            raw = await process_jsonrpc(request)
            resp = json.loads(raw)

            result = resp.get("result", {})
            if "error" in resp or "error" in result:
                entry.status = "compensation_failed"
                step_label = entry.step_id.replace("create-", "")
                print(
                    f"  Compensate Step {self.compensation_log.index(entry) + 1}: "
                    f"{entry.compensation_tool} -> FAILED (compensation_failed)"
                )
            else:
                entry.status = "compensated"
                step_label = entry.step_id.replace("create-", "")
                print(
                    f"  Compensate Step {self.compensation_log.index(entry) + 1}: "
                    f"{entry.compensation_tool} -> success"
                )

        succeeded = sum(1 for e in self.compensation_log if e.status == "compensated")
        failed = sum(1 for e in self.compensation_log if e.status == "compensation_failed")
        total = len(self.compensation_log)

        if failed == 0:
            print(f"  Result: Clean rollback — all compensations succeeded")
        else:
            print(f"  Result: Partial rollback — {failed} of {total} compensations failed")

    def print_compensation_log(self) -> None:
        print()
        print("  Compensation Log:")
        for i, entry in enumerate(self.compensation_log, 1):
            print(f"    [{i}] {entry.server_id}/{entry.step_id}: {entry.status}")


# =============================================================================
# Demo Scenarios
# =============================================================================

async def scenario_a() -> None:
    """Clean rollback: all compensations succeed."""
    reset_store()
    saga = SagaOrchestrator()

    # Step 1: jira-server -> create_ticket
    await saga.execute_step(
        server_id="jira-server",
        tool_name="create_ticket",
        arguments={"title": "Deploy v2.1"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 2: confluence-server -> create_ticket
    await saga.execute_step(
        server_id="confluence-server",
        tool_name="create_ticket",
        arguments={"title": "Link docs"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 3: slack-server -> post_message (will fail: unknown tool)
    result = await saga.execute_step(
        server_id="slack-server",
        tool_name="post_message",
        arguments={"channel": "#releases", "text": "Deployed v2.1"},
        compensation_tool="delete_message",
        compensation_args_fn=lambda r: {},
    )

    saga.print_compensation_log()


async def scenario_b() -> None:
    """Partial rollback: one compensation fails."""
    reset_store()
    saga = SagaOrchestrator()

    # Step 1: create_ticket
    await saga.execute_step(
        server_id="jira-server",
        tool_name="create_ticket",
        arguments={"title": "Deploy v2.1"},
        compensation_tool="delete_ticket",
        # Inject failure: use a nonexistent ticket ID so compensation will fail
        compensation_args_fn=lambda r: {"ticket_id": "PROJ-9999"},
    )

    # Step 2: create_ticket
    await saga.execute_step(
        server_id="confluence-server",
        tool_name="create_ticket",
        arguments={"title": "Link docs"},
        compensation_tool="delete_ticket",
        compensation_args_fn=lambda r: {"ticket_id": r["ticket"]["id"]},
    )

    # Step 3: fail (unknown tool)
    result = await saga.execute_step(
        server_id="slack-server",
        tool_name="post_message",
        arguments={"channel": "#releases", "text": "Deployed v2.1"},
        compensation_tool="delete_message",
        compensation_args_fn=lambda r: {},
    )

    saga.print_compensation_log()


async def main() -> None:
    print("=== Cross-Server Saga Demo ===")
    print()
    print("--- Scenario A: Clean Rollback ---")
    await scenario_a()
    print()
    print("--- Scenario B: Partial Rollback ---")
    await scenario_b()
    print()
    print("=== Demo complete ===")


if __name__ == "__main__":
    asyncio.run(main())
