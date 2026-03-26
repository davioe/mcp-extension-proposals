# Proposal 14: Session State

## Spec References Examined

- **`Mcp-Session-Id` header** (MCP 2025-11-25, Streamable HTTP transport) — A transport-level session identifier sent as an HTTP header. The server generates a session ID during initialization, and the client includes it in subsequent requests to maintain session affinity. This identifies a session but carries no state.
- **`initialize` / `initialized` lifecycle** (MCP 2025-11-25) — Establishes a session with capability negotiation. After `initialized`, the session is active until the transport disconnects. No mechanism for session resumption after disconnection.
- **Extensions framework (GA)** — Allows extending protocol messages with custom metadata. This is the intended mechanism for session state extensions.

## Current Coverage

The spec provides session identification but not session state management:

1. **Session identification**: The `Mcp-Session-Id` header lets servers correlate multiple requests to the same session. This enables server-side session tracking (the server can maintain state internally, keyed by session ID).
2. **Session lifecycle**: The `initialize`/`initialized` handshake establishes a session, and the transport lifecycle defines when it ends. Sessions are tied to transport connections.

These mechanisms cover "which session is this request part of?" but not "what state should persist across calls?" or "how do I resume after disconnection?"

## Remaining Gap

- **Cross-call opaque state tokens**: No mechanism for servers to embed opaque state data in responses that clients return on the next call (cookie-style state passing). Servers must maintain all state server-side, which requires persistent storage and makes stateless/serverless deployments difficult.
- **TTL semantics**: No time-to-live on sessions. There is no protocol-level mechanism to communicate session expiry ("this session is valid for 30 minutes") or to extend session lifetime.
- **Session resumption**: No mechanism to resume a session after transport disconnection. If the connection drops, the client must re-initialize and establish a new session. Any server-side state associated with the old session ID may be lost.
- **State schema/typing**: No mechanism to declare what state a server expects or maintains. Clients have no visibility into server-side session state.
- **Session migration**: No mechanism to transfer a session from one transport to another (e.g., from stdio to HTTP) or from one server instance to another (e.g., for load balancing).

## Design Changes Required

- Define an MCP Extension that introduces opaque state tokens on tool responses and requests, using the Extensions framework. Servers embed state in responses; clients echo it back in subsequent requests.
- Define TTL semantics — servers declare session expiry, and clients can request extensions.
- Define session resumption — clients present a previous session ID and receive either a resumed session or a rejection.
- Ensure backward compatibility — clients that do not support state tokens simply omit them, and servers fall back to server-side state management.

## Verdict

**Partially Addressed (major)** — The spec provides session identification via `Mcp-Session-Id` but no cross-call opaque state tokens, no TTL semantics, and no session resumption after disconnection. The session ID is a foundation, but session state management remains unaddressed. The Extensions framework provides the integration point for this proposal.
