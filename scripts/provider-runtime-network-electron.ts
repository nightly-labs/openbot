// Runs inside the real Electron runtime and exercises Electron's `net.fetch` against a local HTTP
// server. It covers a normal response, a `Request` with a body, a `Range`/`If-Range` 206 resume, and
// an aborted request. It also checks that the production wrapper rejects a non-https URL before
// `net.fetch`. The system proxy itself is not part of this fixture.
//
// This file is the Electron entry. `scripts/provider-runtime-network-e2e.ts` builds and starts it.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { app, net } from "electron";
import { providerRuntimeFetch } from "../src/main/provider-runtime-network";

const reportPath = process.argv.find((item) => item.startsWith("--report-path="))?.slice("--report-path=".length);
if (!reportPath) throw new Error("Missing --report-path.");

const BODY = "0123456789";
const ETAG = '"network-test"';

interface Report {
  passed: boolean;
  cases: string[];
  error?: string;
}

const report: Report = { passed: false, cases: [] };

void main().catch((error: unknown) => {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${report.error}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/text") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("proxied");
      return;
    }
    if (url.pathname === "/echo") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: request.headers["content-type"] ?? null,
          }),
        );
      });
      return;
    }
    if (url.pathname === "/range") {
      const range = request.headers.range;
      const ifRange = request.headers["if-range"];
      if (range === "bytes=4-" && ifRange === ETAG) {
        response.writeHead(206, {
          "content-type": "text/plain",
          etag: ETAG,
          "content-range": `bytes 4-${BODY.length - 1}/${BODY.length}`,
        });
        response.end(BODY.slice(4));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain", etag: ETAG });
      response.end(BODY);
      return;
    }
    if (url.pathname === "/slow") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("started");
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "the fixture server has an address");
  const origin = `http://127.0.0.1:${address.port}`;

  await app.whenReady();

  await assert.rejects(providerRuntimeFetch(`${origin}/text`), /https URL/);
  report.cases.push("https-only");

  const text = await net.fetch(`${origin}/text`);
  assert.equal(text.status, 200, "a normal response keeps its status");
  assert.equal(await text.text(), "proxied", "a normal response keeps its body");
  report.cases.push("text");

  const echo = await net.fetch(
    new Request(`${origin}/echo`, {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain" },
    }),
  );
  assert.equal(echo.status, 200, "a Request with a body keeps its status");
  const echoed = await echo.json();
  assert.equal(echoed.method, "POST", "a Request keeps its method");
  assert.equal(echoed.body, "payload", "a Request keeps its body");
  assert.equal(echoed.contentType, "text/plain", "a Request keeps its content type");
  report.cases.push("request-body");

  const resumed = await net.fetch(`${origin}/range`, {
    headers: { Range: "bytes=4-", "If-Range": ETAG },
  });
  assert.equal(resumed.status, 206, "a matching Range request returns 206");
  assert.equal(
    resumed.headers.get("content-range"),
    `bytes 4-${BODY.length - 1}/${BODY.length}`,
    "a 206 response keeps its content range",
  );
  assert.equal(await resumed.text(), BODY.slice(4), "a 206 response keeps its partial body");
  report.cases.push("range-206");

  const controller = new AbortController();
  const aborted = assert.rejects(net.fetch(`${origin}/slow`, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 50);
  await aborted;
  report.cases.push("abort-signal");

  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  report.passed = true;
  const target = reportPath;
  if (!target) throw new Error("Missing --report-path.");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  app.exit(0);
}
