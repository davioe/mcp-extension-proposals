# Proposal 4: Granular Permissions & Scoped Auth

## Spec References Examined

- **OAuth 2.1 at transport level** (MCP 2025-11-25) — MCP supports OAuth 2.1 for session establishment. This handles authentication (who are you?) and coarse-grained authorization (what server can you access?) but not fine-grained authorization (what can you do with this specific tool on this server?).
- **Incremental scope consent (SEP-835)** — Defines a `WWW-Authenticate` header mechanism for requesting additional OAuth scopes at runtime when a client attempts an operation requiring elevated permissions. This is transport-level scope escalation: the server rejects a request with a 401/403 and indicates what additional OAuth scopes are needed. It does not define per-tool scope declarations or a pre-flight check API.
- **Protected Resource Metadata** (MCP 2025-11-25) — Servers can advertise their OAuth requirements (authorization server URL, supported scopes) via a well-known metadata endpoint. This tells clients how to authenticate with the server, not which scopes map to which tools.
- **SEP-1932 (DPoP)** — Adds Demonstrating Proof-of-Possession for OAuth tokens, binding tokens to a specific client key pair. This is a transport-level security enhancement (preventing token theft/replay), not a per-tool authorization mechanism.
- **SEP-1933 (Workload Identity Federation)** — Enables machine-to-machine authentication using platform identity tokens (e.g., AWS IAM roles, GCP service accounts). This extends who can authenticate, not what they are authorized to do at the tool level.

## Current Coverage

The spec provides a robust transport-level authentication and authorization framework:

1. **Session authentication**: OAuth 2.1 establishes authenticated sessions with servers.
2. **Runtime scope escalation**: SEP-835 allows servers to request additional OAuth scopes when a client lacks permissions for an operation.
3. **Server metadata**: Protected Resource Metadata advertises server-level auth requirements.
4. **Token security**: DPoP (SEP-1932) and Workload Identity Federation (SEP-1933) strengthen the security of the authentication layer.

All of these operate at the transport/session level. None define a mapping between OAuth scopes and individual tool definitions, nor do they provide a pre-flight mechanism for clients to check authorization before attempting a tool call.

## Remaining Gap

- **Per-tool scope declarations**: `required_scopes` on tool definitions, declaring which OAuth scopes are needed to invoke a specific tool. The spec has no mechanism for a tool to advertise its authorization requirements.
- **Pre-flight `can_execute` check**: An API for clients to ask "is this user authorized to call this tool?" before invocation, receiving allowed/denied status, missing scopes, and an elevation URL. The spec's only equivalent is attempting the call and receiving a 401/403.
- **Scope-to-tool mapping**: `ScopeDefinition` objects that explicitly map OAuth scopes to tool grants (e.g., scope `files:write` grants access to tools `create_file` and `delete_file`). The spec has no application-level scope mapping.
- **Session TTL semantics**: Defining how long a granted scope remains valid within a session, enabling time-limited elevated permissions. The spec relies on OAuth token expiry, which applies to the entire session, not individual scope grants.
- **Application-level elevation URL**: A URL the client can direct the user to for granting additional per-tool scopes, distinct from the transport-level OAuth flow.

## Design Changes Required

- Document the relationship to SEP-835 incremental consent: our proposal's `elevation_url` in the `can_execute` response could integrate with SEP-835's `WWW-Authenticate` flow. When a `can_execute` check returns `denied`, the elevation URL could trigger the SEP-835 scope escalation at the transport level.
- Monitor SEP-1932 (DPoP) and SEP-1933 (Workload Identity Federation) for potential interaction: DPoP tokens could carry per-tool scope claims, and Workload Identity Federation could define machine-to-machine tool-level authorization.
- Consider whether `required_scopes` on tool definitions should reference the same scope namespace as the server's OAuth configuration (from Protected Resource Metadata) to ensure consistency between transport-level and application-level authorization.
- Clarify that our proposal is an application-level authorization layer that sits on top of the spec's transport-level OAuth, not a replacement for it.

## Verdict

**Partially Addressed (major)** — The spec provides robust transport-level authentication and coarse-grained authorization via OAuth 2.1, with incremental scope consent (SEP-835) for runtime escalation. However, there is no per-tool scope declaration, no pre-flight authorization check, no scope-to-tool mapping, and no session TTL semantics. The core value of this proposal (fine-grained, tool-level authorization with pre-flight checks) remains unaddressed.
