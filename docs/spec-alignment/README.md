# Spec Alignment Audit

This directory contains per-proposal audits against the MCP specification (baseline: **2025-11-25**). Each audit file examines how the current spec and active SEPs address the gaps identified in our extension proposals, determining what remains unaddressed and what design changes are required to align with or complement the spec.

## Audit Template

Each file follows this structure:

```
# Proposal N: [Name]

## Spec References Examined
- List of spec sections, SEPs, and mechanisms reviewed

## Current Coverage
- What the spec already provides that overlaps with this proposal

## Remaining Gap
- What the spec does NOT address that our proposal covers

## Design Changes Required
- Adjustments to our proposal based on the audit findings

## Verdict
- One of:
  - **Gap** — The spec does not address this proposal's concerns at all
  - **Partially Addressed (minor)** — The spec covers most of the proposal; small gaps remain
  - **Partially Addressed (major)** — The spec covers some aspects but significant gaps remain
  - **Superseded** — The spec fully addresses the proposal's concerns; no extension needed
```
