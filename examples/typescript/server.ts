/**
 * MCP Extended Server — TypeScript Reference Implementation
 *
 * A minimal but complete MCP server demonstrating the proposed protocol extensions:
 * - Service manifest with capability discovery
 * - Granular permissions and scoped auth
 * - Idempotency keys and transactions
 * - Structured error responses
 * - Streaming with progress notifications
 * - Provenance on responses
 * - Human-in-the-loop confirmation
 * - Intent hints
 * - Session state
 *
 * This is a reference implementation, not production code.
 *
 * Requirements:
 *   npm install typescript tsx
 *
 * Usage:
 *   npx tsx server.ts
 */

// =============================================================================
// Domain: A simple project management server (tickets)
// =============================================================================

interface Ticket {
  id: string;
  title: string;
  status: "open" | "in_progress" | "closed";
  assignee: string | null;
  created_at: string;
}

interface StructuredError {
  error: {
    code: string;
    message: string;
    category: "transient" | "permanent" | "auth_required" | "invalid_input" | "rate_limited";
    retry_after_seconds?: number;
    user_actionable: boolean;
    suggestion?: string;
    details?: Record<string, unknown>;
  };
}

interface Provenance {
  source: string;
  retrieved_at: string;
  confidence: "exact" | "derived" | "estimated" | "uncertain";
  transformation?: string;
  location?: Record<string, unknown>;
  version?: string;
}

interface ProvenanceWrapped<T> {
  result: T;
  provenance: Provenance;
  session_state?: string;
}

interface ProgressNotification {
  type: "progress";
  operation_id: string;
  progress: number;
  message: string;
  estimated_remaining_seconds?: number;
  checkpoint_token?: string;
}

interface TransactionStepRecord {
  step_id: string;
  tool: string;
  result: unknown;
  compensation_tool: string;
  compensation_params: Record<string, unknown>;
}

// In-memory store
const tickets: Map<string, Ticket> = new Map([
  ["PROJ-1", { id: "PROJ-1", title: "Fix login bug", status: "open", assignee: "alice", created_at: new Date().toISOString() }],
  ["PROJ-2", { id: "PROJ-2", title: "Add dark mode", status: "in_progress", assignee: "bob", created_at: new Date().toISOString() }],
  ["PROJ-3", { id: "PROJ-3", title: "Update dependencies", status: "closed", assignee: "alice", created_at: new Date().toISOString() }],
]);

// =============================================================================
// Extension 1: Service Manifest
// =============================================================================

const SERVICE_MANIFEST = {
  manifest_version: "0.1.0",
  server: {
    name: "project-tracker-mcp",
    version: "1.0.0",
    mcp_spec_version: "2026-01-01",
    description: "A project management MCP server for tracking tickets.",
    homepage: "https://github.com/example/project-tracker-mcp",
  },
  auth: {
    methods: ["oauth2_device", "api_key"],
    scopes: [
      { name: "read:tickets", description: "Read ticket data", grants: ["search_tickets", "get_ticket"] },
      { name: "write:tickets", description: "Create and modify tickets", grants: ["create_ticket", "update_ticket"] },
      { name: "delete:tickets", description: "Delete tickets", grants: ["delete_ticket"] },
    ],
    session_ttl_seconds: 1800,
  },
  tools: [
    {
      name: "search_tickets",
      description: "Search for tickets by query string.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          status: { type: "string", enum: ["open", "in_progress", "closed"] },
          assignee: { type: "string" },
        },
      },
      cost: { category: "free" },
      latency: "instant",
      idempotent: true,
      requires_confirmation: false,
      risk_level: "safe",
      required_scopes: ["read:tickets"],
    },
    {
      name: "create_ticket",
      description: "Create a new ticket.",
      input_schema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          assignee: { type: "string" },
          status: { type: "string", enum: ["open", "in_progress"], default: "open" },
        },
      },
      cost: { category: "free" },
      latency: "instant",
      idempotent: false,
      requires_confirmation: false,
      risk_level: "safe",
      required_scopes: ["write:tickets"],
    },
    {
      name: "delete_ticket",
      description: "Permanently delete a ticket. This action cannot be undone.",
      input_schema: {
        type: "object",
        required: ["ticket_id"],
        properties: { ticket_id: { type: "string" } },
      },
      cost: { category: "free" },
      latency: "instant",
      idempotent: true,
      requires_confirmation: true,
      confirmation_message: "This will permanently delete the ticket and all associated data. Proceed?",
      risk_level: "destructive",
      required_scopes: ["delete:tickets"],
    },
    {
      name: "export_tickets",
      description: "Export all tickets. May take time for large datasets.",
      input_schema: {
        type: "object",
        properties: { format: { type: "string", enum: ["csv", "json"], default: "csv" } },
      },
      cost: { category: "metered", estimated_units: 1, unit_label: "export credits" },
      latency: "seconds",
      idempotent: true,
      requires_confirmation: false,
      risk_level: "safe",
      required_scopes: ["read:tickets"],
      supports_streaming: true,
    },
  ],
  supported_extensions: [
    "streaming",
    "progress_notifications",
    "idempotency",
    "transactions",
    "session_state",
    "intent_hints",
    "provenance",
    "human_in_the_loop",
  ],
  rate_limits: {
    requests_per_minute: 60,
    requests_per_day: 10000,
  },
} as const;

// =============================================================================
// Extension 4: Permission Checker
// =============================================================================

class PermissionChecker {
  private grantedScopes: Set<string>;

  constructor(scopes: string[]) {
    this.grantedScopes = new Set(scopes);
  }

  canExecute(toolName: string): { allowed: boolean; missing_scopes?: string[]; reason?: string; elevation_url?: string } {
    const toolDef = SERVICE_MANIFEST.tools.find((t) => t.name === toolName);
    if (!toolDef) {
      return { allowed: false, reason: `Unknown tool: ${toolName}` };
    }

    const required = new Set(toolDef.required_scopes);
    const missing = [...required].filter((s) => !this.grantedScopes.has(s));

    if (missing.length > 0) {
      return {
        allowed: false,
        missing_scopes: missing,
        reason: `Missing required scopes: ${missing.join(", ")}`,
        elevation_url: "https://example.com/auth/elevate",
      };
    }
    return { allowed: true };
  }
}

// =============================================================================
// Extension 5: Idempotency Store
// =============================================================================

class IdempotencyStore {
  private store = new Map<string, { result: unknown; timestamp: string; expires_at: number }>();

  get(key: string): { result: unknown; timestamp: string } | null {
    const entry = this.store.get(key);
    if (entry && Date.now() < entry.expires_at) {
      return { result: entry.result, timestamp: entry.timestamp };
    }
    return null;
  }

  set(key: string, result: unknown, ttlSeconds = 86400): void {
    this.store.set(key, {
      result,
      timestamp: new Date().toISOString(),
      expires_at: Date.now() + ttlSeconds * 1000,
    });
  }
}

// =============================================================================
// Extension 5: Transaction Manager
// =============================================================================

class TransactionManager {
  private transactions = new Map<string, TransactionStepRecord[]>();

  begin(transactionId: string): Record<string, unknown> {
    if (this.transactions.has(transactionId)) {
      return createStructuredError("TRANSACTION_CONFLICT", `Transaction ${transactionId} already exists.`, "permanent");
    }
    this.transactions.set(transactionId, []);
    return { status: "begun", transaction_id: transactionId };
  }

  addStep(transactionId: string, step: TransactionStepRecord): void {
    this.transactions.get(transactionId)?.push(step);
  }

  commit(transactionId: string): Record<string, unknown> {
    if (!this.transactions.has(transactionId)) {
      return createStructuredError("RESOURCE_NOT_FOUND", `No active transaction with ID ${transactionId}.`, "permanent");
    }
    const steps = this.transactions.get(transactionId)!;
    this.transactions.delete(transactionId);
    return { status: "committed", transaction_id: transactionId, steps_completed: steps.length };
  }

  rollback(transactionId: string): Record<string, unknown> {
    if (!this.transactions.has(transactionId)) {
      return createStructuredError("RESOURCE_NOT_FOUND", `No active transaction with ID ${transactionId}.`, "permanent");
    }
    const steps = this.transactions.get(transactionId)!;
    this.transactions.delete(transactionId);

    const compensated = [...steps].reverse().map((step) => {
      try {
        if (step.compensation_tool === "delete_ticket") {
          const ticketId = step.compensation_params.ticket_id as string;
          tickets.delete(ticketId);
        }
        return { step_id: step.step_id, status: "compensated" };
      } catch (e) {
        return { step_id: step.step_id, status: "compensation_failed", error: String(e) };
      }
    });

    return { status: "rolled_back", transaction_id: transactionId, steps_compensated: compensated };
  }
}

// =============================================================================
// Extension 11: Structured Errors
// =============================================================================

function createStructuredError(
  code: string,
  message: string,
  category: StructuredError["error"]["category"],
  options?: { retry_after?: number; suggestion?: string; user_actionable?: boolean; details?: Record<string, unknown> }
): StructuredError {
  return {
    error: {
      code,
      message,
      category,
      user_actionable: options?.user_actionable ?? true,
      ...(options?.retry_after !== undefined && { retry_after_seconds: options.retry_after }),
      ...(options?.suggestion && { suggestion: options.suggestion }),
      ...(options?.details && { details: options.details }),
    },
  };
}

// =============================================================================
// Extension 7: Provenance Helper
// =============================================================================

function withProvenance<T>(result: T, source: string, confidence: Provenance["confidence"] = "exact", extra?: Partial<Provenance>): ProvenanceWrapped<T> {
  return {
    result,
    provenance: {
      source,
      retrieved_at: new Date().toISOString(),
      confidence,
      ...extra,
    },
  };
}

// =============================================================================
// Extension 14: Session State
// =============================================================================

const SessionState = {
  encode: (state: Record<string, unknown>): string => Buffer.from(JSON.stringify(state)).toString("base64"),
  decode: (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token, "base64").toString("utf-8")),
};

// =============================================================================
// Tool Implementations
// =============================================================================

const idempotencyStore = new IdempotencyStore();
const transactionManager = new TransactionManager();
const permissions = new PermissionChecker(["read:tickets", "write:tickets"]);

function handleSearchTickets(params: Record<string, string>, intent?: string) {
  const query = (params.query ?? "").toLowerCase();
  const statusFilter = params.status;
  const assigneeFilter = params.assignee;

  // Extension 2: Intent Hints
  if (intent && intent.toLowerCase().includes("recent") && intent.toLowerCase().includes("incident")) {
    return {
      suggestion: {
        recommended_tool: "get_recent_incidents",
        reason: "For recent incidents, this tool filters by type and recency more efficiently.",
      },
      result: null,
    };
  }

  const results: Ticket[] = [];
  for (const ticket of tickets.values()) {
    if (query && !ticket.title.toLowerCase().includes(query)) continue;
    if (statusFilter && ticket.status !== statusFilter) continue;
    if (assigneeFilter && ticket.assignee !== assigneeFilter) continue;
    results.push(ticket);
  }

  return withProvenance({ tickets: results, total_count: results.length }, "project-tracker:tickets_table");
}

function handleCreateTicket(params: Record<string, string>, idempotencyKey?: string, transactionId?: string) {
  // Extension 5: Idempotency
  if (idempotencyKey) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached) {
      return {
        ...(cached.result as Record<string, unknown>),
        idempotency: { idempotency_key: idempotencyKey, was_replay: true, original_timestamp: cached.timestamp },
      };
    }
  }

  const ticketId = `PROJ-${tickets.size + 1}`;
  const ticket: Ticket = {
    id: ticketId,
    title: params.title,
    assignee: params.assignee ?? null,
    status: (params.status as Ticket["status"]) ?? "open",
    created_at: new Date().toISOString(),
  };
  tickets.set(ticketId, ticket);

  const result: Record<string, unknown> = withProvenance(
    { ticket, created: true },
    `project-tracker:tickets/${ticketId}`
  );

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, result);
    result.idempotency = { idempotency_key: idempotencyKey, was_replay: false };
  }

  // Extension 5: Transaction step
  if (transactionId) {
    transactionManager.addStep(transactionId, {
      step_id: `create-${ticketId}`,
      tool: "create_ticket",
      result,
      compensation_tool: "delete_ticket",
      compensation_params: { ticket_id: ticketId },
    });
    result.transaction = {
      transaction_id: transactionId,
      step_id: `create-${ticketId}`,
      compensation: { tool: "delete_ticket", parameters: { ticket_id: ticketId } },
    };
  }

  return result;
}

function handleDeleteTicket(params: Record<string, string>) {
  const ticketId = params.ticket_id;
  if (!tickets.has(ticketId)) {
    return createStructuredError("RESOURCE_NOT_FOUND", `Ticket ${ticketId} does not exist.`, "permanent", {
      suggestion: "Check the ticket ID and try again.",
    });
  }
  tickets.delete(ticketId);
  return { deleted: true, ticket_id: ticketId };
}

async function handleExportTickets(
  params: Record<string, string>,
  onProgress?: (notification: ProgressNotification) => void
) {
  const format = params.format ?? "csv";
  const allTickets = [...tickets.values()];
  const total = allTickets.length;
  const operationId = `export-${Date.now().toString(36)}`;

  const results: (string | Ticket)[] = [];
  for (let i = 0; i < allTickets.length; i++) {
    // Simulate processing time
    await new Promise((r) => setTimeout(r, 500));

    // Extension 8: Progress notification
    onProgress?.({
      type: "progress",
      operation_id: operationId,
      progress: (i + 1) / total,
      message: `Processing ticket ${i + 1} of ${total}`,
      estimated_remaining_seconds: (total - i - 1) * 0.5,
      checkpoint_token: `checkpoint-${i}`,
    });

    if (format === "csv") {
      const t = allTickets[i];
      results.push(`${t.id},${t.title},${t.status},${t.assignee}`);
    } else {
      results.push(allTickets[i]);
    }
  }

  const output = format === "csv" ? "id,title,status,assignee\n" + results.join("\n") : results;

  return withProvenance(
    { data: output, format, count: total },
    "project-tracker:tickets_table",
    "exact",
    { transformation: `Full export as ${format}` }
  );
}

// =============================================================================
// Request Router
// =============================================================================

interface MCPRequest {
  tool: string;
  parameters?: Record<string, string>;
  intent?: string;
  idempotency_key?: string;
  transaction_id?: string;
  session_state?: string;
  user_confirmed?: boolean;
}

async function handleRequest(request: MCPRequest): Promise<Record<string, unknown>> {
  const { tool, parameters = {}, intent, idempotency_key, transaction_id, session_state, user_confirmed } = request;

  // Extension 14: Decode session state
  let context: Record<string, unknown> = {};
  if (session_state) {
    try {
      context = SessionState.decode(session_state);
    } catch {
      return createStructuredError("INVALID_INPUT", "Invalid session state token.", "invalid_input", {
        suggestion: "Start a new session without a state token.",
      });
    }
  }

  // Meta-tools: manifest, permissions, transactions (no auth required)
  if (tool === "get_manifest") return { ...SERVICE_MANIFEST };
  if (tool === "check_permissions") return permissions.canExecute(parameters.tool);
  if (tool === "begin_transaction") return transactionManager.begin(parameters.transaction_id);
  if (tool === "commit_transaction") return transactionManager.commit(parameters.transaction_id);
  if (tool === "rollback_transaction") return transactionManager.rollback(parameters.transaction_id);

  // Extension 4: Permission check
  const permCheck = permissions.canExecute(tool);
  if (!permCheck.allowed) {
    return createStructuredError("SCOPE_INSUFFICIENT", permCheck.reason!, "auth_required", {
      suggestion: `Request scope elevation at ${permCheck.elevation_url ?? "N/A"}`,
      details: { missing_scopes: permCheck.missing_scopes },
    });
  }

  // Extension 6: Human-in-the-loop
  const toolDef = SERVICE_MANIFEST.tools.find((t) => t.name === tool);
  if (toolDef?.requires_confirmation && !user_confirmed) {
    return {
      requires_confirmation: true,
      confirmation_message: (toolDef as any).confirmation_message ?? "Are you sure?",
      risk_level: toolDef.risk_level,
      tool,
      parameters,
    };
  }

  // Route to handler
  let result: Record<string, unknown>;
  switch (tool) {
    case "search_tickets":
      result = handleSearchTickets(parameters, intent);
      break;
    case "create_ticket":
      result = handleCreateTicket(parameters, idempotency_key, transaction_id);
      break;
    case "delete_ticket":
      result = handleDeleteTicket(parameters);
      break;
    case "export_tickets":
      result = await handleExportTickets(parameters, (p) => console.log("  [progress]", p.message));
      break;
    default:
      result = createStructuredError("RESOURCE_NOT_FOUND", `Unknown tool: ${tool}`, "permanent", {
        suggestion: `Available tools: ${SERVICE_MANIFEST.tools.map((t) => t.name).join(", ")}`,
      });
  }

  // Extension 14: Attach updated session state
  context.last_tool = tool;
  context.last_call_at = new Date().toISOString();
  result.session_state = SessionState.encode(context);

  return result;
}

// =============================================================================
// Demo
// =============================================================================

async function demo() {
  const log = (title: string) => console.log(`\n--- ${title} ---`);

  console.log("=".repeat(70));
  console.log("MCP Extended Server — TypeScript Reference Implementation Demo");
  console.log("=".repeat(70));

  // 1. Service Manifest
  log("1. Service Manifest (Proposal #1)");
  const manifest = await handleRequest({ tool: "get_manifest" });
  const srv = manifest as any;
  console.log(`Server: ${srv.name} v${srv.version}`);
  console.log(`Extensions: ${(srv.supported_extensions as string[])?.join(", ")}`);

  // 2. Permission Check
  log("2. Permission Check (Proposal #4)");
  const check = await handleRequest({ tool: "check_permissions", parameters: { tool: "delete_ticket" } });
  console.log("Can delete tickets?", check);

  // 3. Intent Hints
  log("3. Search with Intent Hint (Proposal #2)");
  const intentResult = await handleRequest({
    tool: "search_tickets",
    parameters: { query: "bug" },
    intent: "Find the most recent incident from last Friday's deployment",
  });
  console.log("Suggestion:", (intentResult as any).suggestion);

  // 4. Provenance
  log("4. Search with Provenance (Proposal #7)");
  const provResult = await handleRequest({ tool: "search_tickets", parameters: { status: "open" } });
  console.log(`Found ${(provResult as any).result?.total_count} tickets`);
  console.log("Provenance:", (provResult as any).provenance);

  // 5. Idempotency
  log("5. Idempotent Create (Proposal #5)");
  const idemKey = "create-deploy-ticket-2026-03-15";
  const r1 = await handleRequest({
    tool: "create_ticket",
    parameters: { title: "Deploy v2.1", assignee: "charlie" },
    idempotency_key: idemKey,
  });
  console.log(`First call — replay: ${(r1 as any).idempotency?.was_replay}`);

  const r2 = await handleRequest({
    tool: "create_ticket",
    parameters: { title: "Deploy v2.1", assignee: "charlie" },
    idempotency_key: idemKey,
  });
  console.log(`Second call — replay: ${(r2 as any).idempotency?.was_replay}`);

  // 6. Human-in-the-Loop
  log("6. Human-in-the-Loop (Proposal #6)");
  // Temporarily grant delete scope to demonstrate confirmation flow
  (permissions as any).grantedScopes.add("delete:tickets");

  const noConfirm = await handleRequest({ tool: "delete_ticket", parameters: { ticket_id: "PROJ-2" } });
  console.log(`Requires confirmation: ${(noConfirm as any).requires_confirmation}`);
  console.log(`Message: ${(noConfirm as any).confirmation_message}`);
  console.log(`Risk level: ${(noConfirm as any).risk_level}`);

  const withConfirm = await handleRequest({ tool: "delete_ticket", parameters: { ticket_id: "PROJ-2" }, user_confirmed: true });
  console.log(`After confirmation: deleted=${(withConfirm as any).deleted}, ticket=${(withConfirm as any).ticket_id}`);

  // Revoke delete scope
  (permissions as any).grantedScopes.delete("delete:tickets");

  // 7. Transaction + Rollback
  log("7. Transaction with Rollback (Proposal #5)");
  const txId = "tx-migration-001";
  await handleRequest({ tool: "begin_transaction", parameters: { transaction_id: txId } });
  console.log(`Transaction ${txId} started`);

  await handleRequest({ tool: "create_ticket", parameters: { title: "Migration step 1" }, transaction_id: txId });
  console.log("Step 1: ticket created");

  await handleRequest({ tool: "create_ticket", parameters: { title: "Migration step 2" }, transaction_id: txId });
  console.log("Step 2: ticket created");

  const rollback = await handleRequest({ tool: "rollback_transaction", parameters: { transaction_id: txId } });
  console.log("Rollback result:", JSON.stringify(rollback, null, 2));

  // 8. Session State
  log("8. Session State (Proposal #14)");
  const stateResult = await handleRequest({ tool: "search_tickets", parameters: { status: "open" } });
  const decoded = SessionState.decode(stateResult.session_state as string);
  console.log("Session state:", decoded);

  // 9. Structured Error (resource not found)
  log("9. Structured Error (Proposal #11)");
  (permissions as any).grantedScopes.add("delete:tickets");
  const errorResult = await handleRequest({ tool: "delete_ticket", parameters: { ticket_id: "NONEXISTENT" }, user_confirmed: true });
  console.log("Error:", JSON.stringify(errorResult, null, 2));
  (permissions as any).grantedScopes.delete("delete:tickets");

  // 10. Permission Denied Error
  log("10. Permission Denied (Proposals #4 + #11)");
  const permError = await handleRequest({ tool: "delete_ticket", parameters: { ticket_id: "PROJ-3" }, user_confirmed: true });
  console.log("Error:", JSON.stringify(permError, null, 2));

  console.log("\n" + "=".repeat(70));
  console.log("Demo complete.");
}

demo().catch(console.error);
