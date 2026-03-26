# Proposal 2: Intent Hints

## Spec References Examined

- **`tools/call` request** (MCP 2025-11-25) — The client sends `name` (tool identifier) and `arguments` (input parameters). There is no field for intent, purpose, context, or reason for invocation. The server receives what to do but not why.
- **Tool `annotations`** (MCP 2025-11-25) — Server-to-client hints about tool behavior (`readOnlyHint`, `destructiveHint`, etc.). These flow from server to client and describe tool characteristics, not client intent. They are not bidirectional.
- **Extensions framework (GA)** — Allows extending protocol messages with custom metadata. This is the intended mechanism for attaching intent hints to `tools/call` requests.

## Current Coverage

The spec provides no mechanism for clients to communicate intent or purpose when calling a tool. The `tools/call` request is purely functional: it specifies which tool to invoke and with what arguments, but not why the call is being made.

Tool annotations flow in the opposite direction (server-to-client) and describe tool properties, not caller intent.

## Remaining Gap

- **Intent metadata on tool calls**: No mechanism for clients to attach purpose or context to a `tools/call` request (e.g., "called as part of a code review workflow" or "user explicitly requested this action"). Servers cannot adapt behavior, logging, or prioritization based on caller intent.
- **Workflow context**: No way to indicate that a tool call is part of a larger workflow or multi-step operation. Servers see each call in isolation.
- **User vs. agent attribution**: No mechanism to distinguish whether a tool call was initiated by a human user, an autonomous agent, or an automated pipeline. This affects audit logging, safety checks, and billing.

## Design Changes Required

- Define an MCP Extension that adds an `intent` or `context` object to `tools/call` requests, using the Extensions framework.
- Define a vocabulary of standard intent categories (e.g., `user_requested`, `agent_autonomous`, `workflow_step`) while allowing free-form descriptions.
- Ensure the extension is advisory — servers that do not understand intent hints process the call normally.

## Verdict

**Gap** — The spec has no mechanism for clients to communicate why they are calling a tool. Intent metadata is entirely absent from `tools/call` parameters. The Extensions framework provides the integration point for this proposal.
