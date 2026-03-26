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
let ticketCounter = tickets.size; // Monotonic counter — never decreases, even after deletes

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

  addScope(scope: string): void {
    this.grantedScopes.add(scope);
  }

  removeScope(scope: string): void {
    this.grantedScopes.delete(scope);
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
// JSON-RPC 2.0 Wire Format
// =============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number | string | null;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseJsonRpcRequest(rawJson: string): JsonRpcRequest {
  let msg: unknown;
  try {
    msg = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e}`);
  }

  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    throw new Error("Request must be a JSON object");
  }

  const obj = msg as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") {
    throw new Error("Missing or invalid 'jsonrpc' field (must be '2.0')");
  }
  if (!("method" in obj) || typeof obj.method !== "string") {
    throw new Error("Missing 'method' field");
  }

  return obj as unknown as JsonRpcRequest;
}

function buildJsonRpcResponse(requestId: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: requestId, result };
}

function buildJsonRpcError(requestId: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  const err: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) {
    err.data = data;
  }
  return { jsonrpc: "2.0", id: requestId, error: err };
}

async function processJsonRpc(rawJson: string): Promise<string> {
  // --- Parse ---------------------------------------------------------------
  let msg: JsonRpcRequest;
  try {
    msg = parseJsonRpcRequest(rawJson);
  } catch (e) {
    return JSON.stringify(buildJsonRpcError(null, -32700, `Parse error: ${e}`));
  }

  const requestId = msg.id ?? null; // null for notifications
  const method = msg.method;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const isNotification = !("id" in msg);

  // --- Notifications must never receive a response (JSON-RPC 2.0 §4.1) ----
  if (isNotification) {
    // Even unknown notification methods are silently ignored per spec.
    return "";
  }

  // --- Route ---------------------------------------------------------------
  let result: unknown;
  try {
    if (method === "initialize") {
      result = {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: { listChanged: true },
          extensions: SERVICE_MANIFEST.supported_extensions,
        },
        serverInfo: {
          name: SERVICE_MANIFEST.server.name,
          version: SERVICE_MANIFEST.server.version,
        },
      };

    } else if (method === "notifications/initialized") {
      // Defined as notification-only; if sent as a request, return an error.
      return JSON.stringify(buildJsonRpcError(
        requestId, -32600,
        "notifications/initialized must be sent as a notification (no id)"));

    } else if (method === "tools/list") {
      result = { tools: SERVICE_MANIFEST.tools };

    } else if (method === "tools/call") {
      const toolName = params.name as string;
      const args = (params.arguments ?? {}) as Record<string, string>;

      // Build the internal request dict expected by handleRequest()
      const internalRequest: MCPRequest = {
        tool: toolName,
        parameters: args,
      };
      // Forward optional extension fields.
      // SECURITY NOTE: user_confirmed is a trust-the-client field. In
      // production the confirmation flow should be enforced by the MCP
      // host, not trusted from the wire.
      for (const key of ["idempotency_key", "transaction_id", "intent", "session_state", "user_confirmed"] as const) {
        if (key in params) {
          (internalRequest as unknown as Record<string, unknown>)[key] = params[key];
        }
      }

      // Application-level errors stay inside "result", not JSON-RPC "error"
      result = await handleRequest(internalRequest);

    } else {
      // Unknown method
      return JSON.stringify(buildJsonRpcError(requestId, -32601, `Method not found: ${method}`));
    }

  } catch (e) {
    return JSON.stringify(buildJsonRpcError(requestId, -32603, `Internal error: ${e}`));
  }

  // --- Respond -------------------------------------------------------------
  return JSON.stringify(buildJsonRpcResponse(requestId, result));
}

function buildJsonRpcRequest(method: string, params?: Record<string, unknown>, requestId?: number, isNotification?: boolean): string {
  const msg: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) {
    msg.params = params;
  }
  if (!isNotification) {
    msg.id = requestId ?? null;
  }
  return JSON.stringify(msg);
}

// =============================================================================
// Extension 14: Session State
// =============================================================================

/**
 * SECURITY NOTE: This reference implementation uses plain Base64 encoding for
 * clarity. Production implementations MUST use signed tokens (e.g., HMAC-SHA256)
 * or encrypted tokens (e.g., AES-GCM) to prevent client-side tampering.
 */
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

  ticketCounter++;
  const ticketId = `PROJ-${ticketCounter}`;
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

// Response type helpers for the demo
interface ConfirmationResponse {
  requires_confirmation: boolean;
  confirmation_message: string;
  risk_level: string;
  [key: string]: unknown;
}

interface DeleteResponse {
  deleted?: boolean;
  ticket_id?: string;
  session_state?: string;
  [key: string]: unknown;
}

async function handleRequest(request: MCPRequest): Promise<Record<string, unknown> & { idempotency?: { was_replay: boolean }; suggestion?: Record<string, unknown> }> {
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
      confirmation_message: ("confirmation_message" in toolDef ? toolDef.confirmation_message : "Are you sure?"),
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
  console.log("=".repeat(70));
  console.log("MCP Extended Server — TypeScript Reference Implementation Demo");
  console.log("=".repeat(70));

  // Auto-incrementing JSON-RPC request ID counter
  let nextIdCounter = 0;
  function nextId(): number {
    return ++nextIdCounter;
  }

  async function callTool(name: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { name };
    if (args !== undefined) {
      params.arguments = args;
    }
    if (extra) {
      Object.assign(params, extra);
    }
    const reqId = nextId();
    const rawRequest = buildJsonRpcRequest("tools/call", params, reqId);
    console.log(`\n  >> Request:  ${JSON.stringify(JSON.parse(rawRequest), null, 2)}`);
    const rawResponse = await processJsonRpc(rawRequest);
    const parsed = JSON.parse(rawResponse);
    console.log(`  << Response: ${JSON.stringify(parsed, null, 2)}`);
    return parsed.result ?? parsed;
  }

  // ----- 0. Initialize handshake -------------------------------------------
  console.log("\n--- 0. JSON-RPC Initialize ---");
  const initReqId = nextId();
  const rawReq = buildJsonRpcRequest("initialize", {}, initReqId);
  console.log(`\n  >> Request:  ${JSON.stringify(JSON.parse(rawReq), null, 2)}`);
  const rawResp = await processJsonRpc(rawReq);
  console.log(`  << Response: ${JSON.stringify(JSON.parse(rawResp), null, 2)}`);

  // Send initialized notification (no response expected)
  const notif = buildJsonRpcRequest("notifications/initialized", undefined, undefined, true);
  console.log(`\n  >> Notification: ${JSON.stringify(JSON.parse(notif), null, 2)}`);
  await processJsonRpc(notif);
  console.log(`  << (no response for notification)`);

  // 1. Service Manifest (Proposal #1)
  console.log("\n--- 1. Service Manifest ---");
  const manifest = await callTool("get_manifest");
  const srv = manifest.server as { name: string; version: string };
  console.log(`Server: ${srv.name} v${srv.version}`);
  console.log(`Extensions: ${(manifest.supported_extensions as readonly string[]).join(", ")}`);
  console.log(`Tools: ${(manifest.tools as Array<{ name: string }>).map((t) => t.name).join(", ")}`);

  // 2. Permission Check (Proposal #4)
  console.log("\n--- 2. Permission Check ---");
  const check = await callTool("check_permissions", { tool: "delete_ticket" });
  console.log("Can delete tickets?", check);

  // 3. Search with Intent Hint (Proposal #2)
  console.log("\n--- 3. Search with Intent Hint ---");
  const intentResult = await callTool(
    "search_tickets",
    { query: "bug" },
    { intent: "Find the most recent incident from last Friday's deployment" },
  );
  console.log(`Intent-based suggestion: ${intentResult.suggestion ? JSON.stringify(intentResult.suggestion) : "none"}`);

  // 4. Search with Provenance (Proposal #7)
  console.log("\n--- 4. Search with Provenance ---");
  const provResult = await callTool("search_tickets", { status: "open" });
  const provWrapped = provResult as unknown as ProvenanceWrapped<{ total_count: number }>;
  console.log(`Found ${provWrapped.result?.total_count} tickets`);
  console.log("Provenance:", provWrapped.provenance);

  // 5. Idempotent Create (Proposal #5)
  console.log("\n--- 5. Idempotent Create ---");
  const idemKey = "create-deploy-ticket-2026-03-15";
  const r1 = await callTool(
    "create_ticket",
    { title: "Deploy v2.1", assignee: "charlie" },
    { idempotency_key: idemKey },
  );
  console.log(`First call — replay: ${(r1 as Record<string, unknown> & { idempotency?: { was_replay: boolean } }).idempotency?.was_replay}`);

  const r2 = await callTool(
    "create_ticket",
    { title: "Deploy v2.1", assignee: "charlie" },
    { idempotency_key: idemKey },
  );
  console.log(`Second call — replay: ${(r2 as Record<string, unknown> & { idempotency?: { was_replay: boolean } }).idempotency?.was_replay}`);

  // 6. Human-in-the-Loop (Proposal #6)
  console.log("\n--- 6. Human-in-the-Loop ---");
  // Temporarily grant delete scope to demonstrate confirmation flow
  permissions.addScope("delete:tickets");

  const noConfirm = await callTool("delete_ticket", { ticket_id: "PROJ-2" }) as unknown as ConfirmationResponse;
  console.log(`Requires confirmation: ${noConfirm.requires_confirmation}`);
  console.log(`Message: ${noConfirm.confirmation_message}`);
  console.log(`Risk level: ${noConfirm.risk_level}`);

  const withConfirm = await callTool("delete_ticket", { ticket_id: "PROJ-2" }, { user_confirmed: true }) as unknown as DeleteResponse;
  console.log(`After confirmation: deleted=${withConfirm.deleted}, ticket=${withConfirm.ticket_id}`);

  // Revoke delete scope
  permissions.removeScope("delete:tickets");

  // 7. Transaction with Rollback (Proposal #5)
  console.log("\n--- 7. Transaction with Rollback ---");
  const txId = "tx-migration-001";
  await callTool("begin_transaction", { transaction_id: txId });
  console.log(`Transaction ${txId} started`);

  await callTool("create_ticket", { title: "Migration step 1" }, { transaction_id: txId });
  console.log("Step 1: ticket created");

  await callTool("create_ticket", { title: "Migration step 2" }, { transaction_id: txId });
  console.log("Step 2: ticket created");

  const rollback = await callTool("rollback_transaction", { transaction_id: txId });
  console.log(`Rollback result: ${JSON.stringify(rollback, null, 2)}`);

  // 8. Session State (Proposal #14)
  console.log("\n--- 8. Session State ---");
  const stateResult = await callTool("search_tickets", { status: "open" });
  const decoded = SessionState.decode(stateResult.session_state as string);
  console.log("Session state:", decoded);

  // 9. Structured Error (resource not found)
  console.log("\n--- 9. Structured Error ---");
  permissions.addScope("delete:tickets");
  const errorResult = await callTool("delete_ticket", { ticket_id: "NONEXISTENT" }, { user_confirmed: true });
  console.log(`Error: ${JSON.stringify(errorResult, null, 2)}`);
  permissions.removeScope("delete:tickets");

  // 10. Permission Denied Error
  console.log("\n--- 10. Permission Denied (Proposals #4 + #11) ---");
  const permError = await callTool("delete_ticket", { ticket_id: "PROJ-3" }, { user_confirmed: true });
  console.log(`Error: ${JSON.stringify(permError, null, 2)}`);

  console.log("\n" + "=".repeat(70));
  console.log("Demo complete (core extensions).");

  // Additional proposal demos — these are standalone simulations that
  // demonstrate extension concepts (data references, multimodal, discovery,
  // subscriptions) without routing through the JSON-RPC layer, because the
  // features they illustrate (server-to-server data passing, registry queries,
  // event subscriptions) operate outside the single-server request/response
  // flow.  The conformance check does route through JSON-RPC.
  await demoDataReferences();
  await demoMultimodalSignatures();
  await demoConformanceCheck();
  await demoServerDiscovery();
  await demoSubscription();

  console.log("\n" + "=".repeat(70));
  console.log("All demos complete.");
}

// Helper used by standalone demo functions below
function logSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// =============================================================================
// Extension 9: Data References
// =============================================================================

async function demoDataReferences() {
  logSection("11. Data References (Proposal #9)");

  // Server A exports data and returns a reference
  async function serverAExport(_dataset: string) {
    const refId = `ref-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const dataPayload = JSON.stringify({ tickets: [...tickets.values()].slice(0, 2) });
    const checksum = `sha256:${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
    return {
      ref_id: refId,
      origin_server: "project-tracker-mcp",
      mime_type: "application/json",
      size_bytes: Buffer.byteLength(dataPayload),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      access_url: `https://project-tracker.example.com/refs/${refId}`,
      checksum,
    };
  }

  // Client obtains the reference from Server A
  const reference = await serverAExport("open_tickets");
  console.log(`Server A returned reference: ${reference.ref_id}`);
  console.log(`  origin_server: ${reference.origin_server}`);
  console.log(`  mime_type: ${reference.mime_type}, size_bytes: ${reference.size_bytes}`);
  console.log(`  access_url: ${reference.access_url}`);

  // Server B imports data using the reference
  async function serverBImport(ref: typeof reference) {
    return {
      status: "imported",
      ref_id: ref.ref_id,
      origin_server: ref.origin_server,
      records_imported: 2,
      checksum_verified: true,
    };
  }

  const importResult = await serverBImport(reference);
  console.log(`Server B import result: status=${importResult.status}, records=${importResult.records_imported}, checksum_verified=${importResult.checksum_verified}`);
}

// =============================================================================
// Extension 10: Multimodal Tool Signatures
// =============================================================================

async function demoMultimodalSignatures() {
  logSection("12. Multimodal Tool Signatures (Proposal #10)");

  // Define a tool with explicit input/output type annotations
  const toolDefinition = {
    name: "analyze_image",
    description: "Analyze an image and return structured JSON results.",
    input_types: ["image/png", "image/jpeg"],
    output_types: ["application/json"],
    max_input_size_bytes: 10 * 1024 * 1024, // 10 MB
    input_schema: {
      type: "object",
      required: ["image_data", "analysis_type"],
      properties: {
        image_data: { type: "string", description: "Base64-encoded image" },
        analysis_type: { type: "string", enum: ["labels", "objects", "text"] },
      },
    },
  };

  console.log(`Tool: ${toolDefinition.name}`);
  console.log(`  Accepts: ${toolDefinition.input_types.join(", ")}`);
  console.log(`  Returns: ${toolDefinition.output_types.join(", ")}`);
  console.log(`  Max input size: ${toolDefinition.max_input_size_bytes} bytes`);

  // Simulate a client calling this tool with a binary payload
  const fakeImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
  const requestPayload = {
    tool: "analyze_image",
    parameters: {
      image_data: fakeImageBytes.toString("base64"),
      analysis_type: "labels",
    },
    content_type: "image/png",
  };

  console.log(`  Client sends ${fakeImageBytes.length} bytes as ${requestPayload.content_type}`);

  // Simulate the tool returning a structured JSON result
  const analysisResult = {
    labels: [
      { name: "architecture_diagram", confidence: 0.92 },
      { name: "flowchart", confidence: 0.87 },
      { name: "technical_drawing", confidence: 0.65 },
    ],
    image_dimensions: { width: 1024, height: 768 },
    analysis_type: "labels",
  };

  console.log(`  Result: ${JSON.stringify(analysisResult, null, 4)}`);
}

// =============================================================================
// Extension 12: Conformance Check
// =============================================================================

async function demoConformanceCheck() {
  logSection("13. Conformance Check (Proposal #12)");

  // Define a mini test suite — each test uses JSON-RPC via processJsonRpc()
  let confIdCounter = 0;
  function confId(): number {
    return 1000 + ++confIdCounter;
  }

  const testSuite = [
    {
      test_id: "CONF-001",
      description: "Server returns a valid manifest on get_manifest",
      request: buildJsonRpcRequest("tools/call", { name: "get_manifest", arguments: {} }, confId()),
      expected: (r: Record<string, unknown>) => "result" in r && typeof r.result === "object" && r.result !== null && "server" in (r.result as Record<string, unknown>) && "tools" in (r.result as Record<string, unknown>),
    },
    {
      test_id: "CONF-002",
      description: "Permission check returns allowed=True for granted scope",
      request: buildJsonRpcRequest("tools/call", { name: "check_permissions", arguments: { tool: "search_tickets" } }, confId()),
      expected: (r: Record<string, unknown>) => "result" in r && (r.result as Record<string, unknown>)?.allowed === true,
    },
    {
      test_id: "CONF-003",
      description: "Permission check returns allowed=False for missing scope",
      request: buildJsonRpcRequest("tools/call", { name: "check_permissions", arguments: { tool: "delete_ticket" } }, confId()),
      expected: (r: Record<string, unknown>) => "result" in r && (r.result as Record<string, unknown>)?.allowed === false,
    },
    {
      test_id: "CONF-004",
      description: "Structured error returned for unknown tool",
      request: buildJsonRpcRequest("tools/call", { name: "nonexistent_tool", arguments: {} }, confId()),
      expected: (r: Record<string, unknown>) => "result" in r && typeof r.result === "object" && r.result !== null && "error" in (r.result as Record<string, unknown>),
    },
    {
      test_id: "CONF-005",
      description: "tools/list returns tool array",
      request: buildJsonRpcRequest("tools/list", undefined, confId()),
      expected: (r: Record<string, unknown>) => "result" in r && typeof r.result === "object" && r.result !== null && "tools" in (r.result as Record<string, unknown>) && Array.isArray((r.result as Record<string, unknown>).tools),
    },
    {
      test_id: "CONF-006",
      description: "Unknown method returns -32601 error",
      request: buildJsonRpcRequest("nonexistent/method", undefined, confId()),
      expected: (r: Record<string, unknown>) => "error" in r && (r.error as Record<string, unknown>)?.code === -32601,
    },
    {
      test_id: "CONF-007",
      description: "Invalid JSON returns -32700 parse error",
      request: "this is not valid json{{{",
      expected: (r: Record<string, unknown>) => "error" in r && (r.error as Record<string, unknown>)?.code === -32700,
    },
  ];

  // Run tests against the server via JSON-RPC
  let passed = 0;
  let failed = 0;
  const results: { test_id: string; status: string; description: string }[] = [];

  for (const test of testSuite) {
    const rawResponse = await processJsonRpc(test.request);
    const response = JSON.parse(rawResponse);
    const success = test.expected(response);
    const status = success ? "PASSED" : "FAILED";
    if (success) passed++;
    else failed++;
    results.push({ test_id: test.test_id, status, description: test.description });
    console.log(`  [${status}] ${test.test_id}: ${test.description}`);
  }

  // Produce conformance report
  const report = {
    conformance_report: {
      server: "project-tracker-mcp",
      total_tests: testSuite.length,
      passed,
      failed,
      pass_rate: `${((passed / testSuite.length) * 100).toFixed(0)}%`,
      results,
    },
  };
  console.log(`  Report: ${passed}/${testSuite.length} passed (${report.conformance_report.pass_rate})`);
}

// =============================================================================
// Extension 13: Server Discovery
// =============================================================================

async function demoServerDiscovery() {
  logSection("14. Server Discovery (Proposal #13)");

  // Simulated registry of known servers
  const registry = [
    {
      server_name: "figma-mcp",
      description: "Design tool integration for creating and editing mockups.",
      capabilities: ["design_mockup", "export_assets", "design_system"],
      registry_url: "https://registry.mcp.example.com/servers/figma-mcp",
      auth_flow: "oauth2_authorization_code",
      version: "2.3.0",
    },
    {
      server_name: "canva-mcp",
      description: "Quick design mockups and social media graphics.",
      capabilities: ["design_mockup", "social_media_graphics"],
      registry_url: "https://registry.mcp.example.com/servers/canva-mcp",
      auth_flow: "api_key",
      version: "1.1.0",
    },
    {
      server_name: "miro-mcp",
      description: "Collaborative whiteboarding and diagramming.",
      capabilities: ["whiteboard", "diagramming", "design_mockup"],
      registry_url: "https://registry.mcp.example.com/servers/miro-mcp",
      auth_flow: "oauth2_device",
      version: "3.0.1",
    },
  ];

  // Query for a capability
  const capabilityNeeded = "design_mockup";
  console.log(`Searching for servers with capability: '${capabilityNeeded}'`);

  const recommendations: { server_name: string; registry_url: string; auth_flow: string; match_confidence: number }[] = [];
  for (const server of registry) {
    if (server.capabilities.includes(capabilityNeeded)) {
      const matchConfidence = Math.round((1.0 / server.capabilities.length) * 100) / 100;
      recommendations.push({
        server_name: server.server_name,
        registry_url: server.registry_url,
        auth_flow: server.auth_flow,
        match_confidence: matchConfidence,
      });
    }
  }

  // Sort by confidence descending
  recommendations.sort((a, b) => b.match_confidence - a.match_confidence);

  for (const rec of recommendations) {
    console.log(`  Recommended: ${rec.server_name} (confidence=${rec.match_confidence}, auth=${rec.auth_flow})`);
    console.log(`    registry_url: ${rec.registry_url}`);
  }

  // Show how a client would connect to the top recommendation
  if (recommendations.length > 0) {
    const top = recommendations[0];
    console.log(`\n  Client would connect to '${top.server_name}' via:`);
    console.log(`    1. Fetch manifest from ${top.registry_url}/manifest`);
    console.log(`    2. Authenticate using ${top.auth_flow}`);
    console.log(`    3. Call tools with capability '${capabilityNeeded}'`);
  }
}

// =============================================================================
// Extension 15: Subscriptions
// =============================================================================

async function demoSubscription() {
  logSection("15. Event Subscriptions (Proposal #15)");

  // In-memory subscription manager
  const subscriptions = new Map<string, { subscription_id: string; events: string[]; filter: Record<string, string>; created_at: string; status: string }>();

  async function subscribe(events: string[], filterParams: Record<string, string> = {}) {
    const subId = `sub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const sub = {
      subscription_id: subId,
      events,
      filter: filterParams,
      created_at: new Date().toISOString(),
      status: "active",
    };
    subscriptions.set(subId, sub);
    return sub;
  }

  async function emitEvent(subId: string, eventType: string, payload: Record<string, unknown>) {
    return {
      subscription_id: subId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  async function unsubscribe(subId: string) {
    const sub = subscriptions.get(subId);
    if (sub) {
      sub.status = "cancelled";
      return { subscription_id: subId, status: "cancelled" };
    }
    return { error: "subscription_not_found", subscription_id: subId };
  }

  // Subscribe to events
  const sub = await subscribe(
    ["commit_to_main", "pr_review_requested"],
    { repo: "example/project-tracker-mcp", branch: "main" },
  );
  console.log(`Subscribed: ${sub.subscription_id}`);
  console.log(`  Events: ${sub.events.join(", ")}`);
  console.log(`  Filter: ${JSON.stringify(sub.filter)}`);

  // Simulate receiving event notifications
  const eventsReceived = [
    await emitEvent(sub.subscription_id, "commit_to_main", {
      commit_sha: "a1b2c3d",
      author: "alice",
      message: "Fix login redirect loop",
    }),
    await emitEvent(sub.subscription_id, "pr_review_requested", {
      pr_number: 142,
      title: "Add dark mode support",
      reviewer: "bob",
    }),
    await emitEvent(sub.subscription_id, "commit_to_main", {
      commit_sha: "e4f5g6h",
      author: "charlie",
      message: "Update CI pipeline config",
    }),
  ];

  for (const evt of eventsReceived) {
    console.log(`  Event: ${evt.event_type} at ${evt.timestamp}`);
    console.log(`    Payload: ${JSON.stringify(evt.payload)}`);
  }

  // Unsubscribe
  const unsub = await unsubscribe(sub.subscription_id);
  console.log(`Unsubscribed: ${unsub.subscription_id}, status=${unsub.status}`);
}

demo().catch((e) => { console.error(e); process.exit(1); });
