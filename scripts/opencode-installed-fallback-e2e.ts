import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-installed-fallback-e2e");
const WAIT_MS = 60_000;
const COPY = "2.3.0";
const INSTALLED = "1.19.5";

interface Report {
  passed: boolean;
  fallback?: {
    state: string | undefined;
    version: string | null | undefined;
    cliSource: string | undefined;
    otherCliVersion: string | undefined;
  };
  starts?: string[];
  savedChoices?: number;
  copyChosen?: { copyStarts: number };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-installed-fallback-e2e-"));
const log = join(root, "starts.jsonl");
const report: Report = { passed: false };
const userBin = join(root, "user-bin");
process.env.PATH = [userBin, process.env.PATH].filter(Boolean).join(delimiter);
process.env.FAKE_LOG = log;

async function waitFor(label: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 50));
  }
}

const starts = async () => (await readJsonl<{ version: string }>(log)).map((entry) => entry.version);
const copyStarts = async () => (await starts()).filter((version) => version === COPY).length;

const copyExecutable = join(root, "runtime", "opencode", "bin", "opencode");
await installFakeAgent(copyExecutable, "opencode-start-failure", {
  FAKE_OPENCODE_VERSION: COPY,
  FAKE_OPENCODE_FAIL: "1",
});
await installFakeAgent(join(userBin, "opencode"), "opencode-start-failure", {
  FAKE_OPENCODE_VERSION: INSTALLED,
});

let savedChoices = 0;
const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
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
    sharedRoot: () => join(root, "shared"),
    onProviderResumed: () => undefined,
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
  },
  emit: () => undefined,
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "opencode",
  clientFactory: null,
  bundledExecutables: { opencode: copyExecutable },
  saveInstalledCliChoice: () =>
    Effect.sync(() => {
      savedChoices += 1;
    }),
  credentials: { ...NO_PROVIDER_CREDENTIALS, providerTempDirectory: join(root, "temp") },
  redactMcp: (text) => text,
});
const row = () => providers.status().providers?.find((candidate) => candidate.id === "opencode");

try {
  await runCauseEffect(providers.ensureProvider("opencode").pipe(Effect.ignore));

  await waitFor("the installed CLI to run", () => row()?.state === "available");
  report.fallback = {
    state: row()?.state,
    version: row()?.version,
    cliSource: row()?.cliSource,
    otherCliVersion: row()?.otherCliVersion,
  };
  report.starts = await starts();
  report.savedChoices = savedChoices;
  assert.equal(row()?.version, INSTALLED, "the user's CLI runs");
  assert.equal(row()?.cliSource, "system");
  assert.equal(row()?.otherCliVersion, COPY, "the row offers OpenBot's version back");
  assert.deepEqual(report.starts, [COPY, COPY, COPY, INSTALLED], "the copy gets its 3 starts first");
  assert.equal(savedChoices, 0, "the fallback is not saved as the user's choice");

  await runCauseEffect(providers.chooseInstalledCli("opencode", false));
  await waitFor("the copy to start again", async () => (await copyStarts()) === 4);
  report.copyChosen = { copyStarts: await copyStarts() };
  report.passed = true;
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
