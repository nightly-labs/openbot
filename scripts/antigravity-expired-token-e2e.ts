// A Google token that stops working while Gemini runs (Discord report, OpenBot 0.58.0): each new chat
// waited five minutes and then failed, and Antigravity then deleted the saved token. Since #3944
// each Gemini session has a process of its own. That process refreshes the token when it opens the
// session, and prints Google's sign-in link when Google refuses it. The client then reports the
// sign-out, and `ProviderRuntime` stops it, but the stop did not end a process whose session was
// still opening. Runs the real Antigravity driver over a fake server that acts as 1.4.5 does.
// Cases: a chat answers while the token works; after the token is refused, a new chat fails at once
// with the Gemini sign-in message, and its process ends.
// `bun run test:antigravity-expired-token`. Writes .openbot-build/antigravity-expired-token-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-expired-token-e2e");
/** Far shorter than the five minutes the server waits, and far longer than a stop takes. */
const FAIL_LIMIT_MS = 20_000;

interface LogEntry {
  method: string;
  pid: number;
  sessionId?: string;
  refused?: boolean;
}

interface Report {
  passed: boolean;
  firstTurn?: TurnResult;
  refusedStart?: { error: string; elapsedMs: number; processEnded: boolean };
  requests?: LogEntry[];
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-expired-token-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];
/** The process that asked for a sign-in. A failed run ends it, or it keeps the test running. */
let refusedPid: number | undefined;

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(label: string, check: () => boolean): Promise<void> {
  const deadline = Date.now() + FAIL_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

try {
  const executable = join(root, "agy", "bin", "agy_acp_server");
  const workspace = join(root, "workspace");
  const refused = join(root, "token-refused");
  const log = join(root, "requests.jsonl");
  await mkdir(workspace, { recursive: true });
  await installFakeAgent(executable, "antigravity-expired-token", { FAKE_LOG: log, FAKE_TOKEN_REFUSED: refused });
  const cli: AgentCliInfo = { executable, version: "1.4.5", source: "managed" };
  const client = requireProviderDriver("antigravity").createClient(cli, FAIL_LIMIT_MS, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  // As `ProviderRuntime.#handleExit` does: a client that reports an exit is stopped.
  client.once("exit", () => void runCauseEffect(client.stop()).catch(() => undefined));
  client.start();

  // 1. The token works: a chat answers.
  const first = await startThread(client, { cwd: workspace });
  report.firstTurn = await runTurn(client, first, { text: "Reply with OK only.", timeoutMs: FAIL_LIMIT_MS });
  assert.equal(report.firstTurn.reply, "OK", "The chat answers while the token works.");

  // 2. Google refuses the token: a new chat fails at once with the sign-in message, not after the wait.
  await writeFile(refused, "");
  const started = Date.now();
  const error = await Promise.race([
    startThread(client, { cwd: workspace }).then(
      () => "The chat opened.",
      (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)),
    ),
    new Promise<string>((resolveRace) => setTimeout(() => resolveRace("The chat still waits."), FAIL_LIMIT_MS).unref()),
  ]);
  const elapsedMs = Date.now() - started;
  const requests = await readJsonl<LogEntry>(log);
  report.requests = requests;
  refusedPid = requests.find((request) => request.refused)?.pid;
  assert.ok(refusedPid, "The new chat's process asked for a sign-in.");
  const pid = refusedPid;
  await waitFor("the process that asked for a sign-in to end", () => !running(pid));
  report.refusedStart = { error, elapsedMs, processEnded: !running(pid) };
  assert.equal(error, sourceText("error.provider.antigravitySignIn"), "The chat names the Gemini sign-in.");

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  if (refusedPid && running(refusedPid)) process.kill(refusedPid);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
