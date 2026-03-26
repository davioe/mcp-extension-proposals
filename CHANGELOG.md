# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-03-26

### Added
- Per-proposal spec alignment audit against MCP 2025-11-25 (`docs/spec-alignment/`, 15 files)
- Cross-server Saga coordination design in Transactions SEP
- HTTP-transport Saga demo with 3 independent servers (`saga_demo.py` / `saga-demo.ts`)
- SSE-transport subscription demo (`sse_subscription_demo.py` / `sse-subscription-demo.ts`)
- Signed-URL data reference demo (`data_reference_demo.py` / `data-reference-demo.ts`)
- SEP submission preparation (official MCP template alignment, RFC 2119 audit)
- SEP submission checklist (`docs/sep-submission-checklist.md`)
- CHANGELOG.md

### Changed
- README gap analysis table updated with audit links and refined verdicts
- SEPs updated with `Specification` field, RFC 2119 language, spec relationship sections
- CI expanded with transport demo steps

## [0.2.0] - 2026-03-26

### Added
- JSON-RPC 2.0 wire framing in both reference implementations
- CI pipeline via GitHub Actions (schema validation + reference implementations)
- Conformance tests CONF-005 through CONF-007 (tools/list, unknown method, invalid JSON)

### Changed
- Replaced manual schema validator with ajv (JSON Schema 2020-12)
- Upgraded GitHub Actions to v5 (Node.js 24)

### Fixed
- TypeScript exit code bug (`demo().catch(console.error)` -> proper `process.exit(1)`)

## [0.1.0] - 2026-03-25

### Added
- Initial 15 extension proposals organized in 5 pillars
- README with full proposal text, gap analysis, design principles
- 10 JSON Schema 2020-12 definitions
- Reference implementations in Python and TypeScript
- 5 example manifests (GitHub, Jira, Slack, Linear, Notion)
- 3 SEP drafts (Human-in-the-Loop, Idempotency & Transactions, Structured Errors)
- CONTRIBUTING.md with guidelines
- CC-BY-4.0 license
