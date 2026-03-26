# Proposal 5: Idempotency & Transactions

## Spec References Examined

- **`idempotentHint` annotation** (MCP 2025-11-25) — An advisory boolean hint on tool definitions indicating that calling the tool multiple times with the same arguments has the same effect as calling it once. This is informational only — it tells clients the tool is safe to retry, but provides no wire-level mechanism to ensure idempotency.
- **`tools/call` request** (MCP 2025-11-25) — Sends `name` and `arguments`. No `idempotency_key` field, no `transaction_id`, no compensation or rollback mechanism.
- **Extensions framework (GA)** — Allows extending protocol messages with custom fields. This is the intended mechanism for adding idempotency keys and transaction primitives.

## Current Coverage

The spec provides a single relevant mechanism:

1. **Idempotent hint**: The `idempotentHint` annotation lets servers declare that a tool is idempotent. Clients can use this to decide whether retrying a failed call is safe. However, this is advisory — there is no protocol-level guarantee or deduplication mechanism.

This covers "is it safe to retry?" but not "how do I ensure exactly-once execution?" or "how do I coordinate multi-step operations?"

## Remaining Gap

- **Wire-level idempotency keys**: No `idempotency_key` field on `tools/call` requests. Servers cannot deduplicate retried calls. If a client retries a call due to a network failure, the server has no way to know it already processed the same logical request.
- **Transaction primitives**: No `transaction_id`, `begin_transaction`, `commit`, or `rollback` mechanism. Multi-step operations across tools cannot be coordinated atomically.
- **Compensation/rollback protocol**: No mechanism for undoing the effects of a completed tool call. If step 3 of a 5-step workflow fails, there is no protocol-level way to compensate steps 1 and 2.
- **Saga coordination**: No cross-server transaction coordination. The cross-server Saga design (plan Unit 4) addresses this core gap, but it requires wire-level idempotency keys as a foundation.

## Design Changes Required

- Define an MCP Extension that adds an `idempotency_key` field to `tools/call` requests, using the Extensions framework. Servers that support the extension use the key for deduplication.
- Define transaction coordination primitives (begin, commit, rollback) as an extension, or as a higher-level Saga protocol built on idempotency keys.
- Ensure backward compatibility — servers that do not support idempotency keys process calls normally, ignoring the extra field.
- Note: This is a core gap that the cross-server Saga design (plan Unit 4) addresses.

## Verdict

**Gap** — The `idempotentHint` annotation is advisory only, providing no wire-level idempotency key mechanism. There are no transaction primitives, no compensation protocol, and no cross-server coordination. The Extensions framework provides the integration point for this proposal.
