import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { providerLabel } from "../src/backend/agent/thread-items";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-installed-fallback-e2e");
const WAIT_MS = 60_000;
const COPY = "2.3.0";
const INSTALLED_SAME_MAJOR = "2.2.5";
const INSTALLED_OPENCODE_1 = "1.19.5";
const COPY_FAILURE = "Internal error: Internal service failure";

interface RowReport {
  state: string | undefined;
  message: string | null | undefined;
  version: string | null | undefined;
  cliSource: string | undefined;
  otherCliVersion: string | undefined;
  lastError: string | null | undefined;
}

interface Report {
  passed: boolean;
  fallback?: {
    row: RowReport;
    starts: string[];
    savedChoices: number;
    copyChosen?: { copyStarts: number };
  };
  olderMajor?: {
    row: RowReport;
    starts: string[];
  };
}

const report: Report = { passed: false };
const originalPath = process.env.PATH;
const scratch = await mkdtemp(join(tmpdir(), "openbot-opencode-installed-fallback-e2e-"));
const userBin = join(scratch, "user-bin");
process.env.PATH = [userBin, originalPath].filter(Boolean).join(delimiter);

async function waitFor(label: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 50));
  }
}

async function withOpenCode(
  installedVersion: string,
  run: (context: {
    providers: ProviderRuntime;
    row: () => RowReport;
    starts: () => Promise<string[]>;
    savedChoices: () => number;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(scratch, "case-"));
  const log = join(root, "starts.jsonl");
  process.env.FAKE_LOG = log;

  const copyExecutable = join(root, "runtime", "opencode", "bin", "opencode");
  await installFakeAgent(copyExecutable, "opencode-start-failure", {
    FAKE_OPENCODE_VERSION: COPY,
    FAKE_OPENCODE_FAIL: "1",
  });
  await installFakeAgent(join(userBin, "opencode"), "opencode-start-failure", {
    FAKE_OPENCODE_VERSION: installedVersion,
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
  const row = (): RowReport => {
    const current = providers.status().providers?.find((candidate) => candidate.id === "opencode");
    return {
      state: current?.state,
      message: current?.message,
      version: current?.version,
      cliSource: current?.cliSource,
      otherCliVersion: current?.otherCliVersion,
      lastError: current?.lastError,
    };
  };
  const starts = async () => (await readJsonl<{ version: string }>(log)).map((entry) => entry.version);

  try {
    await run({ providers, row, starts, savedChoices: () => savedChoices });
  } finally {
    for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await withOpenCode(INSTALLED_SAME_MAJOR, async ({ providers, row, starts, savedChoices }) => {
    await runCauseEffect(providers.ensureProvider("opencode").pipe(Effect.ignore));
    await waitFor("the installed CLI to run", () => row().state === "available");
    report.fallback = { row: row(), starts: await starts(), savedChoices: savedChoices() };
    assert.equal(row().version, INSTALLED_SAME_MAJOR, "the user's CLI runs");
    assert.equal(row().cliSource, "system");
    assert.equal(row().otherCliVersion, COPY, "the row offers OpenBot's version back");
    assert.deepEqual(
      report.fallback.starts,
      [COPY, COPY, COPY, INSTALLED_SAME_MAJOR],
      "the copy gets its 3 starts first",
    );
    assert.equal(savedChoices(), 0, "the fallback is not saved as the user's choice");

    await runCauseEffect(providers.chooseInstalledCli("opencode", false));
    const copyStarts = async () => (await starts()).filter((version) => version === COPY).length;
    await waitFor("the copy to start again", async () => (await copyStarts()) === 4);
    report.fallback.copyChosen = { copyStarts: await copyStarts() };
  });

  await withOpenCode(INSTALLED_OPENCODE_1, async ({ providers, row, starts }) => {
    await runCauseEffect(providers.ensureProvider("opencode").pipe(Effect.ignore));
    const stopped = sourceText("error.provider.startPaused", { provider: providerLabel("opencode") });
    await waitFor("OpenBot to stop starting OpenCode", () => row().message === stopped);
    report.olderMajor = { row: row(), starts: await starts() };
    assert.deepEqual(report.olderMajor.starts, [COPY, COPY, COPY], "an installed OpenCode 1 does not start");
    assert.equal(row().cliSource, "managed", "OpenBot keeps its own copy");
    assert.equal(row().version, COPY);
    assert.equal(row().lastError, COPY_FAILURE, "Diagnostics keeps the start failure of OpenBot's copy");
  });
  report.passed = true;
} finally {
  process.env.PATH = originalPath;
  await rm(scratch, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
