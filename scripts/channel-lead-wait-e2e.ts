import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ChannelMessage, type ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { HostMemory } from "../src/backend/host-memory";
import { xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-lead-wait-e2e");
const FAKE_AGENT = resolve(import.meta.dirname, "provider-fakes/agents/channel-lead.ts");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-lead-wait-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const releaseDir = join(root, "release");
const fakeLog = join(root, "fake.jsonl");
const PERSON = { id: "local", name: "Alex" };
const BACKLOG_MESSAGES = 45;
const BACKLOG_CHARACTERS = 3_000;

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
  event: "prompt" | "summary" | "done";
  at: number;
  sessionId: string;
  markers?: string[];
  leftOut?: boolean;
}

interface Report {
  steps: Array<{ name: string; detail?: unknown }>;
  leadSlot?: {
    leadRanBesideTwoMembers: boolean;
    memberWait: string[];
    leadWait: string[];
    memberKeptOutOfLeadSlot: boolean;
    leadSecondTaskWaited: boolean;
  };
  summaryWait?: { summaryHeld: boolean; leadStartMs: number; leftOutNote: boolean };
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
const promptOf = (marker: string) =>
  entries().find((entry) => entry.event === "prompt" && entry.markers?.includes(marker) === true);

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

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
const taskOf = (channelId: string, ownerAgentId: string, marker: string): ChannelTask | undefined =>
  agents.channels.store
    .tasks(channelId)
    .find((task) => task.ownerAgentId === ownerAgentId && task.instruction.includes(marker));
const stateOf = (channelId: string, ownerAgentId: string, marker: string) =>
  taskOf(channelId, ownerAgentId, marker)?.state ?? "missing";
const waitsOf = (channelId: string, agentId: string) =>
  (agents.channels.page(channelId).waits ?? []).filter((wait) => wait.agentId === agentId).map((wait) => wait.reason);

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

function seedBacklog(channelId: string): void {
  const filler = "The river report lists water levels, bridges and boats along the coast. ".repeat(
    Math.ceil(BACKLOG_CHARACTERS / 72),
  );
  const messages: ChannelMessage[] = Array.from({ length: BACKLOG_MESSAGES }, (_, index) => {
    const id = randomUUID();
    return {
      id,
      channelId,
      taskId: null,
      author: { kind: "member", id: PERSON.id, name: PERSON.name },
      sequence: 0,
      superseded: false,
      message: {
        id,
        text: `Note ${index + 1}. ${filler.slice(0, BACKLOG_CHARACTERS)}`,
        author: "user",
        createdAt: new Date().toISOString(),
        status: "completed",
      },
    };
  });
  agents.channels.store.update(agents.channels.store.get(channelId), { messages });
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
        { name: "FAKE_HOLD_SUMMARY", value: "1" },
      ],
      usagePrompt: null,
    }),
  );
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} for the channel lead check.`,
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
  const one = await create("Member one");
  const two = await create("Member two");
  const three = await create("Member three");
  step("agents created", { lead: lead.id, one: one.id, two: two.id, three: three.id });

  const slot = await createChannel("slot-channel", [lead.id, one.id, two.id, three.id], lead.id);
  await mention(slot, one.id, `Member one work ${hold("one")}`);
  await mention(slot, two.id, `Member two work ${hold("two")}`);
  await waitFor(
    "two member tasks to fill the member slots",
    () => stateOf(slot, one.id, "one") === "running" && stateOf(slot, two.id, "two") === "running",
  );
  await mention(slot, three.id, `Member three work ${pass("three")}`);
  await waitFor("the third member task to wait", () => waitsOf(slot, three.id).includes("channel-full"));
  await mention(slot, lead.id, `Lead answer ${hold("lead-1")}`);
  await waitFor("the lead task to run beside two member tasks", () => stateOf(slot, lead.id, "lead-1") === "running");
  await waitFor("the lead turn prompt", () => promptOf("lead-1"));
  await mention(slot, lead.id, `Second lead answer ${pass("lead-2")}`);
  await waitFor("the second lead task", () => taskOf(slot, lead.id, "lead-2"));
  await pause(500);
  const memberWait = waitsOf(slot, three.id);
  const leadWait = waitsOf(slot, lead.id);
  const during = {
    one: stateOf(slot, one.id, "one"),
    two: stateOf(slot, two.id, "two"),
    three: stateOf(slot, three.id, "three"),
    lead1: stateOf(slot, lead.id, "lead-1"),
    lead2: stateOf(slot, lead.id, "lead-2"),
  };
  step("lead runs in its own slot", { during, memberWait, leadWait });
  assert.equal(during.one, "running", "The first member task still runs.");
  assert.equal(during.two, "running", "The second member task still runs.");
  assert.equal(during.three, "queued", "A third member task does not use the lead slot.");
  assert.deepEqual(memberWait, ["channel-full"], "The third member shows the channel-full wait.");
  assert.deepEqual(leadWait, [], "The lead shows no channel-full wait.");
  assert.equal(during.lead2, "queued", "The lead still runs one assignment at a time in the channel.");

  release("lead-1");
  await waitFor("the second lead task to run after the first", () => promptOf("lead-2"));
  assert.equal(stateOf(slot, three.id, "three"), "queued", "The member task waits while the members are full.");
  release("one");
  await waitFor("the third member task to start when a member slot is free", () => promptOf("three"));
  report.leadSlot = {
    leadRanBesideTwoMembers: true,
    memberWait,
    leadWait,
    memberKeptOutOfLeadSlot: true,
    leadSecondTaskWaited: true,
  };
  release("two");
  await waitFor("the slot channel to settle", () =>
    agents.channels.store.tasks(slot).every((task) => !["queued", "running"].includes(task.state)),
  );

  const long = await createChannel("long-channel", [lead.id, one.id], lead.id);
  await mention(long, one.id, `Member work ${hold("long-one")}`);
  await waitFor("the member turn in the long channel", () => promptOf("long-one"));
  seedBacklog(long);
  release("long-one");
  await waitFor(
    "the background summary to start and wait",
    () => entries().some((entry) => entry.event === "summary"),
    60_000,
  );
  step("background summary holds", {
    summaries: entries().filter((entry) => entry.event === "summary").length,
  });
  const askedAt = Date.now();
  await mention(long, lead.id, `Lead answer in the long channel ${pass("long-lead")}`);
  const leadPrompt = await waitFor(
    "the lead turn to start while the summary still runs",
    () => promptOf("long-lead"),
    90_000,
  );
  const summaryHeld = !existsSync(join(releaseDir, "summary"));
  report.summaryWait = {
    summaryHeld,
    leadStartMs: leadPrompt.at - askedAt,
    leftOutNote: leadPrompt.leftOut === true,
  };
  step("lead turn starts during the summary", report.summaryWait);
  assert.ok(summaryHeld, "The summary was still running when the lead turn started.");
  assert.ok(leadPrompt.leftOut, "The lead packet tells which older messages it left out.");

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  step("failed", {
    prompts: entries().map((entry) => [entry.event, ...(entry.markers ?? [])].join(":")),
  });
  process.exitCode = 1;
} finally {
  for (const marker of [...markers, "summary"]) release(marker);
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => {});
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
