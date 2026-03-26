# Proposal 7: Provenance

## Spec References Examined

- **`tools/call` response** (MCP 2025-11-25) — Returns a `content` array with typed content blocks (`text`, `image`, `audio`, `resource`). Each block has a `type` and data fields, but no source attribution, provenance chain, or origin metadata.
- **Resource contents** (MCP 2025-11-25) — Resources have `uri`, `name`, `description`, and `mimeType`. The URI identifies where data lives but does not constitute provenance metadata (who produced it, when, from what sources, with what confidence).
- **Extensions framework (GA)** — Allows extending protocol messages with custom metadata. This is the intended mechanism for attaching provenance information to tool responses.

## Current Coverage

The spec provides no mechanism for source attribution on tool responses. When a tool returns data, the client receives the data but has no protocol-level information about where it came from, how it was derived, when it was produced, or how trustworthy it is.

Resource URIs identify data locations but do not constitute provenance — knowing a resource is at `file:///data/report.csv` says nothing about who generated it, what sources fed into it, or whether it is current.

## Remaining Gap

- **Source attribution**: No mechanism to attach source information to tool response content (e.g., "this data came from the GitHub API, fetched at 2025-11-20T14:30:00Z").
- **Derivation chain**: No way to express that a result was derived from other sources or through a transformation pipeline (e.g., "summarized from 3 documents: A, B, C").
- **Confidence/freshness metadata**: No mechanism to indicate data freshness (e.g., "cached, last updated 2 hours ago") or confidence levels (e.g., "high confidence" vs. "approximate").
- **License and usage rights**: No mechanism to attach licensing or usage-rights information to returned data.
- **Audit trail**: No protocol-level support for maintaining an audit trail of data provenance across multiple tool calls in a session.

## Design Changes Required

- Define an MCP Extension that attaches provenance metadata to content blocks in `tools/call` responses, using the Extensions framework.
- Define a provenance schema that includes source URIs, timestamps, derivation chains, confidence levels, and optionally license information.
- Ensure the extension is optional and non-breaking — responses without provenance metadata are treated as having unknown provenance.

## Verdict

**Gap** — The spec has no source attribution mechanism on tool responses. Provenance metadata is entirely absent from the protocol. The Extensions framework provides the integration point for this proposal.
