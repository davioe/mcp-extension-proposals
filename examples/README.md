# Examples

This directory contains schemas, reference implementations, and realistic example manifests for the proposed MCP protocol extensions.

## Directory Structure

```
examples/
├── manifests/                        # Real-world example manifests
│   ├── jira-server-manifest.json     # Full manifest for a Jira MCP server
│   └── github-server-manifest.json   # Full manifest for a GitHub MCP server
├── python/
│   └── server.py                     # Python reference implementation
└── typescript/
    └── server.ts                     # TypeScript reference implementation

schemas/
├── service-manifest.schema.json      # Service manifest (Proposal #1)
├── error.schema.json                 # Structured error model (Proposal #11)
├── permissions.schema.json           # Permission model (Proposal #4)
├── streaming.schema.json             # Streaming & progress (Proposal #8)
├── transactions.schema.json          # Idempotency & transactions (Proposal #5)
├── provenance.schema.json            # Source attribution (Proposal #7)
├── data-references.schema.json       # Data references (Proposal #9)
└── subscribe-notify.schema.json      # Subscribe/notify (Proposal #15)
```

## Schemas

All schemas are [JSON Schema Draft-07](https://json-schema.org/draft-07/json-schema-release-notes.html) and can be used for validation, code generation, and documentation.

| Schema | Covers Proposals | Description |
|--------|-----------------|-------------|
| `service-manifest.schema.json` | #1, #3, #6, #10, #13 | The core manifest — tools, auth, cost, rate limits, capabilities |
| `error.schema.json` | #11 | Structured errors with categories, retry hints, and suggestions |
| `permissions.schema.json` | #4 | Scoped auth, permission checks, session tokens, scope negotiation |
| `streaming.schema.json` | #8 | Progress notifications, stream chunks, checkpoint resumption |
| `transactions.schema.json` | #5 | Idempotency keys, transaction lifecycle, compensation rollback |
| `provenance.schema.json` | #7 | Source attribution with location, confidence, and transformation |
| `data-references.schema.json` | #9 | Opaque data references for direct server-to-server data transfer |
| `subscribe-notify.schema.json` | #15 | Bidirectional push via subscribe/notify event mechanism |

### Coverage Matrix

| Proposal | Schema | Python | TypeScript | Example Manifest |
|----------|--------|--------|------------|-----------------|
| 1. Capability Discovery | ✅ | ✅ | ✅ | ✅ |
| 2. Intent Hints | ✅ (in manifest) | ✅ | ✅ | — |
| 3. Cost Transparency | ✅ (in manifest) | ✅ | ✅ | ✅ |
| 4. Scoped Auth | ✅ | ✅ | ✅ | ✅ |
| 5. Idempotency & Transactions | ✅ | ✅ | ✅ | — |
| 6. Human-in-the-Loop | ✅ (in manifest) | ✅ | ✅ | ✅ |
| 7. Provenance | ✅ | ✅ | ✅ | — |
| 8. Streaming & Progress | ✅ | ✅ | ✅ | ✅ |
| 9. Data References | ✅ | — | — | — |
| 10. Multimodal Signatures | ✅ (in manifest) | — | — | — |
| 11. Structured Errors | ✅ | ✅ | ✅ | — |
| 12. Conformance Suite | — | — | — | — |
| 13. Server Discovery | ✅ (in manifest) | — | — | ✅ |
| 14. Session State | — | ✅ | ✅ | — |
| 15. Bidirectional Push | ✅ | — | — | — |

Proposals marked "—" are specified in the main proposal document but don't have standalone schemas or implementations yet. Contributions welcome.

## Reference Implementations

Both implementations demonstrate the same feature set — a simple project tracking server with tickets.

### Python

```bash
cd examples/python
python server.py
```

No external dependencies required (stdlib only). Runs a demo that exercises all implemented extensions.

### TypeScript

```bash
cd examples/typescript
npx tsx server.ts
```

Requires Node.js 18+ and `tsx` for running TypeScript directly.

### What the Demo Shows

Both demos walk through this sequence:

1. **Service Manifest** — Server exposes its full capabilities at connection time
2. **Permission Check** — Pre-flight check before calling a scoped tool
3. **Intent Hint** — Client sends *why* it's searching; server suggests a better tool
4. **Provenance** — Search results include source attribution
5. **Idempotent Create** — Same key → same result, no duplicate ticket
6. **Human-in-the-Loop** — Delete requires explicit user confirmation
7. **Transaction + Rollback** — Multi-step operation with compensation on failure
8. **Session State** — Opaque state token carried between calls
9. **Structured Error** — Machine-readable error with category and suggestion

## Example Manifests

The `manifests/` directory contains realistic, fully populated manifests for:

- **Jira** — Issue tracking with sprints, analytics, and tiered permissions
- **GitHub** — Repositories, issues, PRs, and code search

These show how the proposed schema applies to real-world servers with complex permission models, destructive operations, metered costs, and cross-server recommendations.

## Contributing

To add a new example manifest, schema, or implementation:

1. Follow the existing file naming conventions
2. Validate schemas against Draft-07
3. Ensure manifests validate against `schemas/service-manifest.schema.json`
4. Add coverage info to the matrix above
