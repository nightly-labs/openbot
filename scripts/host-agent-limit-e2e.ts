import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  HOST_AGENT_LIMIT_PREFERENCE_FILE,
  HostAgentLimitPreferenceStore,
} from "../src/main/host-agent-limit-preference-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/host-agent-limit-e2e");
const STEP_DEADLINE_MS = 30_000;

plugin({
  name: "host-agent-limit-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

async function createAgent(store: AgentStore, name: string) {
  return runCauseEffect(
    store.createAgent({
      name,
      description: "",
      avatarSeed: `seed-${name.toLowerCase().replaceAll(" ", "-")}`,
      avatarHue: null,
      avatarColor: null,
    }),
  );
}

async function expectHostLimit(action: () => Promise<unknown>, limit: number): Promise<string> {
  const expected = sourceText("error.agent.hostLimit", { limit });
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.equal(message, expected, "The host limit error text is different.");
    return message;
  }
  assert.fail(`The action succeeded at the limit of ${limit}.`);
}

const root = await mkdtemp(join(tmpdir(), "openbot-host-agent-limit-"));
let failure: unknown = null;
try {
  const userData = join(root, "user-data");
  const home = join(root, "home");
  const preferences = new HostAgentLimitPreferenceStore(join(userData, HOST_AGENT_LIMIT_PREFERENCE_FILE));
  await runCauseEffect(preferences.load());
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database, undefined, undefined, () => preferences.effective());
  await runCauseEffect(store.initialize());

  await step("a host with no preference file keeps the default of 100", async () => {
    assert.equal(preferences.effective(), 100);
    assert.deepEqual(preferences.get(), { limit: null, defaultLimit: 100, maxLimit: 1000 });
    return preferences.get();
  });

  await step("an admin route set of 2 reaches the store through the effective limit", async () => {
    await runCauseEffect(preferences.set(2));
    assert.equal(preferences.effective(), 2);
    return preferences.get();
  });

  const first = await step("the first agent is created under a limit of 2", async () => {
    const agent = await createAgent(store, "First agent");
    assert.equal(agent.name, "First agent");
    return agent.id;
  });
  const second = await step("the second agent is created under a limit of 2", async () => {
    const agent = await createAgent(store, "Second agent");
    return agent.id;
  });

  await step("a third creation is blocked with the host limit text of the setting", async () => {
    const message = await expectHostLimit(() => createAgent(store, "Third agent"), 2);
    assert.equal(store.list().length, 2);
    return message;
  });

  await step("a duplication is blocked with the same host limit text", async () => {
    const message = await expectHostLimit(
      () => runCauseEffect(store.duplicateAgent(second, "0d8d64f5-0f2c-4a56-9b4f-2f2f4d3a5c6e")),
      2,
    );
    assert.equal(store.list().length, 2);
    return message;
  });

  await step("raising the limit to 3 lets the third agent through", async () => {
    await runCauseEffect(preferences.set(3));
    const agent = await createAgent(store, "Third agent");
    assert.equal(store.list().length, 3);
    return agent.id;
  });

  await step("a new process reads the raised limit from the preference file", async () => {
    const reloaded = new HostAgentLimitPreferenceStore(join(userData, HOST_AGENT_LIMIT_PREFERENCE_FILE));
    await runCauseEffect(reloaded.load());
    assert.equal(reloaded.effective(), 3);
    assert.deepEqual(reloaded.get(), { limit: 3, defaultLimit: 100, maxLimit: 1000 });
    return reloaded.get();
  });

  await step("a reset to null returns the host to the default", async () => {
    await runCauseEffect(preferences.set(null));
    assert.equal(preferences.effective(), 100);
    const fourth = await createAgent(store, "Fourth agent");
    assert.equal(store.list().length, 4);
    return fourth.id;
  });

  await step("no agent of the host was removed by any limit change", async () => {
    const names = store
      .list()
      .map((agent) => agent.name)
      .sort();
    assert.deepEqual(names, ["First agent", "Fourth agent", "Second agent", "Third agent"]);
    return names;
  });

  assert.ok(first && second);
  report.passed = true;
} catch (error) {
  failure = error;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"} ${join(OUT, "report.json")}\n`);
  if (failure !== null) process.exit(1);
}
