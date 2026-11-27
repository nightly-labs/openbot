import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { startStdioMcpRelay } from "../src/backend/mcp-stdio-relay";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-stdio-relay-slow-start-e2e");

const SERVER = `
const { existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [dir, mode] = process.argv.slice(2);
let buffer = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const whenReleased = (run) => {
  const check = () => (existsSync(join(dir, "release")) ? run() : setTimeout(check, 20));
  check();
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (mode === "crash" && message.method === "notifications/initialized") process.exit(1);
    if (message.id === undefined) continue;
    if (message.method === "initialize") {
      writeFileSync(join(dir, "launch-" + process.pid), "");
      if (mode === "hang") continue;
      whenReleased(() => {
        if (mode === "exit") process.exit(1);
        if (mode === "error") send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "no config" } });
        else send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "slow", version: "1" } } });
      });
      continue;
    }
    if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
    else send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`;

type Mode = "slow" | "exit" | "error" | "hang" | "crash";

interface ScenarioResult {
  reports: number;
  launches?: number;
}

const report: { passed: boolean; scenarios: Partial<Record<string, ScenarioResult>>; failures: string[] } = {
  passed: false,
  scenarios: {},
  failures: [],
};

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-stdio-relay-slow-start-e2e-"));
const program = join(root, "slow-server.cjs");
await writeFile(program, SERVER);

const waitFor = async (check: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 20));
  }
};

const launches = async (dir: string) => (await readdir(dir)).filter((name) => name.startsWith("launch-")).length;

const initialize = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "provider", version: "1" },
  },
});

async function scenario(mode: Mode, name: string) {
  const dir = join(root, name);
  await mkdir(dir);
  let reports = 0;
  const relay = await runCauseEffect(
    startStdioMcpRelay({
      command: process.execPath,
      args: [program, dir, mode],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      cwd: dir,
      onStartAbandoned: () => {
        reports += 1;
      },
    }),
  );
  const headers = {
    authorization: `Bearer ${relay.token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const post = (body: unknown, extra: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(relay.url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body), signal });
  const gaveUp = new AbortController();
  const first = post(initialize(1), {}, gaveUp.signal)
    .then((response) => response.text())
    .catch(() => "aborted");
  await waitFor(async () => (await launches(dir)) === 1, "the first initialize to reach the server");
  gaveUp.abort();
  assert.equal(await first, "aborted", "the provider gave up on the first initialize");
  return { dir, relay, post, reports: () => reports };
}

try {
  {
    const run = await scenario("slow", "slow");
    await writeFile(join(run.dir, "release"), "");
    const retry = await run.post(initialize(2));
    const sessionId = retry.headers.get("mcp-session-id") ?? "";
    assert.match(await retry.text(), /"serverInfo"/, "the retry gets the initialize answer of the kept server");
    await run.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sessionId });
    const tools = await run.post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": sessionId });
    assert.match(await tools.text(), /"ping"/, "the provider gets the tools of the kept server");
    assert.equal(await launches(run.dir), 1, "the retry uses the kept server");
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 0, "a slow server that the provider takes later gives no card");
    report.scenarios.slow = { launches: 1, reports: run.reports() };
  }
  {
    const run = await scenario("exit", "exit");
    await writeFile(join(run.dir, "release"), "");
    await waitFor(() => run.reports() > 0, "a card for the kept server that stopped");
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 1, "a kept server that stops gives one card");
    report.scenarios.exit = { reports: run.reports() };
  }
  {
    const run = await scenario("error", "error");
    await writeFile(join(run.dir, "release"), "");
    await waitFor(() => run.reports() > 0, "a card for the kept server that refused initialize");
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 1, "a kept server that refuses initialize gives one card");
    report.scenarios.error = { reports: run.reports() };
  }
  for (const mode of ["exit", "error"] as const) {
    const run = await scenario(mode, `taken-${mode}`);
    const retry = await run.post(initialize(2));
    await writeFile(join(run.dir, "release"), "");
    assert.match(await retry.text(), /"error"/, "the retry gets the failure of the kept server");
    await waitFor(() => run.reports() > 0, `a card for the taken server (${mode})`);
    assert.equal(await launches(run.dir), 1, "the retry took the kept server");
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 1, `a kept server that a retry took and that then fails (${mode}) gives one card`);
    report.scenarios[`taken-${mode}`] = { launches: 1, reports: run.reports() };
  }
  {
    const run = await scenario("crash", "crash-after-start");
    await writeFile(join(run.dir, "release"), "");
    const retry = await run.post(initialize(2));
    const sessionId = retry.headers.get("mcp-session-id") ?? "";
    assert.match(await retry.text(), /"serverInfo"/, "the kept server starts");
    await run.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sessionId });
    await waitFor(
      async () => (await runCauseEffect(run.relay.callTool("ping", {}))) === null,
      "the relay to see that the started server stopped",
    );
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 0, "a server that stops after a good start gives no start card");
    report.scenarios["crash-after-start"] = { launches: 1, reports: run.reports() };
  }
  {
    const run = await scenario("hang", "close");
    await runCauseEffect(run.relay.close());
    assert.equal(run.reports(), 0, "closing the relay with a kept server gives no card");
    report.scenarios.close = { reports: run.reports() };
  }
  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
