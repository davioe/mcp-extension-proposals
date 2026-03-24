# SEP-0000: Human-in-the-Loop Confirmation Protocol

| Field | Value |
|-------|-------|
| **Title** | Human-in-the-Loop Confirmation Protocol |
| **Author** | davioe |
| **Status** | Draft |
| **Type** | Extensions Track |
| **Created** | 2026-03-25 |

## Abstract

This SEP proposes a standardized confirmation protocol for MCP tool calls that require explicit user approval before execution. Tools declare a `requires_confirmation` flag and a `risk_level` enum (`safe`, `reversible`, `destructive`) in their definitions. When a client invokes a tool with `requires_confirmation: true`, it MUST obtain user approval before the server executes the operation. This extends the existing `destructiveHint` annotation from an advisory signal into an enforceable safety gate.

## Motivation

The current MCP specification provides `destructiveHint` and `readOnlyHint` annotations on tool definitions. These are advisory — clients MAY use them to decide whether to prompt for confirmation, but there is no protocol-level enforcement. This creates a safety gap:

- **No mandatory gates.** A client can silently execute `delete_repository` without ever prompting the user, even when the server has explicitly flagged the tool as destructive.
- **No confirmation protocol.** There is no standardized exchange for "server says pause, client gets approval, client confirms." Each client implements its own confirmation logic (or doesn't).
- **No risk taxonomy.** The binary `destructiveHint` does not distinguish between "this creates a reversible draft" and "this permanently deletes all data." Clients cannot make graduated UI decisions.

For enterprise adoption, this gap is a blocker. Organizations will not deploy agents that can execute destructive operations without enforceable confirmation gates.

### Relationship to Elicitation

The spec's elicitation mechanism (form mode and URL mode) enables servers to request user input — but it is designed for data gathering, not for confirmation gates. Elicitation is server-initiated (the server decides when to ask) and returns structured data. The HITL confirmation protocol is tool-definition-level (declared upfront) and returns a simple approve/deny signal. The two mechanisms serve different purposes and can coexist.

## Specification

### Tool Definition

Tools that require confirmation declare it in their definition:

```json
{
  "name": "delete_repository",
  "description": "Permanently delete a repository and all its contents",
  "inputSchema": { ... },
  "requires_confirmation": true,
  "confirmation_message": "This will permanently delete the repository '{name}' and all its contents, including issues, PRs, and wiki. This action cannot be undone.",
  "risk_level": "destructive"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requires_confirmation` | boolean | No | When `true`, client MUST obtain user approval before execution. Defaults to `false`. |
| `confirmation_message` | string | Conditional | Required when `requires_confirmation` is `true`. May contain `{parameter_name}` placeholders that the client fills from the call arguments. |
| `risk_level` | enum | No | One of: `safe` (no side effects), `reversible` (can be undone), `destructive` (permanent, irreversible). Defaults to `safe`. |

### Confirmation Flow

```
Client → Server: tools/call("delete_repository", {name: "frontend-app"})
Server → Client: requires_confirmation response
  {
    "status": "confirmation_required",
    "confirmation_message": "This will permanently delete the repository 'frontend-app'...",
    "risk_level": "destructive",
    "confirmation_token": "conf-abc123"
  }
Client → User: Display confirmation dialog with risk-appropriate UI
User → Client: Approved (or Denied)
Client → Server: tools/call("delete_repository", {name: "frontend-app"},
  _meta: { "confirmation_token": "conf-abc123", "user_confirmed": true })
Server → Client: { "deleted": true }
```

### Client Behavior

- When a tool has `requires_confirmation: true`, the client MUST NOT execute the tool without user approval.
- The client SHOULD use `risk_level` to determine UI treatment:
  - `safe`: Standard execution, no special treatment
  - `reversible`: Yellow/warning confirmation dialog
  - `destructive`: Red/danger confirmation dialog with explicit "type to confirm" for critical operations
- If the user denies confirmation, the client MUST NOT send the confirmed call. It SHOULD inform the user and the LLM that the operation was declined.
- The `confirmation_token` prevents replay attacks — the server generates a unique token for each confirmation request that expires after a short window.

### Coexistence with `destructiveHint`

- `destructiveHint` remains an advisory annotation for backward compatibility.
- `requires_confirmation` is the enforceable mechanism.
- Servers SHOULD set both: `destructiveHint: true` for older clients, `requires_confirmation: true` for clients that support this extension.

### Capability Negotiation

```json
{
  "supported_extensions": ["human_in_the_loop"]
}
```

Clients that do not support this extension treat `requires_confirmation` tools like any other tool. The server MAY refuse to execute unconfirmed calls to such tools, returning an error with `category: "permanent"` and a suggestion to use a client that supports confirmation.

## Rationale

### Why not use elicitation for confirmation?

Elicitation is a general-purpose data gathering mechanism — it creates forms, collects structured input, and returns it to the server. Using elicitation for binary approve/deny confirmation would work technically but conflates two distinct concerns: "I need information from the user" vs. "I need approval before proceeding." Separating them allows clients to implement appropriate UI for each (form vs. confirmation dialog) and keeps the confirmation protocol lightweight.

### Why a `risk_level` enum instead of a numeric severity?

Three levels (`safe`, `reversible`, `destructive`) map to three distinct UI treatments. More granular severity (1-10 scale) would create ambiguity about where to draw the line between "show a warning" and "require explicit confirmation." The enum forces a clear design decision at the server level.

### Limitation: Latency in High-Throughput Workflows

Mandatory confirmation adds latency to every destructive operation. In bulk workflows (e.g., "delete 50 stale tickets"), requiring per-operation confirmation is impractical. A future extension could add batch confirmation ("approve all 50 deletions at once") or a trust-level escalation mechanism ("this session has elevated permissions for the next 10 minutes").

## Backward Compatibility

Fully backward-compatible:

- Servers that do not support this extension never set `requires_confirmation`.
- Clients that do not support this extension ignore the field and call tools normally. Servers MAY then refuse execution with an appropriate error.
- The `risk_level` field is purely informational for client UI — ignoring it does not break the protocol.

## Reference Implementation

- Python: `examples/python/server.py` — HITL logic in `handle_request()` and Step 6 of the `demo()` function
- TypeScript: `examples/typescript/server.ts` — HITL logic in `handleRequest()` and Step 6 of the `demo()` function
- Schema: `requires_confirmation`, `confirmation_message`, and `risk_level` fields in `schemas/service-manifest.schema.json`

## Security Implications

- **Confirmation token expiry.** Tokens MUST expire after a short window (recommended: 5 minutes) to prevent replay attacks where a stale approval is used to execute a later destructive operation.
- **Token binding.** Tokens MUST be bound to the specific tool call parameters — approving `delete_repository(name: "test-repo")` must not authorize `delete_repository(name: "production-db")`.
- **Client trust.** The `user_confirmed: true` flag comes from the client. A malicious client could set this flag without actually prompting the user. Servers in high-security environments SHOULD use elicitation URL mode for an independent confirmation channel that bypasses the client.
