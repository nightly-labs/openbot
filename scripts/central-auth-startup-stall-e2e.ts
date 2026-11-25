import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "central-auth-startup-stall-e2e");
const STARTUP_WINDOW_MS = 1_000;
const REQUEST_TIMEOUT_MS = 300;
const BLOCK_MS = 2_000;

const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(request.url ?? "");
  const answer = () => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  };
  if (requests.length > 1) return answer();
  const blockedUntil = Date.now() + BLOCK_MS;
  while (Date.now() < blockedUntil) {}
  setTimeout(answer, 100);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const root = await mkdtemp(join(tmpdir(), "openbot-central-auth-stall-"));

let passed = false;
let error: string | undefined;
let status: string | undefined;
try {
  const auth = new CentralAuthManager({
    apiUrl: `http://127.0.0.1:${address.port}`,
    storagePath: join(root, "session.bin"),
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
    startupRetryWindowMs: STARTUP_WINDOW_MS,
    startupRequestTimeoutMs: REQUEST_TIMEOUT_MS,
    startupRetryDelaysMs: [50],
  });
  status = (await runCauseEffect(auth.initialize())).status;
  await runCauseEffect(auth.dispose());
  assert.equal(status, "signed_out");
  assert.ok(requests.length >= 2, `expected a retry after the block, saw ${requests.length} request(s)`);
  assert.ok(requests.every((url) => url === "/health/live"));
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, status, requests, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}
