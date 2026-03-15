# Contributing

Thank you for your interest in improving these MCP extension proposals. Contributions of all kinds are welcome — schemas, implementations, example manifests, corrections, and discussion.

## What's Needed

Check the [coverage matrix](examples/README.md#coverage-matrix) to see which proposals still lack schemas or implementations. High-impact areas:

| Area | What's Missing |
|------|---------------|
| Proposal #9 (Data References) | Reference implementation (Python, TypeScript) |
| Proposal #10 (Multimodal Signatures) | Reference implementation |
| Proposal #12 (Conformance Test Suite) | Everything — schema, test runner, validation logic |
| Proposal #13 (Server Discovery) | Reference implementation |
| Proposal #15 (Bidirectional Push) | Reference implementation |
| Example Manifests | Slack, Linear, Notion, or other real-world servers |

## Guidelines

### Schemas

- Use [JSON Schema Draft-07](https://json-schema.org/draft-07/json-schema-release-notes.html) for consistency with existing schemas
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

This checks that all example manifests conform to the service manifest schema and that all schemas are valid JSON Schema Draft-07.

## License

By contributing, you agree that your contributions will be licensed under [CC BY 4.0](LICENSE.md).
