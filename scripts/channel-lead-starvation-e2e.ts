import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { HostMemory } from "../src/backend/host-memory";
import { xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-lead-starvation-e2e");
const FAKE_AGENT = resolve(import.meta.dirname, "provider-fakes/agents/channel-lead.ts");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-lead-starvation-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const releaseDir = join(root, "release");
const fakeLog = join(root, "fake.jsonl");
const PERSON = { id: "local", name: "Alex" };

process.env.HOME = home;
process.env.USERPROFILE = home;
mkdirSync(home, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");
const { CustomAgentStore } = await import("../src/main/custom-agent-store");

interface FakeEntry {
  event: "prompt" | "done";
  at: number;
  sessionId: string;
  markers?: string[];
  text?: string;
}

interface Report {
  steps: Array<{ name: string; detail?: unknown }>;
  fairOrder?: { prompts: string[]; channelStartedWhileNewerQueued: string[]; olderRanFirst: boolean };
  channelFull?: { mainRan: boolean; channelTaskState: string; channelStartedAfterSlotFreed: boolean };
  passed: boolean;
  error?: string;
}

const report: Report = { steps: [], passed: false };
const step = (name: string, detail?: unknown) => report.steps.push({ name, detail });

const memory: HostMemory = {
  level: () => "ok",
  turnLimit: () => 8,
  reserveTurn: () => () => {},
  subscribe: () => () => {},
  hostedPlan: false,
};
const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
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
    await new Promise((done) => setTimeout(done, 20));
  }
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const release = (marker: string) => writeFileSync(join(releaseDir, marker), "");
const entries = (): FakeEntry[] =>
  existsSync(fakeLog)
    ? readFileSync(fakeLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const prompted = (marker: string) =>
  entries().some((entry) => entry.event === "prompt" && entry.markers?.includes(marker) === true);
const promptOrder = (names: readonly string[]) =>
  entries()
    .filter((entry) => entry.event === "prompt")
    .flatMap((entry) => names.filter((name) => entry.markers?.includes(name)).slice(-1));

const customAgents = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  hostMemory: memory,
  preferredProvider: "acp",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
  busyMessageMode: () => "queue",
  timezone: () => "UTC",
  credentials: { ...NO_PROVIDER_CREDENTIALS, customAgents: () => customAgents.configs() },
});

const queue = (agentId: string) => agents.listQueue(agentId).deliveries;
const statusOf = (agentId: string, deliveryId: string) =>
  queue(agentId).find((delivery) => delivery.id === deliveryId)?.status;
const idle = (agentId: string) =>
  queue(agentId).every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
const taskOf = (channelId: string, ownerAgentId: string, marker: string): ChannelTask | undefined =>
  agents.channels.store
    .tasks(channelId)
    .find((task) => task.ownerAgentId === ownerAgentId && task.instruction.includes(marker));

async function personMessage(agentId: string, text: string): Promise<string> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const id = receipt.deliveries[0]?.id;
  assert.ok(id, "The person message has a delivery.");
  return id;
}

async function teammateNote(senderAgentId: string, recipientAgentId: string, text: string): Promise<string> {
  const receipt = await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "agent", agentId: senderAgentId },
      recipientAgentIds: [recipientAgentId],
      text,
      expectsReply: false,
      idempotencyKey: `teammate-note:${randomUUID()}`,
    }),
  );
  const id = receipt.deliveries[0]?.id;
  assert.ok(id, "The teammate note has a delivery.");
  await pause(15);
  return id;
}

async function createChannel(name: string, memberIds: string[], leadAgentId: string): Promise<string> {
  const channelId = randomUUID();
  await runCauseEffect(
    agents.channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name,
          title: "",
          instructions: "An end-to-end test channel.",
          members: memberIds.map((agentId) => ({ agentId })),
          leadAgentId,
        },
      },
      PERSON,
    ),
  );
  return channelId;
}

async function mention(channelId: string, agentId: string, text: string): Promise<void> {
  await runCauseEffect(
    agents.channels.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text,
        recipientAgentId: agentId,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  await pause(15);
}

const markers: string[] = [];
const hold = (name: string) => {
  markers.push(name);
  return `HOLD-${name}`;
};
const pass = (name: string) => {
  release(name);
  return `HOLD-${name}`;
};

try {
  await runCauseEffect(customAgents.load());
  await runCauseEffect(
    customAgents.save({
      id: "lead",
      name: "Lead",
      command: process.execPath,
      args: [FAKE_AGENT],
      env: [
        { name: "FAKE_LOG", value: fakeLog },
        { name: "FAKE_RELEASE_DIR", value: releaseDir },
      ],
      usagePrompt: null,
    }),
  );
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} for the channel starvation check.`,
        avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "acp",
        model: "lead/fast",
      }),
    );
    await waitFor(`${name} to finish its first turn`, () => idle(agent.id));
    return agent;
  };
  const lead = await create("Lead");
  const helperOne = await create("Helper one");
  const helperTwo = await create("Helper two");
  const otherLead = await create("Other lead");
  step("agents created", {
    lead: lead.id,
    helperOne: helperOne.id,
    helperTwo: helperTwo.id,
    otherLead: otherLead.id,
  });

  const solo = await createChannel("lead-channel", [lead.id], lead.id);
  const mainTurn = await personMessage(lead.id, `Main work ${hold("main-1")}`);
  await waitFor("the first main turn to run", () => statusOf(lead.id, mainTurn) === "running");
  const older = await teammateNote(helperOne.id, lead.id, `Older teammate note ${hold("older")}`);
  await mention(solo, lead.id, `Channel request ${hold("channel-1")}`);
  const channelTask = await waitFor("the channel task to wait", () => taskOf(solo, lead.id, "channel-1"));
  assert.equal(channelTask.state, "queued", "The channel task waits while the main turn runs.");
  const newer = [await teammateNote(helperOne.id, lead.id, `Newer teammate note ${pass("new-1")}`)];
  newer.push(await teammateNote(helperTwo.id, lead.id, `Newer teammate note ${pass("new-2")}`));
  step("queued behind the main turn", { older, channelTask: channelTask.id, newer });

  release("main-1");
  await waitFor("the older note to run", () => statusOf(lead.id, older) === "running");
  newer.push(await teammateNote(helperOne.id, lead.id, `Newer teammate note ${pass("new-3")}`));
  assert.equal(taskOf(solo, lead.id, "channel-1")?.state, "queued", "The older note runs before the channel task.");
  step("older note runs first", { channelTask: taskOf(solo, lead.id, "channel-1")?.state });

  release("older");
  await waitFor("the channel task to run", () => taskOf(solo, lead.id, "channel-1")?.state === "running");
  await waitFor("the channel turn prompt", () => prompted("channel-1"));
  newer.push(await teammateNote(helperTwo.id, lead.id, `Newer teammate note ${pass("new-4")}`));
  const newerWhileChannelRuns = newer.map((id) => statusOf(lead.id, id) ?? "missing");
  step("channel task runs before newer notes", { newerWhileChannelRuns });
  assert.ok(
    newerWhileChannelRuns.every((status) => status === "queued"),
    "Each main delivery that came after the channel task still waits while the channel task runs.",
  );

  release("channel-1");
  await waitFor("the newer notes to run", () => newer.every((id) => statusOf(lead.id, id) === "completed"));
  const fairPrompts = promptOrder(["main-1", "older", "channel-1", "new-1", "new-2", "new-3", "new-4"]);
  report.fairOrder = {
    prompts: fairPrompts,
    channelStartedWhileNewerQueued: newerWhileChannelRuns,
    olderRanFirst: fairPrompts.indexOf("older") < fairPrompts.indexOf("channel-1"),
  };
  assert.deepEqual(
    fairPrompts.slice(0, 3),
    ["main-1", "older", "channel-1"],
    "The lead runs its main turn, then the older note, then the channel task.",
  );
  assert.ok(
    fairPrompts.indexOf("channel-1") <
      Math.min(...["new-1", "new-2", "new-3", "new-4"].map((m) => fairPrompts.indexOf(m))),
    "The channel task runs before each newer note.",
  );
  step("fair order", fairPrompts);

  const full = await createChannel("full-channel", [lead.id, helperOne.id, helperTwo.id, otherLead.id], otherLead.id);
  await mention(full, helperOne.id, `Helper one work ${hold("helper-1")}`);
  await mention(full, helperTwo.id, `Helper two work ${hold("helper-2")}`);
  await waitFor(
    "both helpers to fill the channel",
    () =>
      taskOf(full, helperOne.id, "helper-1")?.state === "running" &&
      taskOf(full, helperTwo.id, "helper-2")?.state === "running",
  );
  const secondMain = await personMessage(lead.id, `More main work ${hold("main-2")}`);
  await waitFor("the second main turn to run", () => statusOf(lead.id, secondMain) === "running");
  await mention(full, lead.id, `Lead request ${pass("blocked-lead")}`);
  const blocked = await waitFor("the blocked channel task", () => taskOf(full, lead.id, "blocked-lead"));
  const afterBlocked = await teammateNote(
    helperOne.id,
    lead.id,
    `Note after the blocked channel task ${pass("after-blocked")}`,
  );
  release("main-2");
  await waitFor("the note after the blocked task to run", () => statusOf(lead.id, afterBlocked) === "completed");
  const blockedState = taskOf(full, lead.id, "blocked-lead")?.state ?? "missing";
  step("a full channel does not hold the main chat", { blocked: blocked.id, blockedState });
  assert.equal(blockedState, "queued", "The channel task waits for a free channel slot.");

  release("helper-1");
  await waitFor("the blocked task to start when a slot is free", () => {
    const state = taskOf(full, lead.id, "blocked-lead")?.state;
    return state !== undefined && state !== "queued";
  });
  report.channelFull = { mainRan: true, channelTaskState: blockedState, channelStartedAfterSlotFreed: true };
  step("the blocked task starts after a slot is free", taskOf(full, lead.id, "blocked-lead")?.state);

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  step("failed", {
    prompts: entries()
      .filter((entry) => entry.event === "prompt")
      .map((entry) => entry.markers),
  });
  process.exitCode = 1;
} finally {
  for (const marker of markers) release(marker);
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => {});
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
