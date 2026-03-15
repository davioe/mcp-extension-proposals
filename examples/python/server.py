"""
MCP Extended Server — Python Reference Implementation

A minimal but complete MCP server demonstrating the proposed protocol extensions:
- Service manifest with capability discovery
- Granular permissions and scoped auth
- Idempotency keys and transactions
- Structured error responses
- Streaming with progress notifications
- Provenance on responses
- Human-in-the-loop confirmation
- Intent hints
- Session state

This is a reference implementation, not production code.
It uses an in-memory store and runs over stdio for simplicity.

Requirements:
    pip install mcp

Usage:
    python server.py
"""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any


# =============================================================================
# Domain: A simple project management server (tickets + comments)
# =============================================================================

@dataclass
class Ticket:
    id: str
    title: str
    status: str = "open"
    assignee: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source_file: str | None = None


# In-memory store
TICKETS: dict[str, Ticket] = {
    "PROJ-1": Ticket(id="PROJ-1", title="Fix login bug", status="open", assignee="alice"),
    "PROJ-2": Ticket(id="PROJ-2", title="Add dark mode", status="in_progress", assignee="bob"),
    "PROJ-3": Ticket(id="PROJ-3", title="Update dependencies", status="closed", assignee="alice"),
}


# =============================================================================
# Extension 1: Service Manifest
# =============================================================================

SERVICE_MANIFEST = {
    "manifest_version": "0.1.0",
    "server": {
        "name": "project-tracker-mcp",
        "version": "1.0.0",
        "mcp_spec_version": "2026-01-01",
        "description": "A project management MCP server for tracking tickets.",
        "homepage": "https://github.com/example/project-tracker-mcp",
    },
    "auth": {
        "methods": ["oauth2_device", "api_key"],
        "scopes": [
            {"name": "read:tickets", "description": "Read ticket data", "grants": ["search_tickets", "get_ticket"]},
            {"name": "write:tickets", "description": "Create and modify tickets", "grants": ["create_ticket", "update_ticket"]},
            {"name": "delete:tickets", "description": "Delete tickets", "grants": ["delete_ticket"]},
        ],
        "session_ttl_seconds": 1800,
    },
    "tools": [
        {
            "name": "search_tickets",
            "description": "Search for tickets by query string.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "status": {"type": "string", "enum": ["open", "in_progress", "closed"]},
                    "assignee": {"type": "string"},
                },
            },
            "output_schema": {
                "type": "object",
                "properties": {
                    "tickets": {"type": "array", "items": {"type": "object"}},
                    "total_count": {"type": "integer"},
                },
            },
            "cost": {"category": "free"},
            "latency": "instant",
            "idempotent": True,
            "requires_confirmation": False,
            "risk_level": "safe",
            "required_scopes": ["read:tickets"],
            "supports_streaming": False,
        },
        {
            "name": "create_ticket",
            "description": "Create a new ticket.",
            "input_schema": {
                "type": "object",
                "required": ["title"],
                "properties": {
                    "title": {"type": "string"},
                    "assignee": {"type": "string"},
                    "status": {"type": "string", "enum": ["open", "in_progress"], "default": "open"},
                },
            },
            "cost": {"category": "free"},
            "latency": "instant",
            "idempotent": False,
            "requires_confirmation": False,
            "risk_level": "safe",
            "required_scopes": ["write:tickets"],
        },
        {
            "name": "delete_ticket",
            "description": "Permanently delete a ticket. This action cannot be undone.",
            "input_schema": {
                "type": "object",
                "required": ["ticket_id"],
                "properties": {
                    "ticket_id": {"type": "string"},
                },
            },
            "cost": {"category": "free"},
            "latency": "instant",
            "idempotent": True,
            "requires_confirmation": True,
            "confirmation_message": "This will permanently delete the ticket and all associated data. Proceed?",
            "risk_level": "destructive",
            "required_scopes": ["delete:tickets"],
        },
        {
            "name": "export_tickets",
            "description": "Export all tickets as a CSV. May take time for large datasets.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "format": {"type": "string", "enum": ["csv", "json"], "default": "csv"},
                },
            },
            "cost": {"category": "metered", "estimated_units": 1, "unit_label": "export credits"},
            "latency": "seconds",
            "idempotent": True,
            "requires_confirmation": False,
            "risk_level": "safe",
            "required_scopes": ["read:tickets"],
            "supports_streaming": True,
        },
    ],
    "supported_extensions": [
        "streaming",
        "progress_notifications",
        "idempotency",
        "transactions",
        "session_state",
        "intent_hints",
        "provenance",
        "human_in_the_loop",
    ],
    "rate_limits": {
        "requests_per_minute": 60,
        "requests_per_day": 10000,
    },
}


# =============================================================================
# Extension 4: Permission Checks
# =============================================================================

class PermissionChecker:
    """Simulates scoped permission checks."""

    def __init__(self, granted_scopes: list[str]):
        self.granted_scopes = set(granted_scopes)

    def can_execute(self, tool_name: str) -> dict:
        """Pre-flight permission check (Proposal #4)."""
        tool_def = next((t for t in SERVICE_MANIFEST["tools"] if t["name"] == tool_name), None)
        if not tool_def:
            return {"allowed": False, "reason": f"Unknown tool: {tool_name}"}

        required = set(tool_def.get("required_scopes", []))
        missing = required - self.granted_scopes

        if missing:
            return {
                "allowed": False,
                "missing_scopes": list(missing),
                "reason": f"Missing required scopes: {', '.join(missing)}",
                "elevation_url": "https://example.com/auth/elevate",
            }
        return {"allowed": True}


# =============================================================================
# Extension 5: Idempotency Store
# =============================================================================

class IdempotencyStore:
    """Stores results keyed by idempotency key to prevent duplicate operations."""

    def __init__(self):
        self._store: dict[str, dict] = {}

    def get(self, key: str) -> dict | None:
        entry = self._store.get(key)
        if entry and time.time() < entry["expires_at"]:
            return entry
        return None

    def set(self, key: str, result: Any, ttl_seconds: int = 86400):
        self._store[key] = {
            "result": result,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "expires_at": time.time() + ttl_seconds,
        }


# =============================================================================
# Extension 5: Transaction Manager
# =============================================================================

@dataclass
class TransactionStep:
    step_id: str
    tool: str
    result: Any
    compensation_tool: str
    compensation_params: dict


class TransactionManager:
    """Manages multi-step transactions with compensation-based rollback."""

    def __init__(self):
        self._transactions: dict[str, list[TransactionStep]] = {}

    def begin(self, transaction_id: str) -> dict:
        if transaction_id in self._transactions:
            return structured_error(
                "TRANSACTION_CONFLICT",
                f"Transaction {transaction_id} already exists.",
                "permanent",
            )
        self._transactions[transaction_id] = []
        return {"status": "begun", "transaction_id": transaction_id}

    def add_step(self, transaction_id: str, step: TransactionStep):
        self._transactions[transaction_id].append(step)

    def commit(self, transaction_id: str) -> dict:
        if transaction_id not in self._transactions:
            return structured_error(
                "RESOURCE_NOT_FOUND",
                f"No active transaction with ID {transaction_id}.",
                "permanent",
            )
        steps = self._transactions.pop(transaction_id)
        return {
            "status": "committed",
            "transaction_id": transaction_id,
            "steps_completed": len(steps),
        }

    def rollback(self, transaction_id: str) -> dict:
        if transaction_id not in self._transactions:
            return structured_error(
                "RESOURCE_NOT_FOUND",
                f"No active transaction with ID {transaction_id}.",
                "permanent",
            )
        steps = self._transactions.pop(transaction_id)
        compensated = []

        for step in reversed(steps):
            # Execute compensation
            try:
                if step.compensation_tool == "delete_ticket":
                    ticket_id = step.compensation_params.get("ticket_id")
                    if ticket_id in TICKETS:
                        del TICKETS[ticket_id]
                compensated.append({"step_id": step.step_id, "status": "compensated"})
            except Exception as e:
                compensated.append({
                    "step_id": step.step_id,
                    "status": "compensation_failed",
                    "error": str(e),
                })

        return {
            "status": "rolled_back",
            "transaction_id": transaction_id,
            "steps_compensated": compensated,
        }


# =============================================================================
# Extension 11: Structured Errors
# =============================================================================

def structured_error(
    code: str,
    message: str,
    category: str,
    retry_after: int | None = None,
    suggestion: str | None = None,
    user_actionable: bool = True,
    details: dict | None = None,
) -> dict:
    """Create a structured error response (Proposal #11)."""
    error = {
        "error": {
            "code": code,
            "message": message,
            "category": category,
            "user_actionable": user_actionable,
        }
    }
    if retry_after is not None:
        error["error"]["retry_after_seconds"] = retry_after
    if suggestion:
        error["error"]["suggestion"] = suggestion
    if details:
        error["error"]["details"] = details
    return error


# =============================================================================
# Extension 7: Provenance Helper
# =============================================================================

def with_provenance(result: Any, source: str, confidence: str = "exact", **kwargs) -> dict:
    """Wrap a result with provenance metadata (Proposal #7)."""
    provenance = {
        "source": source,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "confidence": confidence,
    }
    provenance.update(kwargs)
    return {"result": result, "provenance": provenance}


# =============================================================================
# Tool Implementations
# =============================================================================

idempotency_store = IdempotencyStore()
transaction_manager = TransactionManager()
permissions = PermissionChecker(granted_scopes=["read:tickets", "write:tickets"])


def handle_search_tickets(params: dict, intent: str | None = None) -> dict:
    """Search tickets with optional intent hint (Proposal #2)."""
    query = params.get("query", "").lower()
    status_filter = params.get("status")
    assignee_filter = params.get("assignee")

    # Extension 2: Intent Hints — suggest better tool if intent reveals one
    if intent and "recent" in intent.lower() and "incident" in intent.lower():
        return {
            "suggestion": {
                "recommended_tool": "get_recent_incidents",
                "reason": "For recent incidents, this tool filters by type and recency more efficiently.",
            },
            "result": None,
        }

    results = []
    for ticket in TICKETS.values():
        if query and query not in ticket.title.lower():
            continue
        if status_filter and ticket.status != status_filter:
            continue
        if assignee_filter and ticket.assignee != assignee_filter:
            continue
        results.append(vars(ticket))

    # Extension 7: Provenance
    return with_provenance(
        {"tickets": results, "total_count": len(results)},
        source="project-tracker:tickets_table",
        confidence="exact",
    )


def handle_create_ticket(
    params: dict,
    idempotency_key: str | None = None,
    transaction_id: str | None = None,
) -> dict:
    """Create a ticket with idempotency and transaction support."""

    # Extension 5: Idempotency
    if idempotency_key:
        cached = idempotency_store.get(idempotency_key)
        if cached:
            return {
                **cached["result"],
                "idempotency": {
                    "idempotency_key": idempotency_key,
                    "was_replay": True,
                    "original_timestamp": cached["timestamp"],
                },
            }

    ticket_id = f"PROJ-{len(TICKETS) + 1}"
    ticket = Ticket(
        id=ticket_id,
        title=params["title"],
        assignee=params.get("assignee"),
        status=params.get("status", "open"),
    )
    TICKETS[ticket_id] = ticket

    result = with_provenance(
        {"ticket": vars(ticket), "created": True},
        source=f"project-tracker:tickets/{ticket_id}",
        confidence="exact",
    )

    # Store for idempotency
    if idempotency_key:
        idempotency_store.set(idempotency_key, result)
        result["idempotency"] = {
            "idempotency_key": idempotency_key,
            "was_replay": False,
        }

    # Extension 5: Register transaction step with compensation
    if transaction_id:
        transaction_manager.add_step(
            transaction_id,
            TransactionStep(
                step_id=f"create-{ticket_id}",
                tool="create_ticket",
                result=result,
                compensation_tool="delete_ticket",
                compensation_params={"ticket_id": ticket_id},
            ),
        )
        result["transaction"] = {
            "transaction_id": transaction_id,
            "step_id": f"create-{ticket_id}",
            "compensation": {
                "tool": "delete_ticket",
                "parameters": {"ticket_id": ticket_id},
                "description": f"Delete ticket {ticket_id}",
            },
        }

    return result


def handle_delete_ticket(params: dict) -> dict:
    """Delete a ticket — requires confirmation (Proposal #6)."""
    ticket_id = params["ticket_id"]

    if ticket_id not in TICKETS:
        return structured_error(
            "RESOURCE_NOT_FOUND",
            f"Ticket {ticket_id} does not exist.",
            "permanent",
            suggestion="Check the ticket ID and try again.",
        )

    del TICKETS[ticket_id]
    return {"deleted": True, "ticket_id": ticket_id}


async def handle_export_tickets(params: dict, send_progress=None) -> dict:
    """Export tickets with streaming progress (Proposal #8)."""
    format_type = params.get("format", "csv")
    tickets = list(TICKETS.values())
    total = len(tickets)
    operation_id = f"export-{uuid.uuid4().hex[:8]}"

    results = []
    for i, ticket in enumerate(tickets):
        # Simulate processing time
        await asyncio.sleep(0.5)

        # Extension 8: Progress notification
        if send_progress:
            await send_progress({
                "type": "progress",
                "operation_id": operation_id,
                "progress": (i + 1) / total,
                "message": f"Processing ticket {i + 1} of {total}",
                "estimated_remaining_seconds": (total - i - 1) * 0.5,
                "checkpoint_token": f"checkpoint-{i}",
            })

        if format_type == "csv":
            results.append(f"{ticket.id},{ticket.title},{ticket.status},{ticket.assignee}")
        else:
            results.append(vars(ticket))

    if format_type == "csv":
        header = "id,title,status,assignee"
        output = header + "\n" + "\n".join(results)
    else:
        output = results

    return with_provenance(
        {"data": output, "format": format_type, "count": total},
        source="project-tracker:tickets_table",
        confidence="exact",
        transformation=f"Full export as {format_type}",
    )


# =============================================================================
# Extension 14: Session State
# =============================================================================

import base64

class SessionStateManager:
    """Manages opaque session state tokens."""

    @staticmethod
    def encode(state: dict) -> str:
        return base64.b64encode(json.dumps(state).encode()).decode()

    @staticmethod
    def decode(token: str) -> dict:
        return json.loads(base64.b64decode(token).decode())


# =============================================================================
# Request Router (demonstrates the full flow)
# =============================================================================

async def handle_request(request: dict) -> dict:
    """
    Route an incoming MCP request through all proposed extensions.
    This demonstrates how a real server would process requests.
    """
    tool = request.get("tool")
    params = request.get("parameters", {})
    intent = request.get("intent")  # Extension 2
    idempotency_key = request.get("idempotency_key")  # Extension 5
    transaction_id = request.get("transaction_id")  # Extension 5
    session_state = request.get("session_state")  # Extension 14

    # Extension 14: Decode session state if present
    context = {}
    if session_state:
        try:
            context = SessionStateManager.decode(session_state)
        except Exception:
            return structured_error(
                "INVALID_INPUT",
                "Invalid session state token.",
                "invalid_input",
                suggestion="Start a new session without a state token.",
            )

    # Meta-tools: manifest, permissions, transactions (no auth required)
    if tool == "get_manifest":
        return SERVICE_MANIFEST
    if tool == "check_permissions":
        return permissions.can_execute(params.get("tool", ""))
    if tool == "begin_transaction":
        return transaction_manager.begin(params["transaction_id"])
    if tool == "commit_transaction":
        return transaction_manager.commit(params["transaction_id"])
    if tool == "rollback_transaction":
        return transaction_manager.rollback(params["transaction_id"])

    # Extension 4: Permission check
    perm_check = permissions.can_execute(tool)
    if not perm_check["allowed"]:
        return structured_error(
            "SCOPE_INSUFFICIENT",
            perm_check["reason"],
            "auth_required",
            suggestion=f"Request scope elevation at {perm_check.get('elevation_url', 'N/A')}",
            details={"missing_scopes": perm_check.get("missing_scopes", [])},
        )

    # Extension 6: Human-in-the-loop check
    tool_def = next((t for t in SERVICE_MANIFEST["tools"] if t["name"] == tool), None)
    if tool_def and tool_def.get("requires_confirmation"):
        if not request.get("user_confirmed"):
            return {
                "requires_confirmation": True,
                "confirmation_message": tool_def.get("confirmation_message", "Are you sure?"),
                "risk_level": tool_def.get("risk_level", "destructive"),
                "tool": tool,
                "parameters": params,
            }

    # Route to tool handler
    if tool == "search_tickets":
        result = handle_search_tickets(params, intent=intent)
    elif tool == "create_ticket":
        result = handle_create_ticket(params, idempotency_key=idempotency_key, transaction_id=transaction_id)
    elif tool == "delete_ticket":
        result = handle_delete_ticket(params)
    elif tool == "export_tickets":
        result = await handle_export_tickets(params)
    else:
        result = structured_error(
            "RESOURCE_NOT_FOUND",
            f"Unknown tool: {tool}",
            "permanent",
            suggestion=f"Available tools: {', '.join(t['name'] for t in SERVICE_MANIFEST['tools'])}",
        )

    # Extension 14: Attach updated session state
    context["last_tool"] = tool
    context["last_call_at"] = datetime.now(timezone.utc).isoformat()
    result["session_state"] = SessionStateManager.encode(context)

    return result


# =============================================================================
# Example Usage
# =============================================================================

async def demo():
    """Demonstrate all proposed extensions in action."""
    print("=" * 70)
    print("MCP Extended Server — Python Reference Implementation Demo")
    print("=" * 70)

    # 1. Service Manifest (Proposal #1)
    print("\n--- 1. Service Manifest ---")
    manifest = await handle_request({"tool": "get_manifest"})
    print(f"Server: {manifest['server']['name']} v{manifest['server']['version']}")
    print(f"Extensions: {', '.join(manifest['supported_extensions'])}")
    print(f"Tools: {', '.join(t['name'] for t in manifest['tools'])}")

    # 2. Permission Check (Proposal #4)
    print("\n--- 2. Permission Check ---")
    check = await handle_request({"tool": "check_permissions", "parameters": {"tool": "delete_ticket"}})
    print(f"Can delete tickets? {check}")

    # 3. Search with Intent Hint (Proposal #2)
    print("\n--- 3. Search with Intent Hint ---")
    result = await handle_request({
        "tool": "search_tickets",
        "parameters": {"query": "bug"},
        "intent": "Find the most recent incident from last Friday's deployment",
    })
    print(f"Intent-based suggestion: {result.get('suggestion', 'none')}")

    # 4. Search with Provenance (Proposal #7)
    print("\n--- 4. Search with Provenance ---")
    result = await handle_request({
        "tool": "search_tickets",
        "parameters": {"status": "open"},
    })
    print(f"Found {result['result']['total_count']} tickets")
    print(f"Provenance: {result['provenance']}")

    # 5. Idempotent Create (Proposal #5)
    print("\n--- 5. Idempotent Create ---")
    idem_key = "create-deploy-ticket-2026-03-15"
    result1 = await handle_request({
        "tool": "create_ticket",
        "parameters": {"title": "Deploy v2.1", "assignee": "charlie"},
        "idempotency_key": idem_key,
    })
    print(f"First call — created: {result1['result']['ticket']['id']}, replay: {result1['idempotency']['was_replay']}")

    result2 = await handle_request({
        "tool": "create_ticket",
        "parameters": {"title": "Deploy v2.1", "assignee": "charlie"},
        "idempotency_key": idem_key,
    })
    print(f"Second call — replay: {result2['idempotency']['was_replay']}, same ticket: {result2['result']['ticket']['id']}")

    # 6. Human-in-the-Loop (Proposal #6)
    print("\n--- 6. Human-in-the-Loop ---")
    # Temporarily grant delete scope to demonstrate the confirmation flow
    permissions.granted_scopes.add("delete:tickets")

    result = await handle_request({
        "tool": "delete_ticket",
        "parameters": {"ticket_id": "PROJ-2"},
    })
    print(f"Requires confirmation: {result.get('requires_confirmation')}")
    print(f"Message: {result.get('confirmation_message')}")
    print(f"Risk level: {result.get('risk_level')}")

    # Now with explicit user confirmation
    result = await handle_request({
        "tool": "delete_ticket",
        "parameters": {"ticket_id": "PROJ-2"},
        "user_confirmed": True,
    })
    print(f"After confirmation: deleted={result.get('deleted')}, ticket={result.get('ticket_id')}")

    # Revoke delete scope again
    permissions.granted_scopes.discard("delete:tickets")

    # 7. Transaction with Rollback (Proposal #5)
    print("\n--- 7. Transaction with Rollback ---")
    tx_id = "tx-migration-001"
    await handle_request({"tool": "begin_transaction", "parameters": {"transaction_id": tx_id}})
    print(f"Transaction {tx_id} started")

    await handle_request({
        "tool": "create_ticket",
        "parameters": {"title": "Migration step 1"},
        "transaction_id": tx_id,
    })
    print("Step 1: ticket created")

    await handle_request({
        "tool": "create_ticket",
        "parameters": {"title": "Migration step 2"},
        "transaction_id": tx_id,
    })
    print("Step 2: ticket created")

    # Simulate failure — rollback
    rollback = await handle_request({
        "tool": "rollback_transaction",
        "parameters": {"transaction_id": tx_id},
    })
    print(f"Rollback result: {rollback}")

    # 8. Session State (Proposal #14)
    print("\n--- 8. Session State ---")
    result = await handle_request({
        "tool": "search_tickets",
        "parameters": {"status": "open"},
    })
    state_token = result.get("session_state")
    decoded = SessionStateManager.decode(state_token)
    print(f"Session state: {decoded}")

    # 9. Structured Error (Proposal #11)
    print("\n--- 9. Structured Error ---")
    # Grant delete scope temporarily to get past permission check and show the actual error
    permissions.granted_scopes.add("delete:tickets")
    result = await handle_request({
        "tool": "delete_ticket",
        "parameters": {"ticket_id": "NONEXISTENT"},
        "user_confirmed": True,
    })
    print(f"Error: {json.dumps(result, indent=2)}")
    permissions.granted_scopes.discard("delete:tickets")

    # 10. Permission Denied Error (Proposal #4 + #11 combined)
    print("\n--- 10. Permission Denied (Proposals #4 + #11) ---")
    result = await handle_request({
        "tool": "delete_ticket",
        "parameters": {"ticket_id": "PROJ-3"},
        "user_confirmed": True,
    })
    print(f"Error: {json.dumps(result, indent=2)}")

    print("\n" + "=" * 70)
    print("Demo complete.")


if __name__ == "__main__":
    asyncio.run(demo())
