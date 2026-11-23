// Runs the real agent service, scheduler and ACP client on a temporary profile with a fake `kiro-cli`
// (`provider-fakes/agents/kiro-parallel.ts`) to check that an agent whose provider is Kiro runs its own chat and its
// side threads at the same time, and that nothing else changes for the other custom ACP agents:
// - A Kiro agent: its chat turn, and then two side threads, run in one process at once. No thread waits with the
//   hold `one-turn`, and each thread has its own session.
// - A control agent, a custom ACP agent: the same messages run one at a time, and a side thread waits with `one-turn`.
// `bun run test:kiro-parallel`. Writes .openbot-build/kiro-parallel-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/kiro-parallel-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-kiro-parallel-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const kiroCommand = join(root, "bin", "kiro-cli");
const controlCommand = join(root, "bin", "fake-acp");
const logs = { kiro: join(root, "kiro.jsonl"), control: join(root, "control.jsonl") };
const PROMPT_MS = 1_500;

// Before the service modules load: the provider reads its own path, and the stores read the home folder.
process.env.HOME = home;
process.env.OPENBOT_KIRO_PATH = kiroCommand;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");

const PERSON = { id: "local", name: "Alex" };

interface LogEntry {
  event: string;
  sessionId?: string;
  at?: number;
  active?: number;
  message?: string;
  argv?: string[];
}

interface Outcome {
  maxActive: number;
  sessions: number;
  holds: string[];
  prompts: number;
}

/** Stopped at the end: it closes the fake `kiro-cli` processes, which run until their client stops them. */
let running: { stop: () => Effect.Effect<void, { readonly cause: unknown }> } | null = null;

const report: {
  passed: boolean;
  kiro?: Outcome & { argv: string[] | undefined };
  control?: Outcome;
  error?: string;
} = { passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

try {
  await installFakeAgent(kiroCommand, "kiro-parallel", { FAKE_LOG: logs.kiro, FAKE_PROMPT_MS: String(PROMPT_MS) });
  await installFakeAgent(controlCommand, "kiro-parallel", {
    FAKE_LOG: logs.control,
    FAKE_PROMPT_MS: String(PROMPT_MS),
  });
  await mkdir(userData, { recursive: true });
  await writeFile(join(root, "README.md"), "Scratch profile of a test.\n");

  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const customAgents = [
    { id: "control", name: "Control", command: controlCommand, args: ["acp"], env: [], usagePrompt: null },
  ];
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "kiro",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "kiro" && provider !== "acp"),
    timezone: () => "UTC",
    credentials: { ...NO_PROVIDER_CREDENTIALS, customAgents: () => customAgents },
  });
  running = agents;
  await runCauseEffect(agents.initialize());

  const idle = (agentId: string) =>
    waitFor(
      "the chat and the side threads to end",
      () =>
        agents
          .listQueue(agentId)
          .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)) &&
        agents.listTasks(agentId).tasks.every((task) => task.state !== "running" && task.state !== "queued"),
    );

  /** One chat message, then two side threads while it runs. Returns what the fake logged and what the tasks showed. */
  async function scenario(label: string, agentId: string, log: string): Promise<Outcome> {
    await idle(agentId);
    const first = (await readJsonl<LogEntry>(log)).length;
    const holds = new Set<string>();
    const sample = setInterval(() => {
      for (const task of agents.listTasks(agentId).tasks) if (task.hold) holds.add(task.hold);
    }, 20);
    try {
      await runCauseEffect(agents.sendMessage({ agentId, text: `${label} chat` }, PERSON));
      await waitFor(`${label}: the chat prompt to reach the agent`, () =>
        readJsonlSync(log).some((entry, index) => index >= first && entry.message?.includes(`${label} chat`)),
      );
      await runCauseEffect(agents.startTask({ agentId, text: `${label} one` }, PERSON));
      await runCauseEffect(agents.startTask({ agentId, text: `${label} two` }, PERSON));
      await idle(agentId);
    } finally {
      clearInterval(sample);
    }
    const entries = readJsonlSync(log).slice(first);
    const starts = entries.filter((entry) => entry.event === "prompt-start");
    return {
      maxActive: Math.max(0, ...starts.map((entry) => entry.active ?? 0)),
      sessions: new Set(starts.map((entry) => entry.sessionId)).size,
      holds: [...holds],
      prompts: starts.length,
    };
  }

  const create = (name: string, provider: "kiro" | "acp", model: string) =>
    runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} runs turns.`,
        avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
        avatarHue: null,
        initialMessage: "Hello.",
        provider,
        model,
      }),
    );

  const kiroAgent = await create("Kiro agent", "kiro", "fake-model");
  const controlAgent = await create("Control agent", "acp", "control/fake-model");

  // A Kiro agent: the chat and the two side threads run at the same time.
  const kiro = await scenario("kiro", kiroAgent.id, logs.kiro);
  const initialize = readJsonlSync(logs.kiro).find((entry) => entry.event === "initialize");
  report.kiro = { ...kiro, argv: initialize?.argv };
  assert.deepEqual(initialize?.argv, ["acp", "--agent-engine=v2"], "Kiro starts with the V2 engine.");
  assert.ok(kiro.prompts >= 3, `A Kiro agent got ${kiro.prompts} prompts, not the chat and two threads.`);
  assert.ok(kiro.maxActive >= 3, `The turns of a Kiro agent overlap at most ${kiro.maxActive} at a time, not 3.`);
  assert.equal(kiro.sessions, kiro.prompts, "Each turn of a Kiro agent runs in a session of its own.");
  assert.ok(!kiro.holds.includes("one-turn"), "A side thread of a Kiro agent waits for the one-turn limit.");

  // The control: a custom ACP agent with another command still runs one turn at a time.
  const control = await scenario("control", controlAgent.id, logs.control);
  report.control = control;
  assert.equal(control.maxActive, 1, `The control agent ran ${control.maxActive} turns at once, not 1.`);
  assert.ok(control.holds.includes("one-turn"), "A side thread of the control agent did not wait with `one-turn`.");

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (running) await runCauseEffect(running.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}

function readJsonlSync(path: string): LogEntry[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
