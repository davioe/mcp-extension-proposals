# Proposal 13: Server Discovery

## Spec References Examined

- **MCP Registry (launched September 2025)** — A catalog of known MCP servers, providing a browsing/listing service for discovering available servers. Servers can be listed with metadata including name, description, and capabilities. The registry is a directory, not a search engine.
- **`initialize` capabilities exchange** (MCP 2025-11-25) — Declares capabilities after connection is established. Does not help with pre-connection discovery (finding a server that has the capabilities you need).
- **Extensions framework (GA)** — Allows extending the protocol with custom capabilities. Discovery extensions would use this framework.

## Current Coverage

The ecosystem provides one relevant mechanism:

1. **MCP Registry**: A catalog/listing service where MCP servers can be registered and browsed. Users and clients can look up known servers by name or browse categories. This covers "what servers exist?" but not "which server best matches my needs?"

The registry is a static directory — it does not support capability-based queries, relevance scoring, or programmatic search APIs exposed to MCP clients during runtime.

## Remaining Gap

- **Capability-based search**: No mechanism for clients to query "find me a server that supports tool X" or "find me a server that can process JPEG images." The registry supports browsing but not structured capability-based queries.
- **Recommendation/scoring**: No `match_confidence` scoring or recommendation engine. Clients cannot receive ranked results based on capability match, reliability, latency, or cost.
- **Programmatic query API**: No API exposed to MCP clients for runtime discovery. The registry is a web-based catalog, not a protocol-level discovery service that clients can invoke programmatically during operation.
- **Federated discovery**: No mechanism for discovering servers across multiple registries or organizational boundaries.
- **Health and availability**: No mechanism to check whether discovered servers are currently healthy, available, and accepting connections.

## Design Changes Required

- Define an MCP Extension for capability-based server discovery, using the Extensions framework. This could be a specialized tool or a new protocol method.
- Define a query schema for capability-based search (e.g., "I need a server with tools matching these input/output schemas").
- Define a response schema with match scoring, server metadata, and connection information.
- Consider integration with the existing MCP Registry as the backing data source, while exposing a programmatic query interface.

## Verdict

**Partially Addressed (minor)** — The MCP Registry exists as a catalog for discovering servers by browsing, but it lacks capability-based search, recommendation scoring, and a programmatic query API exposed to MCP clients. The Extensions framework provides the integration point for this proposal.
