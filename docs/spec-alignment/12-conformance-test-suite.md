# Proposal 12: Conformance Test Suite

## Spec References Examined

- **MCP Specification (2025-11-25)** — Defines the protocol including message formats, lifecycle, capabilities, tools, resources, prompts, and transports. The spec is normative but does not include a conformance test suite, test runner, or pass/fail criteria for implementations.
- **MCP governance roadmap** — Conformance testing is part of the governance roadmap as a future initiative. No concrete deliverables, timelines, or specifications have been published.
- **Extensions framework (GA)** — Relevant insofar as conformance tests would need to validate both core protocol behavior and extension behavior.

## Current Coverage

The spec defines the protocol normatively but provides no mechanism to validate that an implementation conforms to it. There is no:

1. **Test schema**: No machine-readable definition of test cases that cover required protocol behaviors.
2. **Test runner**: No reference implementation of a conformance test runner that can be pointed at a server and report results.
3. **Pass/fail criteria**: No formal definition of what constitutes a conforming implementation (e.g., which capabilities are mandatory, which are optional, what error handling is required).

Individual SDK repositories may include their own unit tests, but these test SDK behavior, not protocol conformance.

## Remaining Gap

- **Conformance test schema**: No standardized, machine-readable test suite definition that enumerates required protocol behaviors and expected responses.
- **Test runner**: No reference test runner that can validate an arbitrary MCP server against the spec. Implementers must manually verify conformance by reading the spec.
- **Pass/fail criteria**: No formal conformance levels (e.g., "Core", "Extended", "Full") with clear pass/fail boundaries.
- **Certification/badging**: No mechanism for servers to demonstrate or advertise their conformance level.
- **Extension conformance**: No framework for extensions to define their own conformance tests, ensuring that extension implementations are interoperable.
- **Regression testing**: No CI-friendly test suite that implementers can run to catch regressions after spec updates.

## Design Changes Required

- Define a conformance test schema format (e.g., a JSON/YAML definition of test cases with inputs, expected outputs, and assertions).
- Build a reference test runner that connects to an MCP server and executes the test suite, reporting pass/fail results.
- Define conformance levels that map to spec capabilities (Core: lifecycle + tools, Extended: resources + prompts, Full: all features).
- Publish the test suite alongside the spec, with versioning tied to spec revisions.

## Verdict

**Gap** — The spec defines the protocol but provides no conformance test suite, test runner, or pass/fail criteria. Conformance testing is on the governance roadmap but has no concrete deliverables. The Extensions framework is relevant for ensuring extension-level conformance testing.
