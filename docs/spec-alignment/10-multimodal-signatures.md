# Proposal 10: Multimodal Signatures

## Spec References Examined

- **Tool result `content` array** (MCP 2025-11-25) — Tool responses return a `content` array with typed blocks: `type: "text"` (string data), `type: "image"` (base64-encoded image with `mimeType`), `type: "audio"` (base64-encoded audio with `mimeType`). These content types allow tools to return multimodal output.
- **`tools/list` with `inputSchema` and `outputSchema`** (MCP 2025-11-25) — Tool definitions declare input and output shapes using JSON Schema. However, JSON Schema describes JSON structure, not binary content types. There is no way to declare that a tool accepts or returns specific MIME types at the definition level.
- **Tool `annotations`** (MCP 2025-11-25) — Advisory hints about tool behavior. No MIME type, size limit, or binary format annotations.
- **Extensions framework (GA)** — Allows extending tool definitions and responses with custom metadata. This is the intended mechanism for multimodal signature extensions.

## Current Coverage

The spec provides partial support for multimodal output:

1. **Base64 content types**: Tool results can include `image` and `audio` content blocks with base64-encoded data and a `mimeType` field. This allows tools to return images and audio alongside text.
2. **Typed output schema**: `outputSchema` describes the JSON structure of tool responses but cannot express binary content type constraints.

These mechanisms cover "a tool can return an image" but not "this tool always returns a PNG image up to 5MB" or "this tool accepts a JPEG image as input."

## Remaining Gap

- **Tool-level MIME type declarations**: No way to declare in a tool definition what MIME types a tool accepts as input or produces as output (e.g., "this tool accepts `image/jpeg` and returns `image/png`"). Clients cannot filter or validate content types before invocation.
- **`max_input_size_bytes`**: No mechanism to declare maximum input size for a tool (e.g., "accepts images up to 10MB"). Clients cannot validate payload size before sending.
- **Input content types**: While output supports `image` and `audio` content blocks, there is no equivalent mechanism for sending binary input to tools. Tool inputs are JSON Schema-based, so binary data must be base64-encoded in a string field.
- **Efficient binary transport**: All binary data is base64-encoded within JSON, incurring ~33% size overhead. No multipart or binary-frame transport for large media payloads.
- **Content type negotiation**: No mechanism for clients and servers to negotiate preferred content types (e.g., "I prefer WebP over PNG").

## Design Changes Required

- Define an MCP Extension that adds MIME type declarations to tool definitions (accepted input types, produced output types), using the Extensions framework.
- Define `max_input_size_bytes` and `max_output_size_bytes` metadata on tool definitions.
- Consider a binary transport extension for large media payloads, as an alternative to base64-in-JSON.
- Ensure backward compatibility — tools without multimodal signatures continue to work as today.

## Verdict

**Partially Addressed (minor)** — Base64 content types for images and audio partially cover multimodal output, but tool-level MIME type declarations, input size limits, and efficient binary transport are missing. The Extensions framework provides the integration point for this proposal.
