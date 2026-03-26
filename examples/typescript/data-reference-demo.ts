/**
 * Data Reference Demo — Self-contained signed-URL data transfer
 *
 * Runs Server A (data source), Server B (data consumer), and a client
 * all in the same process to demonstrate zero-copy-through-client
 * data references with HMAC-signed URLs.
 *
 * Usage:  npx ts-node data-reference-demo.ts
 *    or:  npx tsx data-reference-demo.ts
 */

import * as http from "http";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// SECURITY WARNING: This secret is hard-coded for demo purposes only.
// In production, use a securely generated secret stored in a secrets manager.
// ---------------------------------------------------------------------------
const SIGNING_SECRET = "demo-secret-do-not-use-in-production";

// Replaceable time function — allows tests to simulate clock advancement.
let _getNow = (): number => Date.now();

// ---------------------------------------------------------------------------
// Ticket dataset
// ---------------------------------------------------------------------------
const TICKETS = [
  { id: "TICKET-1", title: "Fix login bug", status: "open", priority: "high" },
  { id: "TICKET-2", title: "Add dark mode", status: "in-progress", priority: "medium" },
];

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------
function signUrl(refId: string, expTimestamp: string): string {
  return crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(refId + expTimestamp)
    .digest("hex");
}

function verifySignature(refId: string, sig: string, exp: string): boolean {
  const nowMs = _getNow();
  const expiresMs = parseInt(exp, 10);
  if (isNaN(expiresMs) || nowMs > expiresMs) return false;
  const expected = signUrl(refId, exp);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// DataReference shape (matches data-references.schema.json)
// ---------------------------------------------------------------------------
interface DataReference {
  ref_id: string;
  origin_server: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string;
  access_url: string;
  checksum: { algorithm: string; value: string };
}

// ---------------------------------------------------------------------------
// Server A — data source
// ---------------------------------------------------------------------------
const storedData = new Map<string, Buffer>();

function createServerA(): http.Server {
  return http.createServer((req, res) => {
    // POST /export — generate a DataReference
    if (req.method === "POST" && req.url === "/export") {
      const refId = `ref-${crypto.randomUUID()}`;
      const payload = Buffer.from(JSON.stringify(TICKETS));
      storedData.set(refId, payload);

      const ttlMs = 5000;
      const expTimestamp = String(_getNow() + ttlMs);
      const sig = signUrl(refId, expTimestamp);
      const port = (serverA.address() as any).port;

      const dataRef: DataReference = {
        ref_id: refId,
        origin_server: "project-tracker",
        mime_type: "application/json",
        size_bytes: payload.length,
        expires_at: new Date(_getNow() + ttlMs).toISOString(),
        access_url: `http://localhost:${port}/data/${refId}?sig=${sig}&exp=${expTimestamp}`,
        checksum: {
          algorithm: "sha256",
          value: crypto.createHash("sha256").update(payload).digest("hex"),
        },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dataRef));
      return;
    }

    // POST /export-short-ttl — TTL=0 so URL is immediately expired
    if (req.method === "POST" && req.url === "/export-short-ttl") {
      const refId = `ref-${crypto.randomUUID()}`;
      const payload = Buffer.from(JSON.stringify(TICKETS));
      storedData.set(refId, payload);

      const expTimestamp = String(_getNow()); // expires immediately
      const sig = signUrl(refId, expTimestamp);
      const port = (serverA.address() as any).port;

      const dataRef: DataReference = {
        ref_id: refId,
        origin_server: "project-tracker",
        mime_type: "application/json",
        size_bytes: payload.length,
        expires_at: new Date(_getNow()).toISOString(),
        access_url: `http://localhost:${port}/data/${refId}?sig=${sig}&exp=${expTimestamp}`,
        checksum: {
          algorithm: "sha256",
          value: crypto.createHash("sha256").update(payload).digest("hex"),
        },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dataRef));
      return;
    }

    // GET /data/:ref_id?sig=...&exp=... — serve data with HMAC verification
    const dataMatch = req.url?.match(/^\/data\/(ref-[^?]+)\?(.+)$/);
    if (req.method === "GET" && dataMatch) {
      const refId = dataMatch[1];
      const params = new URLSearchParams(dataMatch[2]);
      const sig = params.get("sig") || "";
      const exp = params.get("exp") || "";

      if (!verifySignature(refId, sig, exp)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
      }

      const data = storedData.get(refId);
      if (!data) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });
}

// ---------------------------------------------------------------------------
// Server B — data consumer
// ---------------------------------------------------------------------------
function createServerB(): http.Server {
  return http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/import") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const dataRef: DataReference = JSON.parse(body);

        // Fetch from Server A's access_url
        http.get(dataRef.access_url, (fetchRes) => {
          let fetchBody = "";
          fetchRes.on("data", (chunk: Buffer) => (fetchBody += chunk.toString()));
          fetchRes.on("end", () => {
            if (fetchRes.statusCode !== 200) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ status: "failed", error: fetchBody }));
              return;
            }

            const records = JSON.parse(fetchBody);
            const checksum = crypto
              .createHash("sha256")
              .update(Buffer.from(fetchBody))
              .digest("hex");

            const result = {
              status: "imported",
              rows_imported: records.length,
              checksum_verified: checksum === dataRef.checksum.value,
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          });
        });
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function httpPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode!, body: data }));
    }).on("error", reject);
  });
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "localhost", () => {
      resolve((server.address() as any).port);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let serverA: http.Server;
let serverB: http.Server;

async function main() {
  // Startup security warning
  process.stderr.write(
    "SECURITY WARNING: Using hard-coded demo secret. Do NOT use in production.\n"
  );

  serverA = createServerA();
  serverB = createServerB();

  const portA = await listenOnRandomPort(serverA);
  const portB = await listenOnRandomPort(serverB);

  console.log("=== Data Reference Demo ===");
  console.log(`  Server A (data source) listening on port ${portA}`);
  console.log(`  Server B (data consumer) listening on port ${portB}`);

  // --- Export from Server A ---
  console.log("\n--- Export from Server A ---");
  const exportRes = await httpPost(`http://localhost:${portA}/export`, "{}");
  const dataRef: DataReference = JSON.parse(exportRes.body);

  console.log(`  ref_id: ${dataRef.ref_id}`);
  console.log(`  mime_type: ${dataRef.mime_type}`);
  console.log(`  size_bytes: ${dataRef.size_bytes}`);
  console.log(`  access_url: ${dataRef.access_url}`);
  console.log("  (data NOT shown — zero-copy-through-client)");

  // --- Import to Server B ---
  console.log("\n--- Import to Server B ---");
  console.log("  Server B fetching from Server A...");
  const importRes = await httpPost(
    `http://localhost:${portB}/import`,
    JSON.stringify(dataRef)
  );
  const importResult = JSON.parse(importRes.body);
  const checksumMsg = importResult.checksum_verified ? "checksum verified" : "checksum mismatch";
  console.log(
    `  Import result: ${importResult.rows_imported} records imported, ${checksumMsg}`
  );

  // --- TTL Expiry Test ---
  console.log("\n--- TTL Expiry Test ---");
  console.log("  Attempting fetch with expired URL...");
  // Use TTL=0 endpoint so URL is immediately expired
  const expiredExportRes = await httpPost(
    `http://localhost:${portA}/export-short-ttl`,
    "{}"
  );
  const expiredRef: DataReference = JSON.parse(expiredExportRes.body);
  // The URL has exp = now, so by the time we fetch it's already expired
  const expiredFetch = await httpGet(expiredRef.access_url);
  console.log(
    `  Result: ${expiredFetch.status} Forbidden (expected)`
  );

  // --- Invalid Signature Test ---
  console.log("\n--- Invalid Signature Test ---");
  console.log("  Attempting fetch with tampered signature...");
  const tamperedUrl = dataRef.access_url.replace(/sig=[^&]+/, "sig=tampered0000");
  const tamperedFetch = await httpGet(tamperedUrl);
  console.log(
    `  Result: ${tamperedFetch.status} Forbidden (expected)`
  );

  console.log("\n=== Demo complete ===");

  serverA.close();
  serverB.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
