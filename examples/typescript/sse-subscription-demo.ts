/**
 * SSE Subscription Demo — TypeScript
 *
 * A self-contained demo that runs both an SSE server and client in the same
 * process to illustrate the MCP Subscribe/Notify extension over Server-Sent
 * Events (SSE).
 *
 * This is a reference implementation, not production code.
 * No external dependencies required (Node.js stdlib only).
 *
 * Usage:
 *   npx tsx sse-subscription-demo.ts
 */

// SECURITY WARNING:
// The subscription_id acts as a bearer token — anyone who knows it can
// connect to the SSE stream and receive events. In production, SSE
// connections MUST be authenticated independently (e.g., via an
// Authorization header or short-lived token) rather than relying on
// subscription_id secrecy alone.

import * as http from "node:http";
import * as crypto from "node:crypto";

// =============================================================================
// Types
// =============================================================================

interface Subscription {
  id: string;
  events: string[];
  filter: Record<string, string>;
  response?: http.ServerResponse;
  closed: boolean;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: "notifications/event";
  params: {
    subscription_id: string;
    event_type: string;
    timestamp: string;
    payload: Record<string, unknown>;
  };
}

// =============================================================================
// Server State
// =============================================================================

const subscriptions = new Map<string, Subscription>();

// =============================================================================
// Helpers
// =============================================================================

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendSseEvent(res: http.ServerResponse, notification: JsonRpcNotification): void {
  res.write(`data: ${JSON.stringify(notification)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Server
// =============================================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // POST /subscribe
  if (req.method === "POST" && url.pathname === "/subscribe") {
    const body = JSON.parse(await readBody(req));
    const id = crypto.randomUUID();
    const sub: Subscription = {
      id,
      events: body.events ?? [],
      filter: body.filter ?? {},
      closed: false,
    };
    subscriptions.set(id, sub);
    jsonResponse(res, 200, {
      subscription_id: id,
      status: "active",
      supported_events: ["commit_to_main", "pr_review_requested", "issue_updated"],
    });
    return;
  }

  // GET /events/:subscription_id
  if (req.method === "GET" && url.pathname.startsWith("/events/")) {
    const subId = url.pathname.slice("/events/".length);
    const sub = subscriptions.get(subId);
    if (!sub) {
      jsonResponse(res, 404, { error: "subscription not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.flushHeaders();

    sub.response = res;

    // Close when client disconnects
    req.on("close", () => {
      sub.closed = true;
    });
    return;
  }

  // POST /unsubscribe
  if (req.method === "POST" && url.pathname === "/unsubscribe") {
    const body = JSON.parse(await readBody(req));
    const sub = subscriptions.get(body.subscription_id);
    if (!sub) {
      jsonResponse(res, 404, { error: "subscription not found" });
      return;
    }
    sub.closed = true;
    if (sub.response && !sub.response.writableEnded) {
      sub.response.end();
    }
    subscriptions.delete(body.subscription_id);
    jsonResponse(res, 200, { status: "cancelled" });
    return;
  }

  jsonResponse(res, 404, { error: "not found" });
});

// =============================================================================
// Demo Event Data
// =============================================================================

function demoEvents(subscriptionId: string): JsonRpcNotification[] {
  return [
    {
      jsonrpc: "2.0",
      method: "notifications/event",
      params: {
        subscription_id: subscriptionId,
        event_type: "commit_to_main",
        timestamp: new Date().toISOString(),
        payload: { commit_sha: "abc123", author: "alice", message: "fix: resolve login race condition" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/event",
      params: {
        subscription_id: subscriptionId,
        event_type: "pr_review_requested",
        timestamp: new Date().toISOString(),
        payload: { pr_number: 42, title: "Add dark mode support", reviewer: "bob" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/event",
      params: {
        subscription_id: subscriptionId,
        event_type: "commit_to_main",
        timestamp: new Date().toISOString(),
        payload: { commit_sha: "def456", author: "carol", message: "feat: add retry logic" },
      },
    },
  ];
}

// =============================================================================
// Client Helpers (using Node.js http module)
// =============================================================================

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function connectSse(
  port: number,
  path: string,
): Promise<{ collected: JsonRpcNotification[]; waitForCount: (n: number) => Promise<void>; req: http.ClientRequest }> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "GET", path },
      (res) => {
        let buffer = "";
        const collected: JsonRpcNotification[] = [];
        let pendingResolve: (() => void) | null = null;
        let pendingCount = 0;

        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          // Parse complete SSE messages
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (dataLine) {
              collected.push(JSON.parse(dataLine.slice("data: ".length)));
            }
          }
          if (pendingResolve && collected.length >= pendingCount) {
            pendingResolve();
            pendingResolve = null;
          }
        });

        function waitForCount(n: number): Promise<void> {
          if (collected.length >= n) return Promise.resolve();
          pendingCount = n;
          return new Promise((r) => { pendingResolve = r; });
        }

        resolve({ collected, waitForCount, req });
      },
    );
    req.end();
  });
}

// =============================================================================
// Main Demo
// =============================================================================

async function main(): Promise<void> {
  // Start server on random port
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const port = addr.port;

  console.log("=== SSE Subscription Demo ===");
  console.log(`  Server listening on 127.0.0.1:${port}`);
  console.log();

  // --- Subscribe ---
  console.log("--- Subscribe ---");
  const subRes = await httpRequest(port, "POST", "/subscribe", {
    events: ["commit_to_main", "pr_review_requested"],
    filter: { repo: "example/project" },
  });
  const subData = JSON.parse(subRes.body);
  const subscriptionId: string = subData.subscription_id;
  console.log(`  Subscription ID: ${subscriptionId}`);
  console.log(`  Status: ${subData.status}`);
  console.log();

  // --- Connect SSE Stream ---
  console.log("--- SSE Stream ---");
  const { collected: receivedEvents, waitForCount } = await connectSse(port, `/events/${subscriptionId}`);

  // Wait for the SSE connection to be established
  await sleep(50);

  // Server emits 3 events at 100ms intervals
  const sub = subscriptions.get(subscriptionId)!;
  const notifications = demoEvents(subscriptionId);
  for (const notification of notifications) {
    await sleep(100);
    sendSseEvent(sub.response!, notification);
  }

  // Wait until client has received all 3 events
  await waitForCount(3);

  for (let i = 0; i < receivedEvents.length; i++) {
    const evt = receivedEvents[i];
    console.log(
      `  Event ${i + 1}: ${evt.params.event_type} - ${JSON.stringify(evt.params.payload)}`,
    );
  }
  console.log();

  // --- Unsubscribe ---
  console.log("--- Unsubscribe ---");
  const unsubRes = await httpRequest(port, "POST", "/unsubscribe", {
    subscription_id: subscriptionId,
  });
  const unsubData = JSON.parse(unsubRes.body);
  console.log(`  Subscription cancelled`);
  console.log();

  // Verify
  if (receivedEvents.length !== 3) {
    console.error(`  ERROR: Expected 3 events, got ${receivedEvents.length}`);
    process.exit(1);
  }
  if (unsubData.status !== "cancelled") {
    console.error(`  ERROR: Expected cancelled status, got ${unsubData.status}`);
    process.exit(1);
  }

  // Shutdown
  server.close();
  console.log("=== Demo complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
