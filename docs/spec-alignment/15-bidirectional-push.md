# Proposal 15: Bidirectional Push

## Spec References Examined

- **`resources/subscribe` and `notifications/resources/updated`** (MCP 2025-11-25) — Clients can subscribe to resource URIs and receive notifications when those resources change. The subscription model is URI-based: you subscribe to a specific resource URI, and the server sends a notification when that resource is updated. This is a resource-change notification system, not a general-purpose event system.
- **`notifications/progress`** (MCP 2025-11-25) — Server-to-client push for numeric progress updates during tool execution. Scoped to in-flight operations, not general events.
- **MCP Apps (SEP-1865, experimental)** — Demonstrates server-to-client push via UI interactions (displaying content to users). This is a UI-oriented push mechanism, not an event system.
- **Extensions framework (GA)** — Allows extending the protocol with custom notification types. This is the intended mechanism for general-purpose event subscriptions.

## Current Coverage

The spec provides limited push notification capabilities:

1. **Resource-URI subscriptions**: Clients can subscribe to specific resource URIs and receive change notifications. This covers "notify me when this file/document changes" but not arbitrary events.
2. **Progress notifications**: Servers can push numeric progress updates during tool execution. This is scoped to in-flight operations.
3. **List change notifications**: `listChanged` notifications for tools, resources, and prompts. These are inventory-change signals, not general events.

These mechanisms cover resource-change notifications and operation progress but not general-purpose event subscriptions.

## Remaining Gap

- **General-purpose event subscription**: No mechanism to subscribe to arbitrary events beyond resource URI changes (e.g., "notify me when a commit is pushed to main," "notify me when a ticket is resolved," "notify me when a build completes").
- **Event filtering**: No mechanism to filter events by criteria (e.g., "only notify me about changes to files matching `*.ts`" or "only high-severity alerts"). Resource subscriptions are all-or-nothing per URI.
- **Event taxonomy**: No standard vocabulary or taxonomy for event types. Each server defines its own notification semantics with no interoperability.
- **Custom event types**: No mechanism for servers to declare what event types they support or for clients to discover available event types before subscribing.
- **Event payloads**: Resource change notifications carry the URI that changed but minimal payload. No mechanism for rich event payloads (e.g., "here is the diff of what changed").
- **Subscription management**: No mechanism to list active subscriptions, modify filter criteria on existing subscriptions, or set subscription TTLs.

## Design Changes Required

- Define an MCP Extension that introduces a general-purpose event subscription system, using the Extensions framework. Support subscribing to event types (not just resource URIs) with optional filter criteria.
- Define an event type declaration mechanism so servers can advertise what events they support.
- Define a standard event taxonomy with well-known event types while allowing server-specific custom events.
- Define subscription management operations (list, modify, unsubscribe, TTL).
- Ensure backward compatibility with the existing `resources/subscribe` mechanism — general event subscriptions complement, not replace, resource-URI subscriptions.

## Verdict

**Partially Addressed (major)** — Resource-URI subscriptions provide a narrow form of server-to-client push, but there is no general-purpose event subscription, no event filtering, no event taxonomy, and no custom event types. The existing subscription model is limited to resource change notifications. The Extensions framework provides the integration point for this proposal.
