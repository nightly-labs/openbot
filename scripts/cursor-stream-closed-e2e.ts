// Runs turns on the real Cursor driver against a fake `cursor-agent acp` that, as Cursor
// 2026.10.22-27dcf5f does, sends "Error: RetriableError: WritableIterable is closed" as one answer
// chunk after a turn that succeeded (#3334). Checks that the reply is only the answer and that the
// turn completes, and that an answer that quotes the error keeps it.
// `bun run test:cursor-stream-closed`. Writes .openbot-build/cursor-stream-closed-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-stream-closed-e2e");
const QUOTED_ANSWER = "Cursor said: Error: RetriableError: WritableIterable is closed";

interface Report {
  passed: boolean;
  noise?: TurnResult;
  quote?: TurnResult;
}

const root = await mkdtemp(join(tmpdir(), "openbot-cursor-stream-closed-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const executable = join(root, "cursor", "cursor-agent");
  await installFakeAgent(executable, "cursor-stream-closed");
  const cli: AgentCliInfo = { executable, version: "2026.10.22-27dcf5f", source: "managed" };
  const client = requireProviderDriver("cursor").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const thread = await startThread(client, { cwd: workspace });

  report.noise = await runTurn(client, thread, { text: "ping" });
  assert.equal(report.noise.reply, "Pong.", "The reply has no Cursor stream error.");
  assert.equal(report.noise.status, "completed", "The turn completes.");
  assert.equal(report.noise.error, null, "The turn reports no error.");

  report.quote = await runTurn(client, thread, { text: "quote-case" });
  assert.equal(report.quote.reply, QUOTED_ANSWER, "An answer that quotes the error keeps it.");
  assert.equal(report.quote.status, "completed", "The quoting turn completes.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
