# Proposal 6: Human-in-the-Loop Confirmation

## Spec References Examined

- **Tool annotations** (MCP 2025-11-25) — `destructiveHint` (boolean, advisory) and `readOnlyHint` (boolean, advisory). These are hints intended for client UI display (e.g., showing a warning icon). They are explicitly advisory: a client MAY ignore them entirely. There is no enforcement mechanism and no protocol-level confirmation gate.
- **Elicitation, form mode** (MCP 2025-11-25) — `elicitation/create` allows a server to request structured input from the user mid-execution. Designed for data gathering (e.g., "which database do you want to query?"), not for "do you want to proceed with this destructive action?" confirmation gates. The server must already be executing to issue an elicitation request.
- **Elicitation, URL mode (SEP-1036)** — Server requests the client to open a URL for out-of-band interaction (e.g., OAuth consent pages). Could theoretically serve as a confirmation mechanism, but it is designed for third-party authentication flows, not lightweight tool-level confirmation.
- **Tasks `input_required` state (SEP-1686, experimental)** — A running task can pause and request additional input from the user. This is a runtime mechanism triggered during execution, not an upfront declaration on the tool definition that gates execution before it begins.
- **MCP Apps (SEP-1865, GA January 2026)** — Provides a UI channel (`ui://` URI scheme) for servers to deliver interactive content to clients. Could serve as a rich confirmation interface, but MCP Apps is designed for delivering complex UI experiences, not a lightweight declarative "confirm/deny" gate on tool execution.

## Current Coverage

The spec provides several mechanisms that touch on user interaction during tool execution:

1. **Advisory hints**: Tool annotations signal that a tool may be destructive, allowing clients to optionally display warnings. No enforcement.
2. **Runtime data gathering**: Elicitation allows servers to collect user input during execution. This is complementary to confirmation (gathering data vs. gating execution).
3. **Task-level input requests**: Tasks can pause for input, but this is a runtime flow control mechanism, not a tool-definition-level declaration.
4. **Rich UI delivery**: MCP Apps can present interactive content, but this is heavyweight for simple confirm/deny decisions.

None of these mechanisms provide what our proposal defines: a declarative, mandatory, tool-definition-level confirmation gate that blocks execution until the client obtains explicit user consent.

## Remaining Gap

- **Mandatory confirmation protocol**: A mechanism where the server declares that a tool MUST NOT execute without user confirmation, and the protocol enforces this. The spec's annotations are advisory and carry no enforcement.
- **Upfront tool-level declaration**: `requires_confirmation: true` on the tool definition itself, so clients know before invocation that confirmation is needed. All spec alternatives are runtime mechanisms.
- **Structured risk assessment**: `risk_level` (safe/reversible/destructive) providing granular risk categorization beyond the binary `destructiveHint` boolean.
- **Human-readable confirmation context**: `confirmation_message` providing a specific, human-readable description of what the user is consenting to (e.g., "This will permanently delete 47 records from the production database").

## Design Changes Required

- Add a comparison table in the SEP showing our mechanism vs. annotations, Elicitation, Tasks, and MCP Apps, making clear that these address different concerns.
- Explicitly note that our proposal and Elicitation are complementary: HITL confirmation is an upfront mandatory gate; Elicitation is runtime data gathering. A tool could use both (confirm first, then gather parameters).
- Consider whether `risk_level` should extend or reference the existing `destructiveHint`/`readOnlyHint` annotations rather than introducing a parallel mechanism.
- Evaluate whether MCP Apps (post-GA) could serve as the rendering layer for confirmation dialogs while our proposal defines the protocol-level semantics.

## Verdict

**Partially Addressed (major)** — The spec provides advisory tool annotations and runtime interaction mechanisms (Elicitation, Tasks, MCP Apps), but none of these constitute a mandatory, declarative, tool-definition-level confirmation protocol. The core value of this proposal (upfront mandatory confirmation with structured risk assessment) remains unaddressed by any current or planned spec mechanism.
