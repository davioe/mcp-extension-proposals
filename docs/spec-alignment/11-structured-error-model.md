# Proposal 11: Structured Error Model

## Spec References Examined

- **JSON-RPC error codes** (MCP 2025-11-25) — Standard JSON-RPC error codes: -32700 (Parse error), -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal error). These are transport-level errors, not application-level errors.
- **Tool Execution Errors (SEP-1303)** (MCP 2025-11-25) — When a tool fails at the application level, the server returns a normal `tools/call` response with `isError: true` on a content block. The error message is a human-readable string. This distinguishes "the tool ran but failed" from "the protocol request failed" but provides no structured error metadata.
- **Extensions framework (GA)** — Allows extending protocol messages with custom metadata. This is the intended mechanism for structured error extensions.

## Current Coverage

The spec provides two levels of error reporting:

1. **Protocol-level errors**: JSON-RPC error codes cover transport and protocol failures (malformed requests, unknown methods, invalid parameters). These are well-defined but not extensible for application-level semantics.
2. **Tool execution errors**: `isError: true` on content blocks indicates that a tool call failed at the application level. The error is reported as a human-readable text content block. This separates tool failures from protocol failures but provides no machine-readable error structure.

Together, these cover "did the request fail?" (protocol) and "did the tool fail?" (application) but not "why did it fail, what should I do about it, and when can I retry?"

## Remaining Gap

- **Error category/classification**: No `category` field to classify errors (e.g., `authentication`, `rate_limit`, `validation`, `upstream_failure`, `permission_denied`). Clients cannot programmatically handle different error types.
- **Retry semantics**: No `retry_after_seconds` field. When a tool fails due to rate limiting or transient errors, clients have no protocol-level guidance on when to retry.
- **User-actionable flag**: No `user_actionable` boolean to indicate whether the error requires human intervention (e.g., "re-authenticate") vs. can be retried automatically.
- **Suggestion field**: No `suggestion` field for machine-readable remediation hints (e.g., "reduce batch size" or "use tool X instead").
- **Error codes/identifiers**: No stable error code system beyond JSON-RPC codes. Application errors are identified only by human-readable strings, making programmatic handling fragile.
- **Structured retry semantics**: No protocol-level retry policy (e.g., exponential backoff guidance, maximum retries, jitter recommendations).

## Design Changes Required

- Define an MCP Extension that adds structured error metadata to tool execution error responses, using the Extensions framework. Fields: `category`, `error_code`, `retry_after_seconds`, `user_actionable`, `suggestion`.
- Define a standard taxonomy of error categories and error codes.
- Ensure the extension coexists with the existing `isError` mechanism — structured metadata is additional context on top of the existing error reporting.

## Verdict

**Gap** — The spec provides basic error reporting (JSON-RPC codes for protocol errors, `isError` for tool execution errors) but no structured error metadata. There is no `category`, `retry_after_seconds`, `user_actionable`, `suggestion`, or structured retry semantics. The Extensions framework provides the integration point for this proposal.
