# SEP-0000: Structured Error Model for MCP

| Field | Value |
|-------|-------|
| **Title** | Structured Error Model |
| **Author** | davioe |
| **Status** | Draft |
| **Type** | Standards Track |
| **Created** | 2026-03-25 |

## Abstract

This SEP proposes a standardized structured error schema for MCP tool responses that goes beyond JSON-RPC error codes. The schema adds machine-readable fields for error categorization (`transient`, `permanent`, `auth_required`, `invalid_input`, `rate_limited`), retry semantics (`retry_after_seconds`), user-actionability flags, and concrete remediation suggestions. This enables clients to implement intelligent retry logic, surface meaningful error messages to users, and make informed decisions about alternative approaches — without requiring per-server error handling logic.

## Motivation

The current MCP specification uses standard JSON-RPC error codes (`-32600` through `-32700`) and MCP-specific codes (`-32001`, `-32002`). These codes communicate *what* went wrong at the protocol level but not *how* a client should respond:

- **No retry semantics.** A client receiving `-32603` (Internal error) cannot know whether to retry immediately, wait 42 seconds, or give up. Rate-limited requests are indistinguishable from permanent failures.
- **No user-facing guidance.** Clients cannot determine whether an error should be surfaced to the user ("Your API key expired") or handled silently ("Transient network issue, retrying...").
- **No remediation path.** When a query exceeds a rate limit, the server cannot suggest "narrow the date range to reduce query cost" in a structured, machine-readable way.

This forces every client to implement ad-hoc error parsing for each server, or fall back to displaying raw error messages that are often unhelpful to users.

### Real-World Failure Scenarios

1. **Rate limiting without retry guidance.** An agent querying an analytics server receives error code `-32603`. It retries immediately 3 times, making the rate limit worse. With `category: "rate_limited"` and `retry_after_seconds: 42`, the agent waits appropriately.

2. **Auth expiry without user escalation.** A server returns an error because the OAuth token expired. The client retries the same request repeatedly. With `category: "auth_required"` and `user_actionable: true`, the client prompts the user to re-authenticate.

3. **Scope escalation without guidance.** A tool call fails because the user lacks write permissions. With `suggestion: "Request the write:issues scope to perform this action"`, the client can proactively guide scope elevation.

## Specification

### Error Response Schema

When a tool call fails, the server SHOULD return an error response conforming to this schema. The schema extends (does not replace) the standard JSON-RPC error object:

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "API rate limit reached. Retry available in 42 seconds.",
  "category": "rate_limited",
  "retry_after_seconds": 42,
  "user_actionable": true,
  "suggestion": "You could narrow the date range to reduce the query cost.",
  "details": {},
  "documentation_url": "https://docs.example.com/errors/rate-limits"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Machine-readable error code. Recommended codes: `RATE_LIMIT_EXCEEDED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `INVALID_PARAMETERS`, `QUOTA_EXHAUSTED`, `AUTHENTICATION_REQUIRED`, `TOKEN_EXPIRED`, `CONFLICT`, `SERVER_ERROR`, `UPSTREAM_ERROR`, `TIMEOUT`, `UNSUPPORTED_OPERATION` |
| `message` | string | Yes | Human-readable error description |
| `category` | enum | Yes | One of: `transient`, `permanent`, `auth_required`, `invalid_input`, `rate_limited` |
| `retry_after_seconds` | integer | No | When to retry (seconds). Required when `category` is `transient` or `rate_limited` |
| `user_actionable` | boolean | No | Whether to surface this error to the user. Defaults to `false` |
| `suggestion` | string | No | Concrete next step the client or user can take |
| `details` | object | No | Additional structured context (server-specific) |
| `documentation_url` | string (URI) | No | Link to detailed documentation about this error |

### Client Behavior

- When `category` is `transient` or `rate_limited`, the client SHOULD retry after `retry_after_seconds` (if provided) or use exponential backoff.
- When `category` is `permanent` or `invalid_input`, the client MUST NOT retry the same request.
- When `category` is `auth_required`, the client SHOULD initiate re-authentication (via elicitation or OAuth refresh) before retrying.
- When `user_actionable` is `true`, the client SHOULD surface the `message` and `suggestion` to the user.

### Capability Negotiation

Servers declare structured error support in the service manifest:

```json
{
  "supported_extensions": ["structured_errors"]
}
```

Clients that do not support structured errors gracefully degrade — the standard JSON-RPC error object remains present and functional.

## Rationale

### Why a new error schema instead of extending JSON-RPC error codes?

JSON-RPC error codes are numeric and transport-level. They communicate protocol violations, not application-level failure modes. Adding application semantics (retry timing, user actionability, remediation suggestions) to numeric codes would require a registry of hundreds of codes and break the clean separation between protocol and application errors.

### Why `category` instead of more granular error types?

Five categories (`transient`, `permanent`, `auth_required`, `invalid_input`, `rate_limited`) cover the retry decision tree exhaustively. More granular types (e.g., separating "database error" from "upstream API error") would require clients to understand server implementation details. The `code` field provides granularity for logging and debugging without affecting retry logic.

### Alternatives Considered

- **HTTP status code mapping.** Rejected because MCP is transport-agnostic — not all transports have HTTP status codes. Additionally, HTTP status codes lack the `suggestion` and `user_actionable` fields that make this proposal useful for LLM-driven agents.
- **gRPC status codes.** Considered as a model. gRPC's 16 status codes influenced this design, but gRPC codes lack retry semantics and user-actionability. The `category` field is a simplified mapping of gRPC concepts.
- **Custom error namespaces per server.** Rejected because it defeats the purpose of standardization. Every client would still need per-server error handling.

## Backward Compatibility

This proposal is fully backward-compatible:

- The structured error schema extends the existing JSON-RPC error object — it does not replace it. The `code` (numeric), `message`, and `data` fields from JSON-RPC remain valid.
- Servers that do not support structured errors continue to work unchanged.
- Clients that do not understand structured errors can ignore the additional fields and fall back to the standard JSON-RPC error handling.
- The `supported_extensions: ["structured_errors"]` capability flag enables graceful feature detection.

## Reference Implementation

Reference implementations in Python and TypeScript are available at:
- `examples/python/server.py` — structured error handling in the `StructuredError` class and Step 9 of the `demo()` function
- `examples/typescript/server.ts` — structured error handling in the `StructuredError` class and Step 9 of the `demo()` function

The JSON Schema for the error model is at `schemas/error.schema.json`.

## Security Implications

- The `suggestion` field MUST NOT contain security-sensitive guidance (e.g., "try a different API key," "use admin credentials"). Malicious clients could use such suggestions for social engineering.
- The `documentation_url` field MUST use HTTPS. Clients SHOULD validate that the URL domain matches the server's declared identity.
- The `details` object MUST NOT expose internal server state (stack traces, database queries, internal IP addresses) in production environments.
