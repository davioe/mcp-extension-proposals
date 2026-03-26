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
No external dependencies required (stdlib only).

Usage:
    python server.py
"""

import asyncio
import base64
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
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


# In-memory store
TICKETS: dict[str, Ticket] = {
    "PROJ-1": Ticket(id="PROJ-1", title="Fix login bug", status="open", assignee="alice"),
    "PROJ-2": Ticket(id="PROJ-2", title="Add dark mode", status="in_progress", assignee="bob"),
    "PROJ-3": Ticket(id="PROJ-3", title="Update dependencies", status="closed", assignee="alice"),
}
TICKET_COUNTER = len(TICKETS)  # Monotonic counter — never decreases, even after deletes


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
# JSON-RPC 2.0 Wire Format
# =============================================================================

def parse_jsonrpc_request(raw_json: str) -> dict:
    """Parse and validate a JSON-RPC 2.0 request envelope."""
    try:
        msg = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(f"Invalid JSON: {exc}")

    if not isinstance(msg, dict):
        raise ValueError("Request must be a JSON object")
    if msg.get("jsonrpc") != "2.0":
        raise ValueError("Missing or invalid 'jsonrpc' field (must be '2.0')")
    if "method" not in msg:
        raise ValueError("Missing 'method' field")

    return msg


def build_jsonrpc_response(request_id, result) -> dict:
    """Build a JSON-RPC 2.0 success response envelope."""
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def build_jsonrpc_error(request_id, code: int, message: str, data=None) -> dict:
    """Build a JSON-RPC 2.0 error response envelope."""
    err = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": err}


async def process_jsonrpc(raw_json: str) -> str:
    """Top-level JSON-RPC 2.0 entry point.

    Parses the envelope, routes by method, and returns the JSON-encoded
    response string.  Notifications (no ``id``) return an empty string.
    """
    # --- Parse ---------------------------------------------------------------
    try:
        msg = parse_jsonrpc_request(raw_json)
    except ValueError as exc:
        return json.dumps(build_jsonrpc_error(None, -32700, f"Parse error: {exc}"))

    request_id = msg.get("id")  # None for notifications
    method = msg["method"]
    params = msg.get("params", {})
    is_notification = "id" not in msg

    # --- Notifications must never receive a response (JSON-RPC 2.0 §4.1) ----
    if is_notification:
        # Even unknown notification methods are silently ignored per spec.
        return ""

    # --- Route ---------------------------------------------------------------
    try:
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {
                    "tools": {"listChanged": True},
                    "extensions": SERVICE_MANIFEST.get("supported_extensions", []),
                },
                "serverInfo": {
                    "name": SERVICE_MANIFEST["server"]["name"],
                    "version": SERVICE_MANIFEST["server"]["version"],
                },
            }

        elif method == "notifications/initialized":
            # Defined as notification-only; if sent as a request, return an error.
            return json.dumps(build_jsonrpc_error(
                request_id, -32600,
                "notifications/initialized must be sent as a notification (no id)"))

        elif method == "tools/list":
            result = {"tools": SERVICE_MANIFEST["tools"]}

        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})

            # Build the internal request dict expected by handle_request()
            internal_request: dict[str, Any] = {
                "tool": tool_name,
                "parameters": arguments,
            }
            # Forward optional extension fields.
            # SECURITY NOTE: user_confirmed is a trust-the-client field. In
            # production the confirmation flow should be enforced by the MCP
            # host, not trusted from the wire.
            for key in ("idempotency_key", "transaction_id", "intent",
                        "session_state", "user_confirmed"):
                if key in params:
                    internal_request[key] = params[key]

            # Application-level errors stay inside "result", not JSON-RPC "error"
            result = await handle_request(internal_request)

        else:
            # Unknown method
            return json.dumps(build_jsonrpc_error(
                request_id, -32601, f"Method not found: {method}"))

    except Exception as exc:
        return json.dumps(build_jsonrpc_error(
            request_id, -32603, f"Internal error: {exc}"))

    # --- Respond -------------------------------------------------------------
    return json.dumps(build_jsonrpc_response(request_id, result))


def build_jsonrpc_request(method: str, params=None, request_id=None, is_notification: bool = False) -> str:
    """Build a JSON-RPC 2.0 request string (helper for demos)."""
    msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if not is_notification:
        msg["id"] = request_id
    return json.dumps(msg)


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

    global TICKET_COUNTER
    TICKET_COUNTER += 1
    ticket_id = f"PROJ-{TICKET_COUNTER}"
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

class SessionStateManager:
    """Manages opaque session state tokens.

    SECURITY NOTE: This reference implementation uses plain Base64 encoding for
    clarity. Production implementations MUST use signed tokens (e.g., HMAC-SHA256)
    or encrypted tokens (e.g., AES-GCM) to prevent client-side tampering.
    """

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

    # Auto-incrementing JSON-RPC request ID counter
    _next_id = 0

    def next_id() -> int:
        nonlocal _next_id
        _next_id += 1
        return _next_id

    async def call_tool(name: str, arguments=None, **extra) -> dict:
        """Build a tools/call JSON-RPC envelope, send it, and return the result."""
        params: dict[str, Any] = {"name": name}
        if arguments is not None:
            params["arguments"] = arguments
        params.update(extra)
        req_id = next_id()
        raw_request = build_jsonrpc_request("tools/call", params=params, request_id=req_id)
        print(f"\n  >> Request:  {json.dumps(json.loads(raw_request), indent=2)}")
        raw_response = await process_jsonrpc(raw_request)
        parsed = json.loads(raw_response)
        print(f"  << Response: {json.dumps(parsed, indent=2)}")
        return parsed.get("result", parsed)

    # ----- 0. Initialize handshake -------------------------------------------
    print("\n--- 0. JSON-RPC Initialize ---")
    req_id = next_id()
    raw_req = build_jsonrpc_request("initialize", params={}, request_id=req_id)
    print(f"\n  >> Request:  {json.dumps(json.loads(raw_req), indent=2)}")
    raw_resp = await process_jsonrpc(raw_req)
    print(f"  << Response: {json.dumps(json.loads(raw_resp), indent=2)}")

    # Send initialized notification (no response expected)
    notif = build_jsonrpc_request("notifications/initialized", is_notification=True)
    print(f"\n  >> Notification: {json.dumps(json.loads(notif), indent=2)}")
    resp = await process_jsonrpc(notif)
    print(f"  << (no response for notification)")

    # 1. Service Manifest (Proposal #1)
    print("\n--- 1. Service Manifest ---")
    manifest = await call_tool("get_manifest")
    print(f"Server: {manifest['server']['name']} v{manifest['server']['version']}")
    print(f"Extensions: {', '.join(manifest['supported_extensions'])}")
    print(f"Tools: {', '.join(t['name'] for t in manifest['tools'])}")

    # 2. Permission Check (Proposal #4)
    print("\n--- 2. Permission Check ---")
    check = await call_tool("check_permissions", arguments={"tool": "delete_ticket"})
    print(f"Can delete tickets? {check}")

    # 3. Search with Intent Hint (Proposal #2)
    print("\n--- 3. Search with Intent Hint ---")
    result = await call_tool(
        "search_tickets",
        arguments={"query": "bug"},
        intent="Find the most recent incident from last Friday's deployment",
    )
    print(f"Intent-based suggestion: {result.get('suggestion', 'none')}")

    # 4. Search with Provenance (Proposal #7)
    print("\n--- 4. Search with Provenance ---")
    result = await call_tool("search_tickets", arguments={"status": "open"})
    print(f"Found {result['result']['total_count']} tickets")
    print(f"Provenance: {result['provenance']}")

    # 5. Idempotent Create (Proposal #5)
    print("\n--- 5. Idempotent Create ---")
    idem_key = "create-deploy-ticket-2026-03-15"
    result1 = await call_tool(
        "create_ticket",
        arguments={"title": "Deploy v2.1", "assignee": "charlie"},
        idempotency_key=idem_key,
    )
    print(f"First call — created: {result1['result']['ticket']['id']}, replay: {result1['idempotency']['was_replay']}")

    result2 = await call_tool(
        "create_ticket",
        arguments={"title": "Deploy v2.1", "assignee": "charlie"},
        idempotency_key=idem_key,
    )
    print(f"Second call — replay: {result2['idempotency']['was_replay']}, same ticket: {result2['result']['ticket']['id']}")

    # 6. Human-in-the-Loop (Proposal #6)
    print("\n--- 6. Human-in-the-Loop ---")
    # Temporarily grant delete scope to demonstrate the confirmation flow
    permissions.granted_scopes.add("delete:tickets")

    result = await call_tool(
        "delete_ticket",
        arguments={"ticket_id": "PROJ-2"},
    )
    print(f"Requires confirmation: {result.get('requires_confirmation')}")
    print(f"Message: {result.get('confirmation_message')}")
    print(f"Risk level: {result.get('risk_level')}")

    # Now with explicit user confirmation
    result = await call_tool(
        "delete_ticket",
        arguments={"ticket_id": "PROJ-2"},
        user_confirmed=True,
    )
    print(f"After confirmation: deleted={result.get('deleted')}, ticket={result.get('ticket_id')}")

    # Revoke delete scope again
    permissions.granted_scopes.discard("delete:tickets")

    # 7. Transaction with Rollback (Proposal #5)
    print("\n--- 7. Transaction with Rollback ---")
    tx_id = "tx-migration-001"
    await call_tool("begin_transaction", arguments={"transaction_id": tx_id})
    print(f"Transaction {tx_id} started")

    await call_tool(
        "create_ticket",
        arguments={"title": "Migration step 1"},
        transaction_id=tx_id,
    )
    print("Step 1: ticket created")

    await call_tool(
        "create_ticket",
        arguments={"title": "Migration step 2"},
        transaction_id=tx_id,
    )
    print("Step 2: ticket created")

    # Simulate failure — rollback
    rollback = await call_tool("rollback_transaction", arguments={"transaction_id": tx_id})
    print(f"Rollback result: {rollback}")

    # 8. Session State (Proposal #14)
    print("\n--- 8. Session State ---")
    result = await call_tool("search_tickets", arguments={"status": "open"})
    state_token = result.get("session_state")
    decoded = SessionStateManager.decode(state_token)
    print(f"Session state: {decoded}")

    # 9. Structured Error (Proposal #11)
    print("\n--- 9. Structured Error ---")
    # Grant delete scope temporarily to get past permission check and show the actual error
    permissions.granted_scopes.add("delete:tickets")
    result = await call_tool(
        "delete_ticket",
        arguments={"ticket_id": "NONEXISTENT"},
        user_confirmed=True,
    )
    print(f"Error: {json.dumps(result, indent=2)}")
    permissions.granted_scopes.discard("delete:tickets")

    # 10. Permission Denied Error (Proposal #4 + #11 combined)
    print("\n--- 10. Permission Denied (Proposals #4 + #11) ---")
    result = await call_tool(
        "delete_ticket",
        arguments={"ticket_id": "PROJ-3"},
        user_confirmed=True,
    )
    print(f"Error: {json.dumps(result, indent=2)}")

    print("\n" + "=" * 70)
    print("Demo complete (core extensions).")

    # Additional proposal demos — these are standalone simulations that
    # demonstrate extension concepts (data references, multimodal, discovery,
    # subscriptions) without routing through the JSON-RPC layer, because the
    # features they illustrate (server-to-server data passing, registry queries,
    # event subscriptions) operate outside the single-server request/response
    # flow.  The conformance check does route through JSON-RPC.
    await demo_data_references()
    await demo_multimodal_signatures()
    await demo_conformance_check()
    await demo_server_discovery()
    await demo_subscription()

    print("\n" + "=" * 70)
    print("All demos complete.")


# =============================================================================
# Extension 9: Data References
# =============================================================================

async def demo_data_references():
    """Demonstrate cross-server data references (Proposal #9)."""
    print("\n--- 11. Data References (Proposal #9) ---")

    # Server A exports data and returns a reference
    async def server_a_export(dataset: str) -> dict:
        """Simulate Server A exporting data and returning a reference."""
        ref_id = f"ref-{uuid.uuid4().hex[:12]}"
        data_payload = json.dumps({"tickets": [vars(t) for t in list(TICKETS.values())[:2]]})
        checksum = f"sha256:{uuid.uuid4().hex}"  # Simulated checksum
        return {
            "ref_id": ref_id,
            "origin_server": "project-tracker-mcp",
            "mime_type": "application/json",
            "size_bytes": len(data_payload.encode()),
            "expires_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "") + "Z",
            "access_url": f"https://project-tracker.example.com/refs/{ref_id}",
            "checksum": checksum,
        }

    # Client obtains the reference from Server A
    reference = await server_a_export("open_tickets")
    print(f"Server A returned reference: {reference['ref_id']}")
    print(f"  origin_server: {reference['origin_server']}")
    print(f"  mime_type: {reference['mime_type']}, size_bytes: {reference['size_bytes']}")
    print(f"  access_url: {reference['access_url']}")

    # Server B imports data using the reference
    async def server_b_import(ref: dict) -> dict:
        """Simulate Server B importing data via reference."""
        # In a real implementation, Server B would fetch from access_url
        return {
            "status": "imported",
            "ref_id": ref["ref_id"],
            "origin_server": ref["origin_server"],
            "records_imported": 2,
            "checksum_verified": True,
        }

    import_result = await server_b_import(reference)
    print(f"Server B import result: status={import_result['status']}, "
          f"records={import_result['records_imported']}, "
          f"checksum_verified={import_result['checksum_verified']}")


# =============================================================================
# Extension 10: Multimodal Tool Signatures
# =============================================================================

async def demo_multimodal_signatures():
    """Demonstrate multimodal tool signatures (Proposal #10)."""
    print("\n--- 12. Multimodal Tool Signatures (Proposal #10) ---")

    # Define a tool with explicit input/output type annotations
    tool_definition = {
        "name": "analyze_image",
        "description": "Analyze an image and return structured JSON results.",
        "input_types": ["image/png", "image/jpeg"],
        "output_types": ["application/json"],
        "max_input_size_bytes": 10 * 1024 * 1024,  # 10 MB
        "input_schema": {
            "type": "object",
            "required": ["image_data", "analysis_type"],
            "properties": {
                "image_data": {"type": "string", "description": "Base64-encoded image"},
                "analysis_type": {"type": "string", "enum": ["labels", "objects", "text"]},
            },
        },
    }

    print(f"Tool: {tool_definition['name']}")
    print(f"  Accepts: {', '.join(tool_definition['input_types'])}")
    print(f"  Returns: {', '.join(tool_definition['output_types'])}")
    print(f"  Max input size: {tool_definition['max_input_size_bytes']} bytes")

    # Simulate a client calling this tool with a binary payload
    fake_image_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64  # Minimal PNG-like header
    request_payload = {
        "tool": "analyze_image",
        "parameters": {
            "image_data": base64.b64encode(fake_image_bytes).decode(),
            "analysis_type": "labels",
        },
        "content_type": "image/png",
    }

    print(f"  Client sends {len(fake_image_bytes)} bytes as {request_payload['content_type']}")

    # Simulate the tool returning a structured JSON result
    analysis_result = {
        "labels": [
            {"name": "architecture_diagram", "confidence": 0.92},
            {"name": "flowchart", "confidence": 0.87},
            {"name": "technical_drawing", "confidence": 0.65},
        ],
        "image_dimensions": {"width": 1024, "height": 768},
        "analysis_type": "labels",
    }

    print(f"  Result: {json.dumps(analysis_result, indent=4)}")


# =============================================================================
# Extension 12: Conformance Check
# =============================================================================

async def demo_conformance_check():
    """Demonstrate a conformance test suite (Proposal #12)."""
    print("\n--- 13. Conformance Check (Proposal #12) ---")

    # Define a mini test suite — each test uses JSON-RPC via process_jsonrpc()
    _conf_id = 0

    def conf_id() -> int:
        nonlocal _conf_id
        _conf_id += 1
        return 1000 + _conf_id

    test_suite = [
        {
            "test_id": "CONF-001",
            "description": "Server returns a valid manifest on get_manifest",
            "request": build_jsonrpc_request("tools/call", params={"name": "get_manifest", "arguments": {}}, request_id=conf_id()),
            "expected": lambda r: "result" in r and "server" in r["result"] and "tools" in r["result"],
        },
        {
            "test_id": "CONF-002",
            "description": "Permission check returns allowed=True for granted scope",
            "request": build_jsonrpc_request("tools/call", params={"name": "check_permissions", "arguments": {"tool": "search_tickets"}}, request_id=conf_id()),
            "expected": lambda r: "result" in r and r["result"].get("allowed") is True,
        },
        {
            "test_id": "CONF-003",
            "description": "Permission check returns allowed=False for missing scope",
            "request": build_jsonrpc_request("tools/call", params={"name": "check_permissions", "arguments": {"tool": "delete_ticket"}}, request_id=conf_id()),
            "expected": lambda r: "result" in r and r["result"].get("allowed") is False,
        },
        {
            "test_id": "CONF-004",
            "description": "Structured error returned for unknown tool",
            "request": build_jsonrpc_request("tools/call", params={"name": "nonexistent_tool", "arguments": {}}, request_id=conf_id()),
            "expected": lambda r: "result" in r and "error" in r["result"],
        },
        {
            "test_id": "CONF-005",
            "description": "tools/list returns tool array",
            "request": build_jsonrpc_request("tools/list", request_id=conf_id()),
            "expected": lambda r: "result" in r and "tools" in r["result"] and len(r["result"]["tools"]) > 0,
        },
        {
            "test_id": "CONF-006",
            "description": "Unknown method returns -32601 error",
            "request": build_jsonrpc_request("nonexistent/method", request_id=conf_id()),
            "expected": lambda r: "error" in r and r["error"]["code"] == -32601,
        },
        {
            "test_id": "CONF-007",
            "description": "Invalid JSON returns -32700 parse error",
            "request": "this is not valid json{{{",
            "expected": lambda r: "error" in r and r["error"]["code"] == -32700,
        },
    ]

    # Run tests against the server via JSON-RPC
    passed = 0
    failed = 0
    results = []

    for test in test_suite:
        raw_response = await process_jsonrpc(test["request"])
        response = json.loads(raw_response)
        success = test["expected"](response)
        status = "PASSED" if success else "FAILED"
        if success:
            passed += 1
        else:
            failed += 1
        results.append({"test_id": test["test_id"], "status": status, "description": test["description"]})
        print(f"  [{status}] {test['test_id']}: {test['description']}")

    # Produce conformance report
    report = {
        "conformance_report": {
            "server": "project-tracker-mcp",
            "total_tests": len(test_suite),
            "passed": passed,
            "failed": failed,
            "pass_rate": f"{(passed / len(test_suite)) * 100:.0f}%",
            "results": results,
        }
    }
    print(f"  Report: {passed}/{len(test_suite)} passed ({report['conformance_report']['pass_rate']})")


# =============================================================================
# Extension 13: Server Discovery
# =============================================================================

async def demo_server_discovery():
    """Demonstrate server discovery (Proposal #13)."""
    print("\n--- 14. Server Discovery (Proposal #13) ---")

    # Simulated registry of known servers
    registry = [
        {
            "server_name": "figma-mcp",
            "description": "Design tool integration for creating and editing mockups.",
            "capabilities": ["design_mockup", "export_assets", "design_system"],
            "registry_url": "https://registry.mcp.example.com/servers/figma-mcp",
            "auth_flow": "oauth2_authorization_code",
            "version": "2.3.0",
        },
        {
            "server_name": "canva-mcp",
            "description": "Quick design mockups and social media graphics.",
            "capabilities": ["design_mockup", "social_media_graphics"],
            "registry_url": "https://registry.mcp.example.com/servers/canva-mcp",
            "auth_flow": "api_key",
            "version": "1.1.0",
        },
        {
            "server_name": "miro-mcp",
            "description": "Collaborative whiteboarding and diagramming.",
            "capabilities": ["whiteboard", "diagramming", "design_mockup"],
            "registry_url": "https://registry.mcp.example.com/servers/miro-mcp",
            "auth_flow": "oauth2_device",
            "version": "3.0.1",
        },
    ]

    # Query for a capability
    capability_needed = "design_mockup"
    print(f"Searching for servers with capability: '{capability_needed}'")

    recommendations = []
    for server in registry:
        if capability_needed in server["capabilities"]:
            # Compute a simple match confidence based on capability relevance
            total_caps = len(server["capabilities"])
            match_confidence = round(1.0 / total_caps, 2)  # Higher if more focused
            recommendations.append({
                "server_name": server["server_name"],
                "registry_url": server["registry_url"],
                "auth_flow": server["auth_flow"],
                "match_confidence": match_confidence,
            })

    # Sort by confidence descending
    recommendations.sort(key=lambda r: r["match_confidence"], reverse=True)

    for rec in recommendations:
        print(f"  Recommended: {rec['server_name']} "
              f"(confidence={rec['match_confidence']}, auth={rec['auth_flow']})")
        print(f"    registry_url: {rec['registry_url']}")

    # Show how a client would connect to the top recommendation
    if recommendations:
        top = recommendations[0]
        print(f"\n  Client would connect to '{top['server_name']}' via:")
        print(f"    1. Fetch manifest from {top['registry_url']}/manifest")
        print(f"    2. Authenticate using {top['auth_flow']}")
        print(f"    3. Call tools with capability '{capability_needed}'")


# =============================================================================
# Extension 15: Subscriptions
# =============================================================================

async def demo_subscription():
    """Demonstrate event subscriptions (Proposal #15)."""
    print("\n--- 15. Event Subscriptions (Proposal #15) ---")

    # In-memory subscription manager
    subscriptions: dict[str, dict] = {}

    async def subscribe(events: list[str], filter_params: dict | None = None) -> dict:
        """Subscribe to server-sent events."""
        sub_id = f"sub-{uuid.uuid4().hex[:8]}"
        subscriptions[sub_id] = {
            "subscription_id": sub_id,
            "events": events,
            "filter": filter_params or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "active",
        }
        return subscriptions[sub_id]

    async def emit_event(sub_id: str, event_type: str, payload: dict) -> dict:
        """Simulate emitting an event notification to a subscriber."""
        return {
            "subscription_id": sub_id,
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }

    async def unsubscribe(sub_id: str) -> dict:
        """Cancel a subscription."""
        if sub_id in subscriptions:
            subscriptions[sub_id]["status"] = "cancelled"
            return {"subscription_id": sub_id, "status": "cancelled"}
        return {"error": "subscription_not_found", "subscription_id": sub_id}

    # Subscribe to events
    sub = await subscribe(
        events=["commit_to_main", "pr_review_requested"],
        filter_params={"repo": "example/project-tracker-mcp", "branch": "main"},
    )
    print(f"Subscribed: {sub['subscription_id']}")
    print(f"  Events: {sub['events']}")
    print(f"  Filter: {sub['filter']}")

    # Simulate receiving event notifications
    events_received = [
        await emit_event(sub["subscription_id"], "commit_to_main", {
            "commit_sha": "a1b2c3d",
            "author": "alice",
            "message": "Fix login redirect loop",
        }),
        await emit_event(sub["subscription_id"], "pr_review_requested", {
            "pr_number": 142,
            "title": "Add dark mode support",
            "reviewer": "bob",
        }),
        await emit_event(sub["subscription_id"], "commit_to_main", {
            "commit_sha": "e4f5g6h",
            "author": "charlie",
            "message": "Update CI pipeline config",
        }),
    ]

    for evt in events_received:
        print(f"  Event: {evt['event_type']} at {evt['timestamp']}")
        print(f"    Payload: {evt['payload']}")

    # Unsubscribe
    unsub = await unsubscribe(sub["subscription_id"])
    print(f"Unsubscribed: {unsub['subscription_id']}, status={unsub['status']}")


if __name__ == "__main__":
    asyncio.run(demo())
