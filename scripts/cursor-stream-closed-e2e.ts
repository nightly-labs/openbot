import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { type AppServerNotification, getString } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-stream-closed-e2e");
const QUOTED_ANSWER = "Cursor said: Error: RetriableError: WritableIterable is closed";
const INTERNAL_FAILURE = "Error: RetriableError: [internal] The agent loop failed.";

interface CanceledTurn extends TurnResult {
  causeCode: string | null;
}

interface Report {
  passed: boolean;
  noise?: TurnResult;
  quote?: TurnResult;
  canceledChunk?: CanceledTurn;
  canceledReject?: CanceledTurn;
  internal?: TurnResult;
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

  const connectionLost = sourceText("error.provider.acpServerLost", { provider: "Cursor" });
  const runWithCause = async (text: string): Promise<CanceledTurn> => {
    let causeCode: string | null = null;
    const listener = (notification: AppServerNotification) => {
      if (notification.method === "error" && getString(notification.params, "threadId") === thread)
        causeCode = getString(notification.params, "causeCode");
    };
    client.on("notification", listener);
    try {
      return { ...(await runTurn(client, thread, { text })), causeCode };
    } finally {
      client.off("notification", listener);
    }
  };

  report.canceledChunk = await runWithCause("canceled-chunk-case");
  assert.equal(report.canceledChunk.reply, "Checking the webhook.", "The reply keeps the answer and drops the error.");
  assert.equal(report.canceledChunk.status, "failed", "A canceled stream fails the turn.");
  assert.equal(report.canceledChunk.error, connectionLost, "The error says that Cursor lost its connection.");
  assert.equal(report.canceledChunk.causeCode, "network", "A canceled stream is a network failure.");

  report.canceledReject = await runWithCause("canceled-reject-case");
  assert.equal(report.canceledReject.status, "failed", "A refused prompt fails the turn.");
  assert.equal(report.canceledReject.error, connectionLost, "The refused prompt says that Cursor lost its connection.");
  assert.equal(
    report.canceledReject.causeCode,
    "network",
    "A refused prompt with a canceled stream is a network failure.",
  );

  report.internal = await runTurn(client, thread, { text: "internal-case" });
  assert.equal(report.internal.reply.trim(), INTERNAL_FAILURE, "An internal Cursor failure keeps its text.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
