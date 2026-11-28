import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { withStartModels } from "../src/backend/acp-client";
import type { AgentClient } from "../src/backend/agent-client";
import { decodeModelListResponse } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-empty-models-e2e");

interface StartResult {
  sessions: number;
  models: string[];
  error: string | null;
}

interface Report {
  passed: boolean;
  emptyOnce?: StartResult;
  alwaysEmpty?: StartResult;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-empty-models-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function startAntigravity(name: string, emptySessions: number): Promise<StartResult> {
  const executable = join(root, name, "bin", "antigravity");
  const sessionLog = join(root, name, "sessions.log");
  await installFakeAgent(executable, "antigravity-empty-models", {
    FAKE_ANTIGRAVITY_EMPTY_SESSIONS: String(emptySessions),
    FAKE_ANTIGRAVITY_SESSION_LOG: sessionLog,
  });
  const client = requireProviderDriver("antigravity").createClient(
    { executable, version: "1.5.18", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const listed = await Effect.runPromise(
    Effect.result(client.request("model/list", withStartModels({}), decodeModelListResponse)),
  );
  const sessions = (await readFile(sessionLog, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
  if (Result.isSuccess(listed))
    return { sessions, models: listed.success.data.map((model) => model.model ?? ""), error: null };
  const cause = listed.failure.cause;
  return { sessions, models: [], error: cause instanceof Error ? cause.message : String(cause) };
}

try {
  report.emptyOnce = await startAntigravity("empty-once", 1);
  assert.equal(report.emptyOnce.error, null, "Gemini starts when its second model list has models.");
  assert.deepEqual(report.emptyOnce.models, ["gemini-4-carbon", "gemini-4-argon"], "The second model list is used.");
  assert.equal(report.emptyOnce.sessions, 2, "OpenBot asks Gemini for its models one more time.");

  report.alwaysEmpty = await startAntigravity("always-empty", Number.MAX_SAFE_INTEGER);
  assert.equal(report.alwaysEmpty.sessions, 2, "OpenBot asks Gemini again only once.");
  assert.ok(
    report.alwaysEmpty.error?.startsWith(sourceText("error.provider.geminiNoModels")),
    "The error tells the user what to do in plain words.",
  );
  assert.ok(
    !report.alwaysEmpty.error?.includes(sourceText("error.provider.acpNoModels")),
    "The error has no protocol words.",
  );

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
