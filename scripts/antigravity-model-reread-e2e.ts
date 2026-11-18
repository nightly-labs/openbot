// Checks that the model list of a running Antigravity CLI is read again, so a Gemini model that Google
// releases while OpenBot runs shows in the picker without a restart (#12308). Runs the real
// `antigravity` driver and the real `ModelCatalog` over a fake `agy acp`
// (`provider-fakes/agents/antigravity-model-list.ts`) whose list changes while it runs. Checks:
//   1. The Antigravity catalog asks for the quiet reread of a running provider (`relistWhileRunning`),
//      the condition that `ProviderRuntime.#rereadModels` reads.
//   2. That reread (`ModelCatalog.relist` with `quiet`) gives the new model.
//   3. The reread resumes the kept probe session and opens no new one: Antigravity keeps about 100 MB
//      for each session until its process ends (#3925).
// The 10-minute timer itself is not driven here. A real CLI was not checked: whether `agy acp` lists a
// new model on a resume of a session that it opened before the release.
// `bun scripts/antigravity-model-reread-e2e.ts`. Writes .openbot-build/antigravity-model-reread-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-model-reread-e2e");
const BEFORE = ["gemini-4-carbon", "gemini-4-argon"];
const RELEASED = "gemini-4-neon";

interface SetupLine {
  event: string;
  method: string;
  sessionId: string;
  models: string[];
}

interface Report {
  passed: boolean;
  relistWhileRunning?: boolean;
  atStart?: string[];
  afterReread?: string[];
  rereadFresh?: boolean;
  setups?: { method: string; sessionId: string; models: string[] }[];
  providerErrors?: number;
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-model-reread-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const executable = join(root, "agy", "bin", "antigravity");
const log = join(root, "agent.jsonl");
const control = join(root, "control.json");
const report: Report = { passed: false };
const clients: AgentClient[] = [];

try {
  await writeFile(control, JSON.stringify({ models: BEFORE }));
  await installFakeAgent(executable, "antigravity-model-list", { FAKE_LOG: log, FAKE_CONTROL: control });
  const client = requireProviderDriver("antigravity").createClient(
    { executable, version: "1.5.11", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const providerErrors: unknown[] = [];
  const catalog = new ModelCatalog({
    client: (provider) => (provider === "antigravity" ? client : undefined),
    isSignedOut: () => false,
    requestTimeoutMs: 10_000,
    recordProviderError: (_provider, error) => providerErrors.push(error),
    startSettingsChanged: () => Effect.void,
  });
  const listed = () =>
    catalog
      .list()
      .filter((model) => model.provider === "antigravity")
      .map((model) => model.id);

  // 1. The reread of a running provider includes Antigravity.
  report.relistWhileRunning = requireProviderDriver("antigravity").catalog?.relistWhileRunning === true;
  assert.ok(report.relistWhileRunning, "The Antigravity list is read again while the CLI runs.");

  // The list at the start of the provider.
  await runCauseEffect(catalog.refresh());
  report.atStart = listed();
  assert.deepEqual(report.atStart, BEFORE, "The start lists the models that the account has.");

  // 2. Google releases a model while the CLI runs, and the quiet reread lists it.
  await writeFile(control, JSON.stringify({ models: [RELEASED, ...BEFORE] }));
  report.rereadFresh = await runCauseEffect(catalog.relist("antigravity", { quiet: true }));
  report.afterReread = listed();
  assert.ok(report.rereadFresh, "The reread gives a fresh list.");
  assert.deepEqual(report.afterReread, [RELEASED, ...BEFORE], "The reread lists the released model.");

  // 3. Each read after the first resumes the one probe session.
  const setups = (await readJsonl<SetupLine>(log)).filter((line) => line.event === "setup");
  report.setups = setups.map(({ method, sessionId, models }) => ({ method, sessionId, models }));
  const opened = setups.filter((line) => line.method === "session/new");
  assert.equal(opened.length, 1, "Only the first read opens a probe session.");
  const resumed = setups.filter((line) => line.method === "session/resume");
  assert.ok(resumed.length > 0, "The reread resumes the probe session.");
  assert.ok(
    resumed.every((line) => line.sessionId === opened[0]?.sessionId),
    "The reread resumes the kept probe, not another session.",
  );
  report.providerErrors = providerErrors.length;
  assert.equal(report.providerErrors, 0, "No read records a provider error.");
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await stopClients(clients).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
