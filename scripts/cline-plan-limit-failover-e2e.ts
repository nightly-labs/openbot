// Checks that Cline's spent weekly ClinePass plan is a usage limit (#10674). Runs the real agent service
// on a temporary profile with a fake `cline --acp` 3.0.74 (`provider-fakes/agents/cline-plan-limit.ts`).
// A prompt with `LIMIT-NOW` on a spent model fails as Cline 3.0.74 fails it: "Internal error" with
// "You have reached your weekly Clinepass limit. The limit resets in 8h 30m, …" in `data.details`.
// Each case has its own spent model: a plan limit holds its model for all agents.
// Checks:
//   1. Set to switch without asking, with a ready backup: the message runs again on the backup, the
//      agent moves to it, and no error shows.
//   2. With no backup: the message waits in the queue, and the limit holds the agent until the reset
//      that Cline names, 8 h 30 min, and one minute more.
// `bun run test:cline-plan-limit-failover`. Writes .openbot-build/cline-plan-limit-failover-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { CLINE_RECOMMENDED_MODELS_URL } from "../src/backend/cline-free-models";
import { installFakeAgent } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cline-plan-limit-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-cline-plan-limit-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const executable = join(root, "cline", "bin", "cline");
const logPath = join(root, "cline.jsonl");
const SPENT_FAILOVER = "cline-pass/glm-5.3";
const SPENT_WAIT = "cline-pass/kimi-k3";
const BACKUP = "anthropic/claude-sonnet-5.5";
// Cline's "8h 30m", and the minute that OpenBot adds because the text rounds down.
const RESET_MS = (8 * 60 + 31) * 60_000;

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
process.env.OPENBOT_CLINE_PATH = executable;
mkdirSync(home, { recursive: true });

// Cline's recommended-models endpoint, answered here with no models: the fake lists them.
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
    String(input) === CLINE_RECOMMENDED_MODELS_URL
      ? new Response(JSON.stringify({ recommended: [], free: [], clinePass: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : realFetch(input, init),
  { preconnect: realFetch.preconnect },
);

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Prompt {
  model: string;
  spent: boolean;
  text: string;
}

interface CaseReport {
  name: string;
  status: string;
  model: string | undefined;
  prompts: { model: string; spent: boolean }[];
  errors: number;
  resetsInMs?: number | null;
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
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

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function prompts(): Prompt[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "prompt");
}

await installFakeAgent(executable, "cline-plan-limit", {
  FAKE_LOG: logPath,
  FAKE_MODELS: [BACKUP, SPENT_FAILOVER, SPENT_WAIT].join(","),
  FAKE_SPENT_MODELS: [SPENT_FAILOVER, SPENT_WAIT].join(","),
});
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "cline",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "cline"),
});
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

/** Makes an agent on `model` with the backup models in `order`. Resolves after its first turn. */
async function createAgent(name: string, model: string, order: readonly string[]) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks a spent ClinePass plan.",
      avatarSeed: model.replace(/[^a-z0-9:-]/gu, "-"),
      avatarHue: null,
      provider: "cline",
      model,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}: the first turn`, () => idle(agent.id));
  await runCauseEffect(
    agents.updateAgent({
      agentId: agent.id,
      backupModels: { automatic: true, order: order.map((backup) => ({ provider: "cline", model: backup })) },
    }),
  );
  return agent;
}

function caseReport(name: string, agentId: string, status: string, before: number, since: number): CaseReport {
  const result: CaseReport = {
    name,
    status,
    model: store.list().find((candidate) => candidate.id === agentId)?.model,
    prompts: prompts()
      .slice(before)
      .map((prompt) => ({ model: prompt.model, spent: prompt.spent })),
    errors: events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId).length,
    passed: false,
  };
  report.cases.push(result);
  return result;
}

try {
  await runCauseEffect(agents.initialize());

  {
    const name = "spent plan, switch without asking";
    const agent = await createAgent(name, SPENT_FAILOVER, [BACKUP]);
    const since = events.length;
    const before = prompts().length;
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "LIMIT-NOW" }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `${name}: the message has a delivery`);
    const status = await waitFor(`${name}: the message to end`, () => {
      const value = mailbox.getDelivery(deliveryId)?.delivery.status;
      return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
    });
    const result = caseReport(name, agent.id, status, before, since);
    assert.equal(status, "completed", `${name}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
    assert.deepEqual(
      result.prompts.map((prompt) => [prompt.model, prompt.spent]),
      [
        [SPENT_FAILOVER, true],
        [BACKUP, false],
      ],
      `${name}: the message runs again on the backup`,
    );
    assert.equal(result.model, BACKUP, `${name}: the agent is on the backup model`);
    assert.equal(result.errors, 0, `${name}: no error shows`);
    result.passed = true;
  }

  {
    const name = "spent plan, no backup";
    const agent = await createAgent(name, SPENT_WAIT, []);
    const since = events.length;
    const before = prompts().length;
    const sentAt = Date.now();
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "LIMIT-NOW" }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `${name}: the message has a delivery`);
    const limit = await waitFor(
      `${name}: the limit to hold the message`,
      () =>
        mailbox.getDelivery(deliveryId)?.delivery.status === "queued" &&
        prompts().length > before &&
        agents.getRuntimeSnapshot().usageLimits?.find((entry) => entry.agentId === agent.id),
    );
    const result = caseReport(name, agent.id, "queued", before, since);
    // `resetsAt` is in epoch seconds.
    result.resetsInMs = limit.resetsAt === null ? null : limit.resetsAt * 1_000 - sentAt;
    assert.deepEqual(
      result.prompts.map((prompt) => [prompt.model, prompt.spent]),
      [[SPENT_WAIT, true]],
      `${name}: the message runs once`,
    );
    assert.ok(limit.resetsAt !== null, `${name}: the limit has a reset time`);
    assert.ok(
      Math.abs(limit.resetsAt * 1_000 - sentAt - RESET_MS) < 60_000,
      `${name}: the limit resets in 8 h 31 min, not in ${result.resetsInMs} ms`,
    );
    assert.equal(result.model, SPENT_WAIT, `${name}: the agent stays on its model`);
    assert.equal(result.errors, 0, `${name}: work that waits for the reset shows no error`);
    await runCauseEffect(agents.cancelQueuedMessage(agent.id, deliveryId));
    result.passed = true;
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
