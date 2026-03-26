# Proposal 8: Streaming & Progress Notifications

## Spec References Examined

- **`notifications/progress`** (MCP 2025-11-25) — Provides `progress` (number), `total` (number), and `progressToken` (issued by the caller). Designed for numeric completion tracking (e.g., 45 of 100 items processed). No support for human-readable status messages, estimated time remaining, or checkpoint/resume tokens.
- **Tasks (SEP-1686, experimental)** — Introduces task lifecycle states: `working`, `input_required`, `completed`, `failed`, `cancelled`. Supports `tasks/get` (polling for status), `tasks/result` (deferred result retrieval), `tasks/cancel` (cancellation), and `notifications/tasks/status` (push status updates). Tool-level negotiation via `execution.taskSupport`. Tasks handle status tracking and deferred results but do NOT define partial result streaming or checkpoint resumption.
- **Streamable HTTP transport** — SSE-based transport supporting `text/event-stream` responses. This is the transport mechanism that enables server-sent events over HTTP, not an application-level streaming protocol. Our proposal defines what is streamed (partial results, checkpoints), not how bytes move over the wire.

## Current Coverage

The spec provides two relevant mechanisms:

1. **Numeric progress**: `notifications/progress` allows a server to report numeric completion (e.g., 45/100). Clients can display progress bars. This covers the simplest form of progress reporting.
2. **Task lifecycle**: Tasks (experimental) allow long-running operations to report their state, be polled, cancelled, and have their results retrieved later. This covers deferred execution and status tracking.

Together, these handle "how far along is it?" (numeric) and "what state is it in?" (task lifecycle) but not "what has it produced so far?" (partial results) or "where do I resume if disconnected?" (checkpoints).

## Remaining Gap

- **Partial result streaming**: Getting intermediate/incremental results before a tool completes (e.g., streaming rows from a database query, streaming chunks of a generated document). Neither `notifications/progress` nor Tasks provide a mechanism for delivering partial data payloads during execution.
- **Checkpoint tokens for resumption**: After a disconnection, resuming from the last known good state rather than restarting from scratch. No spec mechanism addresses this.
- **Human-readable progress messages**: A `message` string accompanying numeric progress (e.g., "Indexing file 45 of 100: schema.prisma"). The spec's `notifications/progress` is numeric-only.
- **Estimated time remaining**: `estimated_remaining_seconds` for client-side UX (e.g., "approximately 2 minutes remaining"). Not present in the spec.
- **Tasks are experimental**: SEP-1686 is not yet stable, and SDK support is incomplete. Even when stabilized, Tasks address a different use case (status tracking and deferred results) than our proposal's focus on streaming intermediate data.

## Design Changes Required

- Clarify the relationship between our streaming proposal and Tasks: they are complementary. Tasks manage lifecycle; our proposal manages data flow during the `working` state.
- Consider defining partial result streaming as an extension to `notifications/tasks/status` rather than a standalone mechanism, to integrate cleanly if Tasks stabilize.
- Ensure `checkpoint_token` semantics are compatible with task resumption if Tasks add similar capabilities in the future.

## Verdict

**Partially Addressed (major)** — The spec provides numeric progress tracking and experimental task lifecycle management, but does not address partial result streaming, checkpoint/resume tokens, human-readable progress messages, or estimated time remaining. The core value of this proposal (streaming intermediate data and resumable execution) remains unaddressed.
