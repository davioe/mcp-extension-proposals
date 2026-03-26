/**
 * Cross-Server Saga Orchestration Demo (TypeScript) — Real HTTP Transport
 *
 * Demonstrates the client-side Saga pattern described in SEP-0000 (Cross-Server
 * Coordination section).  A SagaOrchestrator drives a multi-step workflow across
 * three independent HTTP MCP servers, compensating completed steps on failure.
 *
 * Scenario A: All compensations succeed (clean rollback).
 * Scenario B: One compensation fails because a server is shut down mid-rollback
 *             (ECONNREFUSED -> compensation_failed).
 *
 * Three real HTTP servers run on random ports:
 *   - Jira server:       owns its own ticket store, supports create_ticket / delete_ticket
 *   - Confluence server:  owns its own ticket store, supports create_ticket / delete_ticket
 *   - Slack server:       returns JSON-RPC -32601 "Method not found" for any tools/call
 *
 * No external dependencies.  Usage:
 *   npx tsx saga-demo.ts
 */

import * as http from "http";
import * as crypto from "crypto";

// =============================================================================
// HTTP helper — raw POST using Node.js built-in http module
// =============================================================================

function httpPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

// =============================================================================
// MCP Server factories — each server is an independent http.Server
// =============================================================================

interface Ticket {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

function createTicketServer(prefix: string): {
  server: http.Server;
  getUrl: () => string;
} {
  const tickets = new Map<string, Ticket>();
  let counter = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawBody);
      } catch {
        const errResp = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(errResp));
        return;
      }

      const requestId = msg.id;
      const method = msg.method as string;
      const params = (msg.params ?? {}) as Record<string, unknown>;

      if (method === "tools/call") {
        const toolName = params.name as string;
        const args = (params.arguments ?? {}) as Record<string, unknown>;

        let result: Record<string, unknown>;

        if (toolName === "create_ticket") {
          counter++;
          const ticketId = `${prefix}-${counter}`;
          const ticket: Ticket = {
            id: ticketId,
            title: args.title as string,
            status: "open",
            created_at: new Date().toISOString(),
          };
          tickets.set(ticketId, ticket);
          result = {
            ticket: { id: ticketId, title: ticket.title },
            created: true,
          };
        } else if (toolName === "delete_ticket") {
          const ticketId = args.ticket_id as string;
          if (!tickets.has(ticketId)) {
            result = {
              error: {
                code: "RESOURCE_NOT_FOUND",
                message: `Ticket ${ticketId} does not exist.`,
                category: "permanent",
              },
            };
          } else {
            tickets.delete(ticketId);
            result = { deleted: true, ticket_id: ticketId };
          }
        } else {
          const errResp = {
            jsonrpc: "2.0",
            id: requestId,
            error: { code: -32601, message: `Method not found: ${toolName}` },
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(errResp));
          return;
        }

        const resp = { jsonrpc: "2.0", id: requestId, result };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
        return;
      }

      // Not tools/call
      const errResp = {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(errResp));
    });
  });

  return {
    server,
    getUrl: () => {
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

function createSlackServer(): {
  server: http.Server;
  getUrl: () => string;
} {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawBody);
      } catch {
        const errResp = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(errResp));
        return;
      }

      // Always return Method not found for any tools/call
      const errResp = {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found" },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(errResp));
    });
  });

  return {
    server,
    getUrl: () => {
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

function listenOnRandomPort(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// =============================================================================
// Saga Orchestrator
// =============================================================================

interface CompensationEntry {
  serverUrl: string;
  serverLabel: string;
  stepId: string;
  compensationTool: string;
  compensationArguments: Record<string, unknown>;
  idempotencyKey: string;
  status: "pending" | "compensated" | "compensation_failed";
}

class SagaOrchestrator {
  compensationLog: CompensationEntry[] = [];
  private stepNumber = 0;

  async executeStep(
    serverUrl: string,
    serverLabel: string,
    toolName: string,
    args: Record<string, unknown>,
    compensationTool: string,
    compensationArgsFn?: (result: Record<string, unknown>) => Record<string, unknown>
  ): Promise<{ success: boolean; step: number; result?: Record<string, unknown> }> {
    this.stepNumber++;
    const stepNum = this.stepNumber;

    const rpcRequest = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: crypto.randomUUID(),
    };

    let rawResponse: string;
    try {
      rawResponse = await httpPost(serverUrl, JSON.stringify(rpcRequest));
    } catch {
      console.log(`  Step ${stepNum} [${serverLabel}]: ${toolName} -> FAILED`);
      await this.rollback();
      return { success: false, step: stepNum };
    }

    const response = JSON.parse(rawResponse) as Record<string, unknown>;

    // JSON-RPC level error
    if (response.error) {
      console.log(`  Step ${stepNum} [${serverLabel}]: ${toolName} -> FAILED`);
      await this.rollback();
      return { success: false, step: stepNum };
    }

    const result = (response.result ?? {}) as Record<string, unknown>;

    // Application-level structured error
    if (result.error) {
      console.log(`  Step ${stepNum} [${serverLabel}]: ${toolName} -> FAILED`);
      await this.rollback();
      return { success: false, step: stepNum };
    }

    const compArgs = compensationArgsFn ? compensationArgsFn(result) : {};
    const ticketObj = result.ticket as Record<string, unknown> | undefined;
    const ticketId = ticketObj?.id ?? `step-${stepNum}`;
    const stepId = `create-${ticketId}`;

    this.compensationLog.push({
      serverUrl,
      serverLabel,
      stepId,
      compensationTool: compensationTool,
      compensationArguments: compArgs,
      idempotencyKey: `compensate-${crypto.randomUUID()}`,
      status: "pending",
    });

    console.log(`  Step ${stepNum} [${serverLabel}]: ${toolName} -> success (${ticketId})`);
    return { success: true, step: stepNum, result };
  }

  async rollback(): Promise<void> {
    console.log("  Initiating rollback...");

    for (let i = this.compensationLog.length - 1; i >= 0; i--) {
      const entry = this.compensationLog[i];

      const rpcRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: entry.compensationTool,
          arguments: entry.compensationArguments,
          _meta: { idempotency_key: entry.idempotencyKey },
        },
        id: crypto.randomUUID(),
      };

      let rawResponse: string;
      try {
        rawResponse = await httpPost(entry.serverUrl, JSON.stringify(rpcRequest));
      } catch (err: unknown) {
        // Connection error (e.g. ECONNREFUSED when server is shut down)
        entry.status = "compensation_failed";
        console.log(
          `  Compensate Step ${i + 1}: ${entry.compensationTool} -> FAILED (compensation_failed)`
        );
        continue;
      }

      const resp = JSON.parse(rawResponse) as Record<string, unknown>;
      const result = (resp.result ?? {}) as Record<string, unknown>;

      if (resp.error || result.error) {
        entry.status = "compensation_failed";
        console.log(
          `  Compensate Step ${i + 1}: ${entry.compensationTool} -> FAILED (compensation_failed)`
        );
      } else {
        entry.status = "compensated";
        console.log(
          `  Compensate Step ${i + 1}: ${entry.compensationTool} -> success`
        );
      }
    }

    const failed = this.compensationLog.filter(
      (e) => e.status === "compensation_failed"
    ).length;
    const total = this.compensationLog.length;

    if (failed === 0) {
      console.log("  Result: Clean rollback — all compensations succeeded");
    } else {
      console.log(
        `  Result: Partial rollback — ${failed} of ${total} compensations failed`
      );
    }
  }

  printCompensationLog(): void {
    console.log();
    console.log("  Compensation Log:");
    this.compensationLog.forEach((entry, i) => {
      console.log(`    [${i + 1}] ${entry.serverLabel}/${entry.stepId}: ${entry.status}`);
    });
  }
}

// =============================================================================
// Demo Scenarios
// =============================================================================

async function scenarioA(
  jiraUrl: string,
  confluenceUrl: string,
  slackUrl: string
): Promise<void> {
  const saga = new SagaOrchestrator();

  // Step 1: jira-server -> create_ticket
  await saga.executeStep(
    jiraUrl,
    "jira-server",
    "create_ticket",
    { title: "Deploy v2.1" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 2: confluence-server -> create_ticket
  await saga.executeStep(
    confluenceUrl,
    "confluence-server",
    "create_ticket",
    { title: "Link docs" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 3: slack-server -> post_message (will fail: Method not found)
  await saga.executeStep(
    slackUrl,
    "slack-server",
    "post_message",
    { channel: "#releases", text: "Deployed v2.1" },
    "delete_message",
    () => ({})
  );

  saga.printCompensationLog();
}

async function scenarioB(
  jiraUrl: string,
  confluenceUrl: string,
  slackUrl: string,
  jiraServer: http.Server
): Promise<void> {
  const saga = new SagaOrchestrator();

  // Step 1: jira-server -> create_ticket
  await saga.executeStep(
    jiraUrl,
    "jira-server",
    "create_ticket",
    { title: "Deploy v2.1" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 2: confluence-server -> create_ticket
  await saga.executeStep(
    confluenceUrl,
    "confluence-server",
    "create_ticket",
    { title: "Link docs" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 3: slack-server -> post_message (will fail: Method not found)
  // Before rollback begins, shut down the Jira server so its compensation
  // will get ECONNREFUSED.
  await closeServer(jiraServer);

  await saga.executeStep(
    slackUrl,
    "slack-server",
    "post_message",
    { channel: "#releases", text: "Deployed v2.1" },
    "delete_message",
    () => ({})
  );

  saga.printCompensationLog();
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  // Create three independent HTTP servers
  const jira = createTicketServer("JIRA");
  const confluence = createTicketServer("CONF");
  const slack = createSlackServer();

  await Promise.all([
    listenOnRandomPort(jira.server),
    listenOnRandomPort(confluence.server),
    listenOnRandomPort(slack.server),
  ]);

  const jiraUrl = jira.getUrl();
  const confluenceUrl = confluence.getUrl();
  const slackUrl = slack.getUrl();

  console.log("=== Cross-Server Saga Demo ===");
  console.log();
  console.log(`  Jira server:       ${jiraUrl}`);
  console.log(`  Confluence server:  ${confluenceUrl}`);
  console.log(`  Slack server:       ${slackUrl}`);
  console.log();

  console.log("--- Scenario A: Clean Rollback ---");
  await scenarioA(jiraUrl, confluenceUrl, slackUrl);
  console.log();

  // For Scenario B we need a fresh Jira server (Scenario A's is still running
  // but its ticket store was mutated).  Re-create so the demo is self-contained.
  const jiraB = createTicketServer("JIRA");
  await listenOnRandomPort(jiraB.server);
  const jiraBUrl = jiraB.getUrl();

  console.log("--- Scenario B: Partial Rollback ---");
  await scenarioB(jiraBUrl, confluenceUrl, slackUrl, jiraB.server);
  console.log();

  console.log("=== Demo complete ===");

  // Shut down remaining servers
  await Promise.all([
    closeServer(jira.server),
    closeServer(confluence.server),
    closeServer(slack.server),
  ]).catch(() => {});

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
