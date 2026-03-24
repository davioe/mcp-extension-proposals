# Contributing

Thank you for your interest in improving these MCP extension proposals. Contributions of all kinds are welcome — schemas, implementations, example manifests, corrections, and discussion.

## What's Needed

Check the [coverage matrix](examples/README.md#coverage-matrix) to see which proposals still lack schemas or implementations. High-impact areas:

All 15 proposals now have schemas and reference implementations. Areas where contributions would be most valuable:

| Area | What's Needed |
|------|---------------|
| Security review | Session state (#14) and transaction (#5) models need adversarial analysis |
| Co-implementation | MCP server authors willing to implement these extensions in real servers |
| Conformance test runner | A real test runner (beyond the demo) that validates servers against the conformance schema |
| Additional manifests | Real-world servers beyond the current 5 (GitHub, Jira, Slack, Linear, Notion) |
| SEP feedback | Review of the prepared SEP documents in `seps/` |

## Guidelines

### Schemas

- Use [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/release-notes) for consistency with existing schemas and the MCP specification (per SEP-1613)
- Place schema files in `schemas/` with the naming pattern `<feature>.schema.json`
- Include a `$schema`, `$id`, `title`, and `description` at the top level
- Use `$defs` for sub-definitions rather than inline schemas
- Add `examples` to properties where the valid values aren't obvious

### Reference Implementations

- Place implementations in `examples/python/` or `examples/typescript/`
- Keep them dependency-free where possible (Python: stdlib only; TypeScript: Node.js built-ins + `tsx`)
- Include a demo function that exercises the feature end-to-end
- Mark reference implementations clearly — they are for illustration, not production use

### Example Manifests

- Place manifests in `examples/manifests/` with the pattern `<service>-server-manifest.json`
- Manifests must validate against `schemas/service-manifest.schema.json`
- Use realistic data — real tool names, plausible scopes, accurate cost/latency estimates

### General

- Keep PRs focused — one proposal or one feature per PR
- Update the coverage matrix in `examples/README.md` when adding new artifacts
- Run the validation script (`scripts/validate-schemas.js`) before submitting

## Validation

To validate all manifests and schemas locally:

```bash
node scripts/validate-schemas.js
```

This checks that all example manifests conform to the service manifest schema and that all schemas are valid JSON Schema 2020-12.

CI runs this validation automatically on every push and pull request via GitHub Actions.

## License

By contributing, you agree that your contributions will be licensed under [CC BY 4.0](LICENSE.md).
