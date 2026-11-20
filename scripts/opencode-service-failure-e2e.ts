import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-service-failure-e2e");
const WAIT_MS = 30_000;

interface StartReport {
  state: string | undefined;
  message: string | null | undefined;
  starts: number;
  activationFailures: number;
}

interface Report {
  passed: boolean;
  turn?: { error: string };
  slowPlugins?: StartReport;
  stuckPlugins?: StartReport;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-service-failure-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function waitFor(label: string, check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 50));
  }
}

async function startWithActivationFailures(
  name: string,
  activationFailures: number,
  requestTimeoutMs: number,
  settled: (row: { state: string; message: string | null } | undefined) => boolean,
): Promise<StartReport> {
  const folder = join(root, name);
  const log = join(folder, "fake.jsonl");
  const executable = join(folder, "runtime", "opencode", "bin", "opencode");
  await installFakeAgent(executable, "opencode-plugin-activation", {
    FAKE_LOG: log,
    FAKE_OPENCODE_ACTIVATION_FAILURES: String(activationFailures),
  });
  const store = new AgentStore(
    join(folder, "profile"),
    join(folder, "home"),
    new OpenBotDatabase(join(folder, "profile")),
  );
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "opencode"),
    conversation: new ConversationRuntime(
      store,
      () => undefined,
      () => store.list(),
    ),
    hooks: {
      bindClient: () => undefined,
      onProvidersReady: () => Effect.void,
      onProviderLost: () => undefined,
      onClientStopped: () => Effect.void,
      isStopping: () => false,
      isProviderBusy: () => false,
      isAgentBusy: () => false,
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(folder, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: () => undefined,
    emitError: () => undefined,
    requestTimeoutMs,
    preferredProvider: "opencode",
    clientFactory: null,
    bundledExecutables: { opencode: executable },
    saveInstalledCliChoice: () => Effect.void,
    credentials: { ...NO_PROVIDER_CREDENTIALS, providerTempDirectory: join(folder, "temp") },
    redactMcp: (text) => text,
  });
  const row = () => providers.status().providers?.find((candidate) => candidate.id === "opencode");
  try {
    await runCauseEffect(providers.ensureProvider("opencode").pipe(Effect.ignore));
    await waitFor(`${name} to settle`, () => settled(row()));
    const entries = await readJsonl<{ event: string }>(log);
    return {
      state: row()?.state,
      message: row()?.message,
      starts: entries.filter((entry) => entry.event === "start").length,
      activationFailures: entries.filter((entry) => entry.event === "plugins-activating").length,
    };
  } finally {
    for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  }
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const executable = join(root, "opencode", "bin", "opencode");
  await installFakeAgent(executable, "opencode-service-failure");
  const cli: AgentCliInfo = { executable, version: "2.1.3", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const { error } = await runTurn(client, await startThread(client, { cwd: workspace }));
  assert.equal(error, sourceText("error.provider.opencodeServiceFailure"), "A failed turn names OpenCode's service.");
  report.turn = { error };

  report.slowPlugins = await startWithActivationFailures("slow-plugins", 2, 10_000, (row) => row?.state !== "starting");
  assert.equal(report.slowPlugins.state, "available", "OpenCode starts once its plugins finish loading.");
  assert.equal(report.slowPlugins.starts, 1, "The first start waits for the plugins; it does not fail.");
  assert.equal(report.slowPlugins.activationFailures, 2);

  report.stuckPlugins = await startWithActivationFailures("stuck-plugins", -1, 3_000, (row) => row?.state === "error");
  assert.equal(
    report.stuckPlugins.message,
    sourceText("error.provider.opencodeStillStarting"),
    "A start that OpenCode's plugins never let finish shows plain text.",
  );
  assert.equal(report.stuckPlugins.starts, 1, "The model list is asked again inside the same start.");
  assert.ok(report.stuckPlugins.activationFailures > 1, "The start asks again before it gives up.");
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
