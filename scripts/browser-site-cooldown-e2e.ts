import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { createSiteCooldown, parseRetryAfter } from "../src/backend/browser-site-cooldown";

const OUT = resolve(import.meta.dirname, "../.openbot-build/browser-site-cooldown-e2e");
const report: { passed: boolean; hits: Record<string, number>; waits: Record<string, number>; error?: string } = {
  passed: false,
  hits: {},
  waits: {},
};

function listen(
  handler: (path: string, hit: number) => { status: number; headers?: Record<string, string> },
): Promise<Server> {
  let hits = 0;
  const server = createServer((request, response) => {
    hits += 1;
    const answer = handler(request.url ?? "/", hits);
    response.writeHead(answer.status, answer.headers);
    response.end("ok");
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

function origin(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The test server is not listening.");
  return `http://127.0.0.1:${address.port}`;
}

// The fake clock makes the check exact and fast; the HTTP server is real.
let clock = 1_000_000;
const gate = createSiteCooldown({ now: () => clock, defaultMs: 60_000, maxMs: 600_000 });

// A page load that respects the gate, the way the browser host would: no request while an origin is cooling down.
async function load(target: Server, name: string): Promise<number | "skipped"> {
  const site = origin(target);
  if (gate.waitMs(site) > 0) return "skipped";
  const response = await fetch(`${site}/page`);
  report.hits[name] = (report.hits[name] ?? 0) + 1;
  gate.recordStatus(site, response.status, response.headers.get("retry-after"));
  return response.status;
}

const limited = await listen((_path, hit) =>
  hit === 1 ? { status: 429, headers: { "Retry-After": "30" } } : { status: 200 },
);
const other = await listen(() => ({ status: 200 }));
try {
  assert.equal(parseRetryAfter("30", 0), 30_000, "seconds form");
  assert.equal(parseRetryAfter(new Date(5_000).toUTCString(), 0), 5_000, "http-date form");
  assert.equal(parseRetryAfter("nonsense", 0), null, "unusable value");

  assert.equal(await load(limited, "limited"), 429, "the first load is rate limited");
  assert.equal(gate.waitMs(origin(limited)), 30_000, "Retry-After sets the cooldown");
  assert.equal(await load(limited, "limited"), "skipped", "no request is sent during the cooldown");
  assert.equal(report.hits.limited, 1, "the server saw one request, not two");
  assert.equal(await load(other, "other"), 200, "another origin is not gated");

  clock += 29_000;
  assert.equal(await load(limited, "limited"), "skipped", "still cooling down just before the end");
  clock += 1_500;
  report.waits.afterCooldown = gate.waitMs(origin(limited));
  assert.equal(report.waits.afterCooldown, 0, "the cooldown ends");
  assert.equal(await load(limited, "limited"), 200, "the load goes out after the cooldown");
  assert.equal(report.hits.limited, 2, "the server saw the second request only after the cooldown");

  gate.recordBlock(origin(other));
  assert.equal(gate.waitMs(origin(other)), 60_000, "a bot check starts the default cooldown");
  gate.recordStatus(origin(other), 200);
  assert.equal(gate.waitMs(origin(other)), 60_000, "a 200 from a cached page does not end a block by itself");
  clock += 61_000;
  assert.equal(gate.waitMs(origin(other)), 0, "the block cooldown ends");

  gate.recordStatus("https://example.test", 429, "999999");
  assert.equal(gate.waitMs("https://example.test"), 600_000, "the cooldown is capped");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  limited.close();
  other.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
}
