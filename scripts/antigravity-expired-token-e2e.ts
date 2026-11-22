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
process.env.GEMINI_HOME = join(root, "gemini");
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
  const executable = join(root, "agy", "1.5.4", "bin", "antigravity");
  const workspace = join(root, "workspace");
  const refused = join(root, "token-refused");
  const log = join(root, "requests.jsonl");
  await mkdir(workspace, { recursive: true });
  await installFakeAgent(executable, "antigravity-expired-token", { FAKE_LOG: log, FAKE_TOKEN_REFUSED: refused });
  const cli: AgentCliInfo = { executable, version: "1.5.4", source: "managed" };
  const client = requireProviderDriver("antigravity").createClient(cli, FAIL_LIMIT_MS, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.once("exit", () => void runCauseEffect(client.stop()).catch(() => undefined));
  client.start();

  const first = await startThread(client, { cwd: workspace });
  report.firstTurn = await runTurn(client, first, { text: "Reply with OK only.", timeoutMs: FAIL_LIMIT_MS });
  assert.equal(report.firstTurn.reply, "OK", "The chat answers while the token works.");

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
