---
title: "refactor: Replace manual validation with ajv, add CI for reference implementations, add JSON-RPC wire framing"
type: refactor
status: completed
date: 2026-03-26
---

# Replace Manual Validation with ajv, Add CI for Reference Implementations, Add JSON-RPC Wire Framing

## Overview

Three improvements to raise the repo's quality bar: (1) replace the hand-rolled structural validator with real JSON Schema 2020-12 validation via ajv, (2) run both reference implementations in CI so they cannot silently break, and (3) add JSON-RPC 2.0 envelopes to the reference implementations so they demonstrate the actual MCP wire format.

## Problem Frame

The repo standardizes on JSON Schema 2020-12 but validates manifests with manual field/enum checks that miss type constraints, `pattern`, `format`, `$ref` resolution, and `additionalProperties`. Neither `server.py` nor `server.ts` is executed in CI, so regressions go undetected. The implementations simulate MCP via direct function calls without JSON-RPC framing, limiting their value as a true wire-level reference.

## Requirements Trace

- R1. All schemas compile under ajv (JSON Schema 2020-12) without errors (meta-validation)
- R2. All example manifests validate against `service-manifest.schema.json` via ajv, including `format` assertions (`uri`, `date-time`)
- R3. `server.py` and `server.ts` execute successfully in CI on every push/PR
- R4. Reference implementations wrap requests and responses in JSON-RPC 2.0 envelopes using MCP-standard method names (`tools/call`, `tools/list`, `initialize`)
- R5. Application-level structured errors travel inside `"result"` (not JSON-RPC `"error"`); protocol errors use JSON-RPC `"error"`
- R6. The repo remains dependency-minimal; new packages are dev-only tooling

## Scope Boundaries

- No new example instance documents for non-manifest schemas (future work)
- No real stdio/HTTP transport — JSON-RPC framing is in-process serialization/deserialization
- No type-checking tooling (mypy/pyright) added in this pass
- No changes to schema content or proposal text

## Context & Research

### Relevant Code and Patterns

- `scripts/validate-schemas.js` — current validator, 178 lines, zero dependencies, uses `check(label, fn)` test-runner pattern
- `.github/workflows/validate.yml` — 32-line CI, Node 20 only, two steps (JSON parse + validation script)
- `examples/python/server.py` — 1107 lines, stdlib-only, `handle_request()` accepts plain dicts
- `examples/typescript/server.ts` — 1043 lines, runs via `npx tsx`, `handleRequest()` accepts plain objects
- Both implementations use section separators (`// ====`) per extension
- Both have `structured_error()` / `createStructuredError()` factories
- `server.ts` line ~1043: `demo().catch(console.error)` — exits 0 on error (bug)
- Schemas use `$id` with base `https://mcp-extension-proposals.github.io/schemas/`
- Two schemas (`transactions.schema.json`, `data-references.schema.json`) contain cross-file `$ref: "error.json"` (bare relative URI)

### External References

- ajv 2020-12: import `Ajv2020` from `ajv/dist/2020`, not the default import
- `ajv-formats` v3.x required for `format` assertion (uri, date-time)
- Cross-file `$ref` resolution: register schemas via `ajv.addSchema()` keyed by `$id`; bare `"error.json"` resolves against the shared `$id` base URI
- JSON-RPC 2.0: envelope is `{jsonrpc: "2.0", id, method, params}` / `{jsonrpc: "2.0", id, result|error}`
- MCP method names: `initialize`, `notifications/initialized`, `tools/list`, `tools/call` with `params: {name, arguments}`
- GitHub Actions: `actions/setup-python@v5` with `python-version: "3.12"`

## Key Technical Decisions

- **ajv over alternative validators**: ajv is the de-facto standard for Node.js JSON Schema validation, supports 2020-12 natively, and handles `$ref`/`$defs` out of the box
- **Register schemas by `$id`**: All 10 schemas are loaded via `ajv.addSchema()` so cross-file `$ref` resolves via URI matching against the shared base. No custom `loadSchema` needed
- **`ajv-formats` enabled**: Without it, `format: "uri"` and `format: "date-time"` become no-ops — unacceptable for a spec repo
- **Root `package.json` with lockfile**: Introduces `ajv`, `ajv-formats`, and `tsx` as pinned devDependencies. `npm ci` in CI for reproducibility
- **MCP-standard method structure for JSON-RPC**: Use `tools/call` with `{name, arguments}` params, not a custom envelope. A thin `parseJsonRpcRequest()` / `buildJsonRpcResponse()` layer translates between wire format and existing internal handlers
- **Application errors in `result`, protocol errors in `error`**: Follows MCP convention — tool execution failures are successful RPC calls that return error content. JSON-RPC `error` is reserved for method-not-found, invalid params, parse errors
- **Keep `.js` extension for validator**: The script stays CommonJS (`.js`) since ajv supports both CJS and ESM, and no other file needs ESM

## Open Questions

### Resolved During Planning

- **Cross-file `$ref` resolution**: Bare `"error.json"` resolves against the `$id` base URI (`https://mcp-extension-proposals.github.io/schemas/`) when all schemas are registered. Verified by ajv docs on URI resolution.
- **Where to put `package.json`**: Root level. Only used for dev tooling, not a publishable package. Set `"private": true`.
- **Python version**: Pin to 3.12 (current stable, EOL 2028). The code requires 3.10+ but there's no reason to pin to the minimum.
- **`server.ts` exit code bug**: Fix by changing `.catch(console.error)` to `.catch((e) => { console.error(e); process.exit(1); })`.

### Deferred to Implementation

- Exact ajv error formatting — how to present `validate.errors` array in a readable way. Depends on seeing actual error output.
- Whether any existing manifest has latent validation errors that surface under ajv — will be discovered when the new validator runs.
- Whether `asyncio.sleep()` / `setTimeout()` delays in reference implementations should be shortened or removed for CI speed.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────┐
│                  validate-schemas.js                  │
│                                                       │
│  1. Load all 10 schemas → ajv.addSchema() by $id     │
│  2. Meta-validate: ajv.compile() each schema          │
│  3. Instance-validate: manifests against              │
│     service-manifest.schema.json via ajv.validate()   │
│  4. Report errors with file + path context            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│             Reference Implementations                 │
│                                                       │
│  JSON-RPC layer (new):                                │
│    parseJsonRpcRequest(raw) → {method, params, id}   │
│    buildJsonRpcResponse(id, result) → envelope        │
│    buildJsonRpcError(id, code, msg) → envelope        │
│                                                       │
│  Demo flow (modified):                                │
│    raw = JSON.stringify({jsonrpc:"2.0", id:1,         │
│           method:"tools/call",                        │
│           params:{name:"search_tickets",              │
│                   arguments:{query:"auth"}}})         │
│    response = processJsonRpc(raw)                     │
│    // response is a JSON-RPC envelope string          │
│                                                       │
│  Existing handle_request() unchanged internally       │
│  processJsonRpc() is the new entry point              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   CI Pipeline                         │
│                                                       │
│  Job: validate                                        │
│    ├─ checkout                                        │
│    ├─ setup-node 20                                   │
│    ├─ npm ci                                          │
│    ├─ validate schemas (node scripts/validate-...)    │
│    ├─ setup-python 3.12                               │
│    ├─ run server.py                                   │
│    └─ run server.ts (npx tsx)                         │
└─────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: Add package.json and install ajv tooling**

  **Goal:** Establish dependency management for the repo with ajv, ajv-formats, and tsx as dev dependencies.

  **Requirements:** R1, R2, R6

  **Dependencies:** None

  **Files:**
  - Create: `package.json`
  - Create: `package-lock.json` (generated by `npm install`)
  - Modify: `.gitignore` (ensure `node_modules/` is listed — already present)

  **Approach:**
  - Minimal `package.json` with `"private": true`, `"type": "commonjs"` (matches existing `.js` script)
  - devDependencies: `ajv` (^8.17), `ajv-formats` (^3.0), `tsx` (^4.x)
  - Run `npm install` to generate lockfile
  - Verify `.gitignore` already covers `node_modules/`

  **Patterns to follow:**
  - CONTRIBUTING.md states "dependency-free where possible" — these are dev-only tooling, not runtime deps of reference implementations

  **Test scenarios:**
  - `npm ci` succeeds in a clean checkout
  - No runtime dependencies appear in `dependencies` (only `devDependencies`)

  **Verification:**
  - `package.json` and `package-lock.json` exist and are valid
  - `node -e "require('ajv/dist/2020')"` succeeds after install

- [ ] **Unit 2: Rewrite validate-schemas.js to use ajv**

  **Goal:** Replace manual structural checks with real JSON Schema 2020-12 validation via ajv.

  **Requirements:** R1, R2

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `scripts/validate-schemas.js`

  **Approach:**
  - Import `Ajv2020` from `ajv/dist/2020` and `addFormats` from `ajv-formats`
  - Create an ajv instance with `allErrors: true`, add formats
  - Phase 1 (meta-validation): Load all schema files from `schemas/`, register each via `ajv.addSchema(schema)`. Then `ajv.compile()` each to verify structural correctness. This catches invalid `$ref`, malformed `$defs`, unknown keywords, etc.
  - Phase 2 (instance-validation): Get the compiled `service-manifest.schema.json` validator, run it against each manifest in `examples/manifests/`. Report all errors with JSON pointer paths.
  - Retain the `check(label, fn)` test-runner pattern for consistent output
  - Remove all manual enum/field checks — ajv handles these natively
  - Keep the script as CommonJS (`.js`) since ajv supports `require()`

  **Patterns to follow:**
  - Existing `check(label, fn)` pattern with pass/fail counting and exit code
  - Same directory constants (`ROOT`, `SCHEMAS_DIR`, `MANIFESTS_DIR`)

  **Test scenarios:**
  - All 10 schemas compile without errors
  - All 5 manifests validate against `service-manifest.schema.json`
  - A deliberately malformed manifest (e.g., missing `server.name`) is rejected
  - A manifest with an invalid `homepage` URL (not a valid URI) is rejected via format validation
  - Cross-file `$ref` from `transactions.schema.json` → `error.json` resolves correctly

  **Verification:**
  - `node scripts/validate-schemas.js` passes with 0 exit code
  - The script catches validation errors that the old manual checks missed (e.g., `version` format pattern, `additionalProperties`)
  - No manual field/enum checking code remains

- [ ] **Unit 3: Add JSON-RPC 2.0 wire framing to server.py**

  **Goal:** Wrap all MCP calls in JSON-RPC 2.0 envelopes using MCP-standard method names.

  **Requirements:** R4, R5

  **Dependencies:** None (parallel with Units 1-2)

  **Files:**
  - Modify: `examples/python/server.py`

  **Approach:**
  - Add a JSON-RPC utility section near the top with: `parse_jsonrpc_request(raw_json)` → extracts method, params, id; `build_jsonrpc_response(id, result)` → wraps result; `build_jsonrpc_error(id, code, message, data=None)` → wraps error
  - Add `process_jsonrpc(raw_json)` as the new top-level entry point. It parses the JSON-RPC envelope, routes by method name (`initialize` → return capabilities, `tools/list` → return tool list from manifest, `tools/call` → extract `params.name` and `params.arguments`, call existing `handle_request()` logic), wraps the response in a JSON-RPC envelope
  - Standard JSON-RPC error codes for protocol failures: -32700 (parse error), -32601 (method not found), -32602 (invalid params)
  - Application-level errors (from `structured_error()`) go inside `"result"`, not `"error"`
  - Modify `demo()` to send JSON-RPC formatted strings through `process_jsonrpc()`, printing both the request and response envelopes
  - Add `initialize` → `notifications/initialized` handshake at the start of the demo
  - Keep existing `handle_request()` and all extension-specific code intact — the JSON-RPC layer wraps, not replaces

  **Patterns to follow:**
  - Existing section separator comments (`# ====`)
  - Existing `structured_error()` factory for application errors
  - Stdlib-only constraint (json, uuid modules already imported)

  **Test scenarios:**
  - `initialize` request returns server capabilities with `protocolVersion`
  - `tools/call` with valid tool name returns result in JSON-RPC envelope
  - `tools/call` with unknown tool returns application error inside `"result"`
  - Invalid JSON input returns JSON-RPC error with code -32700
  - Unknown method returns JSON-RPC error with code -32601
  - All existing demo scenarios still execute (idempotency, transactions, permissions, etc.)

  **Verification:**
  - `python examples/python/server.py` runs to completion with exit code 0
  - All printed output shows JSON-RPC 2.0 envelopes (every request has `jsonrpc`, `method`, `id`; every response has `jsonrpc`, `id`, `result` or `error`)
  - No raw `handle_request({tool: ...})` calls remain in the demo flow

- [ ] **Unit 4: Add JSON-RPC 2.0 wire framing to server.ts**

  **Goal:** Mirror the Python JSON-RPC framing in the TypeScript implementation.

  **Requirements:** R4, R5

  **Dependencies:** Unit 3 (to establish the pattern)

  **Files:**
  - Modify: `examples/typescript/server.ts`

  **Approach:**
  - Same structure as the Python implementation: `parseJsonRpcRequest()`, `buildJsonRpcResponse()`, `buildJsonRpcError()`, `processJsonRpc()`
  - Add TypeScript interfaces for JSON-RPC request/response/error types
  - Route by method name, translate to existing `handleRequest()` internals
  - Fix the exit code bug: change `demo().catch(console.error)` to `demo().catch((e) => { console.error(e); process.exit(1); })`
  - Modify `demo()` to use JSON-RPC envelopes, matching the Python demo flow

  **Patterns to follow:**
  - Existing TypeScript interfaces (`interface Ticket`, `interface ToolRequest`)
  - Existing `createStructuredError()` factory
  - Existing section separator comments

  **Test scenarios:**
  - Same scenarios as Unit 3, ensuring both implementations produce equivalent output
  - Verify exit code 1 on unhandled error (the bug fix)
  - TypeScript-specific: verify type safety of JSON-RPC interfaces

  **Verification:**
  - `npx tsx examples/typescript/server.ts` runs to completion with exit code 0
  - Output matches the Python implementation's JSON-RPC envelope structure
  - Deliberately throwing in `demo()` produces exit code 1

- [ ] **Unit 5: Expand CI workflow to cover all validation and reference implementations**

  **Goal:** Run ajv validation, Python server, and TypeScript server in CI on every push/PR.

  **Requirements:** R3

  **Dependencies:** Units 1-4

  **Files:**
  - Modify: `.github/workflows/validate.yml`

  **Approach:**
  - Remove the manual `find | node JSON.parse` step (redundant — ajv covers JSON validity)
  - Add `npm ci` step after `setup-node`
  - Keep `node scripts/validate-schemas.js` step (now uses ajv)
  - Add `actions/setup-python@v5` with `python-version: "3.12"`
  - Add step: `python examples/python/server.py` with `timeout-minutes: 2`
  - Add step: `npx tsx examples/typescript/server.ts` with `timeout-minutes: 2`

  **Patterns to follow:**
  - Existing workflow structure (single `validate` job, `ubuntu-latest`)
  - Use `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`

  **Test scenarios:**
  - CI passes when all schemas, manifests, and reference implementations are valid
  - CI fails if a schema has a structural error
  - CI fails if a manifest violates its schema
  - CI fails if `server.py` throws an unhandled exception
  - CI fails if `server.ts` throws an unhandled exception (exit code bug fixed)

  **Verification:**
  - Push to a branch and confirm the GitHub Actions run includes all 5 steps
  - All steps pass on current code

- [ ] **Unit 6: Update CONTRIBUTING.md with new validation instructions**

  **Goal:** Document the new validation setup (npm install, ajv-based validation).

  **Requirements:** None (housekeeping)

  **Dependencies:** Units 1-2

  **Files:**
  - Modify: `CONTRIBUTING.md`

  **Approach:**
  - Update the Validation section to mention `npm ci` or `npm install` before running the validator
  - Note that validation now uses ajv for full JSON Schema 2020-12 validation
  - Mention that reference implementations are also run in CI

  **Patterns to follow:**
  - Existing CONTRIBUTING.md tone and structure

  **Test scenarios:**
  - A new contributor can follow the instructions to run validation locally

  **Verification:**
  - Instructions are accurate and complete

## System-Wide Impact

- **Interaction graph:** The ajv rewrite replaces all validation logic — no partial overlap with the old manual checks should remain. The JSON-RPC layer wraps existing `handle_request()` / `handleRequest()` without modifying their internal logic.
- **Error propagation:** ajv errors are arrays of objects with `instancePath`, `message`, `params`. The validator must format these readably. JSON-RPC protocol errors use standard codes (-327xx); application errors pass through as-is inside `result`.
- **State lifecycle risks:** None. All changes are stateless script modifications.
- **API surface parity:** Both reference implementations (Python and TypeScript) must produce equivalent JSON-RPC output for the same demo sequence.
- **Integration coverage:** CI is the integration test — it runs the validator and both implementations end-to-end.

## Risks & Dependencies

- **Latent manifest errors surfacing:** ajv is stricter than the manual checks. Existing manifests may have violations (e.g., incorrect `version` format, unexpected properties) that were previously undetected. Mitigation: run ajv locally first and fix any manifest issues before committing.
- **Cross-file `$ref` resolution edge case:** If ajv's URI resolution doesn't match bare `"error.json"` against the full `$id`, the two schemas using cross-file refs will fail to compile. Mitigation: test early; if needed, normalize the `$ref` values in those schemas to use the full `$id` URI.
- **`tsx` version drift:** Pinning `tsx` in `package.json` prevents surprise breakage but requires periodic updates. Mitigation: use caret range (`^4.x`) and rely on lockfile for CI determinism.

## Sources & References

- Related code: `scripts/validate-schemas.js`, `.github/workflows/validate.yml`, `examples/python/server.py`, `examples/typescript/server.ts`
- External docs: [ajv 2020-12](https://ajv.js.org/guide/schema-language.html), [ajv-formats](https://github.com/ajv-validator/ajv-formats), [JSON-RPC 2.0 spec](https://www.jsonrpc.org/specification), [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
