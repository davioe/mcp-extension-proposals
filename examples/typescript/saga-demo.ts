/**
 * Cross-Server Saga Orchestration Demo (TypeScript)
 *
 * Demonstrates the client-side Saga pattern described in SEP-0000 (Cross-Server
 * Coordination section).  A SagaOrchestrator drives a multi-step workflow across
 * simulated MCP servers, compensating completed steps on failure.
 *
 * Scenario A: All compensations succeed (clean rollback).
 * Scenario B: One compensation fails (partial rollback).
 *
 * NOTE: The three "servers" (jira-server, confluence-server, slack-server) are
 * simulated by routing every call through the same processJsonRpc() function.
 * They share one ticket store.  In a real deployment each serverId would
 * correspond to a separate MCP server connection.
 *
 * No external dependencies.  Usage:
 *   npx tsx saga-demo.ts
 */

// =============================================================================
// Minimal infrastructure (lightweight subset of server.ts)
// =============================================================================

import { randomUUID } from "crypto";

interface Ticket {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const tickets: Map<string, Ticket> = new Map();
let ticketCounter = 0;

function resetStore(): void {
  tickets.clear();
  ticketCounter = 0;
}

// --- Structured error helper ------------------------------------------------

function structuredError(
  code: string,
  message: string,
  category: string
): Record<string, unknown> {
  return { error: { code, message, category } };
}

// --- Tool handlers ----------------------------------------------------------

function handleCreateTicket(params: Record<string, unknown>): Record<string, unknown> {
  ticketCounter++;
  const ticketId = `PROJ-${ticketCounter}`;
  const ticket: Ticket = {
    id: ticketId,
    title: params.title as string,
    status: "open",
    created_at: new Date().toISOString(),
  };
  tickets.set(ticketId, ticket);
  return { ticket: { id: ticketId, title: ticket.title }, created: true };
}

function handleDeleteTicket(params: Record<string, unknown>): Record<string, unknown> {
  const ticketId = params.ticket_id as string;
  if (!tickets.has(ticketId)) {
    return structuredError(
      "RESOURCE_NOT_FOUND",
      `Ticket ${ticketId} does not exist.`,
      "permanent"
    );
  }
  tickets.delete(ticketId);
  return { deleted: true, ticket_id: ticketId };
}

// --- Request router ---------------------------------------------------------

async function handleRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = request.tool as string;
  const params = (request.parameters ?? {}) as Record<string, unknown>;

  switch (tool) {
    case "create_ticket":
      return handleCreateTicket(params);
    case "delete_ticket":
      return handleDeleteTicket(params);
    default:
      return structuredError("RESOURCE_NOT_FOUND", `Unknown tool: ${tool}`, "permanent");
  }
}

// --- JSON-RPC 2.0 layer (from server.ts) ------------------------------------

function buildJsonRpcRequest(
  method: string,
  params?: Record<string, unknown>,
  requestId?: string
): string {
  const msg: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params: params ?? {},
    id: requestId ?? randomUUID(),
  };
  return JSON.stringify(msg);
}

function buildJsonRpcResponse(requestId: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: requestId, result };
}

function buildJsonRpcError(
  requestId: unknown,
  code: number,
  message: string
): Record<string, unknown> {
  return { jsonrpc: "2.0", id: requestId, error: { code, message } };
}

async function processJsonRpc(rawJson: string): Promise<string> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(rawJson);
  } catch {
    return JSON.stringify(buildJsonRpcError(null, -32700, "Parse error"));
  }

  const requestId = msg.id;
  const method = msg.method as string;
  const params = (msg.params ?? {}) as Record<string, unknown>;

  if (method === "tools/call") {
    const toolName = params.name as string;
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await handleRequest({ tool: toolName, parameters: args });
      return JSON.stringify(buildJsonRpcResponse(requestId, result));
    } catch (e: unknown) {
      return JSON.stringify(
        buildJsonRpcError(requestId, -32603, String(e))
      );
    }
  }

  return JSON.stringify(
    buildJsonRpcError(requestId, -32601, `Method not found: ${method}`)
  );
}

// =============================================================================
// Saga Orchestrator
// =============================================================================

interface CompensationEntry {
  server_id: string;
  step_id: string;
  compensation_tool: string;
  compensation_arguments: Record<string, unknown>;
  idempotency_key: string;
  status: "pending" | "compensated" | "compensation_failed";
}

class SagaOrchestrator {
  compensationLog: CompensationEntry[] = [];
  private stepNumber = 0;

  async executeStep(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    compensationTool: string,
    compensationArgsFn?: (result: Record<string, unknown>) => Record<string, unknown>
  ): Promise<{ success: boolean; step: number; result?: Record<string, unknown> }> {
    this.stepNumber++;
    const stepNum = this.stepNumber;

    const request = buildJsonRpcRequest("tools/call", {
      name: toolName,
      arguments: args,
    });

    // All "servers" route through the same processJsonRpc — see module header.
    const rawResponse = await processJsonRpc(request);
    const response = JSON.parse(rawResponse) as Record<string, unknown>;

    // JSON-RPC level error
    if (response.error) {
      console.log(`  Step ${stepNum} [${serverId}]: ${toolName} -> FAILED`);
      await this.rollback();
      return { success: false, step: stepNum };
    }

    const result = (response.result ?? {}) as Record<string, unknown>;

    // Application-level structured error
    if (result.error) {
      console.log(`  Step ${stepNum} [${serverId}]: ${toolName} -> FAILED`);
      await this.rollback();
      return { success: false, step: stepNum };
    }

    const compArgs = compensationArgsFn ? compensationArgsFn(result) : {};
    const ticketObj = result.ticket as Record<string, unknown> | undefined;
    const ticketId = ticketObj?.id ?? `step-${stepNum}`;
    const stepId = `create-${ticketId}`;

    this.compensationLog.push({
      server_id: serverId,
      step_id: stepId,
      compensation_tool: compensationTool,
      compensation_arguments: compArgs,
      idempotency_key: `compensate-${randomUUID()}`,
      status: "pending",
    });

    console.log(`  Step ${stepNum} [${serverId}]: ${toolName} -> success (${ticketId})`);
    return { success: true, step: stepNum, result };
  }

  async rollback(): Promise<void> {
    console.log("  Initiating rollback...");

    for (let i = this.compensationLog.length - 1; i >= 0; i--) {
      const entry = this.compensationLog[i];
      const request = buildJsonRpcRequest("tools/call", {
        name: entry.compensation_tool,
        arguments: entry.compensation_arguments,
        _meta: { idempotency_key: entry.idempotency_key },
      });

      const raw = await processJsonRpc(request);
      const resp = JSON.parse(raw) as Record<string, unknown>;
      const result = (resp.result ?? {}) as Record<string, unknown>;

      if (resp.error || result.error) {
        entry.status = "compensation_failed";
        console.log(
          `  Compensate Step ${i + 1}: ${entry.compensation_tool} -> FAILED (compensation_failed)`
        );
      } else {
        entry.status = "compensated";
        console.log(
          `  Compensate Step ${i + 1}: ${entry.compensation_tool} -> success`
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
      console.log(`    [${i + 1}] ${entry.server_id}/${entry.step_id}: ${entry.status}`);
    });
  }
}

// =============================================================================
// Demo Scenarios
// =============================================================================

async function scenarioA(): Promise<void> {
  resetStore();
  const saga = new SagaOrchestrator();

  // Step 1: jira-server -> create_ticket
  await saga.executeStep(
    "jira-server",
    "create_ticket",
    { title: "Deploy v2.1" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 2: confluence-server -> create_ticket
  await saga.executeStep(
    "confluence-server",
    "create_ticket",
    { title: "Link docs" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 3: slack-server -> post_message (will fail: unknown tool)
  await saga.executeStep(
    "slack-server",
    "post_message",
    { channel: "#releases", text: "Deployed v2.1" },
    "delete_message",
    () => ({})
  );

  saga.printCompensationLog();
}

async function scenarioB(): Promise<void> {
  resetStore();
  const saga = new SagaOrchestrator();

  // Step 1: create_ticket — compensation deliberately uses nonexistent ticket ID
  await saga.executeStep(
    "jira-server",
    "create_ticket",
    { title: "Deploy v2.1" },
    "delete_ticket",
    () => ({ ticket_id: "PROJ-9999" }) // injected failure for compensation
  );

  // Step 2: create_ticket
  await saga.executeStep(
    "confluence-server",
    "create_ticket",
    { title: "Link docs" },
    "delete_ticket",
    (r) => ({ ticket_id: (r.ticket as Record<string, unknown>).id })
  );

  // Step 3: fail (unknown tool)
  await saga.executeStep(
    "slack-server",
    "post_message",
    { channel: "#releases", text: "Deployed v2.1" },
    "delete_message",
    () => ({})
  );

  saga.printCompensationLog();
}

async function main(): Promise<void> {
  console.log("=== Cross-Server Saga Demo ===");
  console.log();
  console.log("--- Scenario A: Clean Rollback ---");
  await scenarioA();
  console.log();
  console.log("--- Scenario B: Partial Rollback ---");
  await scenarioB();
  console.log();
  console.log("=== Demo complete ===");
}

main().catch(console.error);
