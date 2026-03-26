# Proposal 3: Cost & Latency Transparency

## Spec References Examined

- **`tools/list` with `outputSchema`** (MCP 2025-11-25) — Tool definitions include `name`, `description`, `inputSchema`, `outputSchema`, and `annotations`. No fields exist for cost, latency, or quota information.
- **Tool `annotations`** (MCP 2025-11-25) — Advisory hints: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. The `openWorldHint` indicates whether a tool interacts with external systems, but carries no financial or performance metadata.
- **Extensions framework (GA)** — Allows servers to declare custom metadata on tool definitions and responses. This is the intended mechanism for cost and latency transparency.

## Current Coverage

The spec provides no cost, latency, or quota metadata on tool definitions or tool responses. The `annotations` object includes behavioral hints but nothing financial or performance-related. A client cannot determine before invocation whether a tool call will cost money, how long it is expected to take, or whether it will consume a limited resource.

## Remaining Gap

- **Cost metadata**: No mechanism to declare per-call cost (e.g., `cost_per_call: {amount: 0.01, currency: "USD"}`), pricing tiers, or billing implications on tool definitions.
- **Latency metadata**: No expected latency, P50/P99 latency, or timeout recommendations on tool definitions (e.g., `expected_latency_ms: 200`).
- **Quota metadata**: No mechanism to report usage limits or remaining quota (e.g., `daily_limit: 100`, `remaining: 42`). This requires both static limits and dynamic runtime state.
- **Cost reporting on responses**: No mechanism for servers to report actual cost incurred in a tool response (e.g., "this call consumed 3 API credits").
- **Budget controls**: No protocol-level mechanism for clients to set spending limits or for servers to reject calls that would exceed a budget.

## Design Changes Required

- Define an MCP Extension that attaches cost and latency metadata to tool definitions in `tools/list` responses, using the Extensions framework.
- Define an MCP Extension for runtime cost reporting on `tools/call` responses.
- Consider whether quota information should be static (declared once) or dynamic (updated per-call), and design accordingly.

## Verdict

**Gap** — The spec has no cost, latency, or quota metadata on tool definitions or responses. The `annotations` object includes `openWorldHint` but nothing financial or performance-related. The Extensions framework provides the integration point for this proposal.
