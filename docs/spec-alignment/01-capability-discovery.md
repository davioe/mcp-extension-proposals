# Proposal 1: Capability Discovery & Manifest

## Spec References Examined

- **`initialize` capabilities exchange** (MCP 2025-11-25) — During connection setup, client and server exchange `capabilities` objects declaring supported features (e.g., `tools`, `resources`, `prompts`, `logging`). This is a binary feature-flag mechanism — a capability is either present or absent. No operational metadata (rate limits, quotas, cost, latency per tool) is exchanged.
- **`tools/list` with `outputSchema`** (MCP 2025-11-25) — Returns tool definitions including `name`, `description`, `inputSchema`, and `outputSchema`. The `outputSchema` addition closes the typed-output gap, allowing clients to know the shape of a tool's response before calling it. However, no operational metadata is attached to tool definitions.
- **Tool `annotations`** (MCP 2025-11-25) — Provides advisory hints: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. These describe behavioral characteristics but not operational constraints (rate limits, cost, latency).
- **`listChanged` notification** (MCP 2025-11-25) — Servers can notify clients when the tool list changes, prompting re-introspection via `tools/list`. This is a reactive mechanism — the client must re-fetch the full list. No incremental diff or runtime re-introspection of individual tool metadata is provided.
- **Extensions framework (GA)** — Allows servers to declare custom capabilities and metadata beyond the core spec. This is the intended mechanism for proposals like this one to extend the protocol.

## Current Coverage

The spec provides three relevant mechanisms:

1. **Feature-level capability exchange**: The `initialize` handshake lets both sides declare what protocol features they support. This covers "does this server support tools?" but not "what are the operational characteristics of each tool?"
2. **Typed tool definitions**: `tools/list` with `inputSchema` and `outputSchema` gives clients full type information for tool inputs and outputs. Combined with `annotations`, clients can reason about tool behavior (read-only, destructive, idempotent).
3. **List change notifications**: `listChanged` allows servers to signal that their tool inventory has changed, enabling clients to stay in sync.

Together, these cover structural discovery (what tools exist, what they accept, what they return, how they behave) but not operational discovery (how fast, how expensive, what limits apply).

## Remaining Gap

- **Rate limit metadata**: No mechanism to declare per-tool or per-server rate limits (e.g., "10 calls per minute" or "100 calls per day"). Clients cannot proactively avoid throttling.
- **Cost metadata**: No way to attach cost information to tool definitions (e.g., "$0.01 per call" or "consumes 1 API credit"). Clients and users cannot make cost-aware decisions before invoking a tool.
- **Latency metadata**: No expected latency or SLA information on tool definitions (e.g., "typically responds in 200ms" or "may take up to 30 seconds"). Clients cannot set appropriate timeouts or manage user expectations.
- **Quota metadata**: No mechanism to report remaining quota or usage limits (e.g., "42 of 100 daily calls remaining"). This requires runtime state, not just static definitions.
- **Runtime re-introspection**: `listChanged` triggers a full re-fetch of the tool list. There is no mechanism to query metadata for a single tool, subscribe to metadata changes, or receive incremental updates.

## Design Changes Required

- Define an MCP Extension that attaches operational metadata (`rate_limits`, `cost`, `latency`, `quota`) to tool definitions, using the Extensions framework.
- Consider whether operational metadata should be static (declared at `tools/list` time) or dynamic (queryable at runtime), or both.
- Ensure the extension degrades gracefully — servers that do not support operational metadata simply omit the extension fields, and clients that do not understand them ignore the extra data.

## Verdict

**Partially Addressed** — The spec provides robust structural discovery (typed tool definitions, behavioral annotations, change notifications) but has no mechanism for operational metadata (rate limits, cost, latency, quotas). The Extensions framework provides the integration point for this proposal.
