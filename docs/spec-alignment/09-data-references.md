# Proposal 9: Data References

## Spec References Examined

- **`tools/call` response content** (MCP 2025-11-25) — Tool results are returned as a `content` array with inline data: `text` (string), `image` (base64), `audio` (base64), or `resource` (embedded resource contents). All data flows through the client as part of the JSON-RPC response. There is no reference/pointer mechanism for server-to-server data transfer.
- **Resources** (MCP 2025-11-25) — Resources are identified by URIs and their contents are read via `resources/read`. The client always mediates — there is no mechanism for one server to reference data held by another server without the client fetching and forwarding it.
- **SEP-2093 (Resource Contents Metadata, open PR)** — Proposes additional metadata on resource contents. May become relevant if it introduces reference semantics, but currently does not define server-to-server data references. Monitor for future overlap.
- **Extensions framework (GA)** — Allows extending protocol messages with custom metadata. This is the intended mechanism for adding data reference capabilities.

## Current Coverage

The spec provides no data reference or server-to-server transfer mechanism. All data flows through the client:

1. **Inline data**: Tool results embed data directly in the JSON-RPC response. Large payloads (images, files, datasets) are base64-encoded and transmitted inline, increasing message size and memory usage.
2. **Client-mediated resources**: Resources are read by the client via `resources/read`. If server A needs data from server B, the client must fetch from B and pass it to A as input — there is no direct reference mechanism.

## Remaining Gap

- **Data references/pointers**: No mechanism for a tool response to include a reference to data (e.g., a URI or token) that another server can resolve directly, bypassing the client.
- **Server-to-server data transfer**: No protocol for servers to exchange data directly. All data must transit through the client, which becomes a bottleneck for large payloads.
- **Lazy loading**: No mechanism to return a reference that the client can resolve on demand rather than receiving all data upfront (e.g., "here is a reference to a 500MB dataset — fetch it only if needed").
- **Size efficiency**: All binary data is base64-encoded in JSON, incurring ~33% size overhead. No alternative transport for large payloads.
- **Cross-server resource references**: No mechanism for one server to reference a resource URI hosted by another server in a way that the protocol can resolve.

## Design Changes Required

- Define an MCP Extension that introduces a `data_reference` content type in tool responses, containing a URI or token that can be resolved by the client or by other servers.
- Define resolution semantics — how references are dereferenced, what authentication is needed, and what happens when a reference expires.
- Consider integration with the Resources system — data references could be expressed as resource URIs with additional metadata.
- Monitor SEP-2093 for potential overlap with resource contents metadata.

## Verdict

**Gap** — All data flows through the client with no server-to-server reference or transfer mechanism. There is no data reference content type, no lazy loading, and no efficient binary transport. The Extensions framework provides the integration point for this proposal.
