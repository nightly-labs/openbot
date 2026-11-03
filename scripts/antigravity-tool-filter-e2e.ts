// Runs the real `antigravity` provider driver against a fake Antigravity ACP server, to check that
// each `session/new`, `session/load` and `session/resume` request asks Antigravity to remove its
// `schedule` and `run_workflow` tools. A load or resume sends the filter again, so a session that an
// earlier release opened also gets it. The model catalog probe sends no prompt, and it opens outside the
// workspace, so it is not checked. The fake server writes each session request to a log.
// `bun scripts/antigravity-tool-filter-e2e.ts`. Writes .openbot-build/antigravity-tool-filter-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { type AgentCliInfo, ANTIGRAVITY_MANIFEST } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-tool-filter-e2e");
const NL = String.fromCharCode(10);
const DISABLED = ["schedule", "run_workflow"];

// With `FAKE_AGY_RESUME=1` the server advertises `session/resume`, otherwise only `session/load`.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const models = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const sessionCapabilities = process.env.FAKE_AGY_RESUME === "1" ? { resume: {} } : {};
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities }, authMethods: [] } });
    return;
  }
  if (message.method.startsWith("session/") && message.method !== "session/prompt") {
    fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ method: message.method, cwd: message.params.cwd ?? null, meta: message.params._meta ?? null }) + NL);
  }
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "s-" + message.id, models } });
  if (message.method === "session/load" || message.method === "session/resume") return write({ id: message.id, result: { models } });
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
`;

interface SessionRequest {
  method: string;
  cwd: string | null;
  meta: { antigravity?: { disabledTools?: string[] } } | null;
}

interface Report {
  passed: boolean;
  /** The session requests of each case, with the restore method that the server advertises. */
  cases: Array<{ restore: "load" | "resume"; requests: SessionRequest[] }>;
  error?: string;
}

const report: Report = { passed: false, cases: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-filter-e2e-"));
const clients: AgentClient[] = [];

try {
  const executable = join(root, "agy", "1.4.5", "bin", "agy_acp_server");
  await mkdir(join(root, "agy", "1.4.5", "bin"), { recursive: true });
  await writeFile(join(root, "agy", "1.4.5", ANTIGRAVITY_MANIFEST), JSON.stringify({ version: "1.4.5" }));
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.4.5", source: "managed" };
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  for (const restore of ["load", "resume"] as const) {
    const log = join(root, `${restore}.jsonl`);
    process.env.FAKE_AGY_LOG = log;
    process.env.FAKE_AGY_RESUME = restore === "resume" ? "1" : "0";
    const open = () => {
      const client = requireProviderDriver("antigravity").createClient(cli, 10_000, {
        ...NO_PROVIDER_CREDENTIALS,
        providerTempDirectory: join(root, `temp-${restore}`),
      });
      clients.push(client);
      client.start();
      return client;
    };
    // A session, then a new process that opens it again, as after a restart.
    let client = open();
    const threadId = await startThread(client, { cwd: workspace });
    await runCauseEffect(client.stop());
    client = open();
    await runCauseEffect(client.request("thread/resume", { threadId, cwd: workspace }, (value) => value));
    await runCauseEffect(client.stop());

    const requests = await readJsonl<SessionRequest>(log);
    report.cases.push({ restore, requests });
    const sessions = requests.filter((request) => request.cwd === workspace);
    const methods = sessions.map((request) => request.method);
    assert.ok(methods.includes("session/new"), `No session/new: ${methods.join(", ")}`);
    assert.ok(methods.includes(`session/${restore}`), `No session/${restore}: ${methods.join(", ")}`);
    for (const request of sessions) {
      assert.deepEqual(
        request.meta?.antigravity?.disabledTools,
        DISABLED,
        `${request.method} does not remove ${DISABLED.join(", ")}: ${JSON.stringify(request.meta)}`,
      );
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
