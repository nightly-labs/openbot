// Checks the context packet that a channel member gets. Runs the real agent service and channel
// service on a temporary profile with a fake Codex app-server that logs the input of each turn.
// Checks:
//   1. The packet gives the assignment first and, when it is short, again at the end (#3630). The
//      task facts in the packet do not give the instruction a second time.
//   2. A delta packet does not give the member its own replies, which its session already has. It
//      does not give the channel rules again, and it gives the channel facts only after they change.
//   3. A task source that the member's cursor passed, but no summary covers, is in the packet (#3557).
//   4. A long channel is summarized after a turn ends, so the next packet does not wait for the
//      model. The summary keeps the newest messages as they are, and a complete packet then has the
//      summary and a transcript in its part of the budget, with no message left out of both (#3905).
//      The summary runs on the provider's smaller model, and the Lead's turns on its own model.
//   5. A reply that continues a task marks its earlier turn superseded and keeps the channel summary,
//      so the next turn does not summarize the channel again from the first message (#3761).
//   6. Two compactions that leave a session at 95% of its window give one notice, and OpenBot asks
//      for no more compactions of that session (#3905).
//   7. A provider that retries a request three times gives one notice, and a session at 60% of its
//      window then compacts before its next turn (#4374).
//   8. A channel_history page stays near 24,000 characters. It cuts a long message, and a read by
//      messageId and offset gives the rest of it. It cuts a long task instruction. A long request is
//      in the packet once, and a long handoff of an agent is cut with a pointer to the rest.
//   9. A session at 60% of its window compacts before a turn whose input fills it over 80% (#4374).
//  10. In an isolated channel, openbot.remember saves a channel memory and the agent keeps none of
//      it. The packet says when isolation is on and when it is off (#4332).
// `bun scripts/channel-context-e2e.ts`. Writes .openbot-build/channel-context-e2e/report.json.
// `CHANNEL_CONTEXT_MEASURE=<label> bun scripts/channel-context-e2e.ts` runs no checks. It sends
// MEASURE_TURNS requests to three members in turn, with long replies, and writes the size of each
// packet and summary request to .openbot-build/channel-context-e2e/measure-<label>.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, type ChannelMessage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { boundedHistoryPage, historyMessagePart } from "../src/backend/channel-history";

type HistoryPage = ReturnType<typeof boundedHistoryPage>;
type HistoryPart = ReturnType<typeof historyMessagePart>;

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-context-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-context-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
// A HOLD turn of the fake stays open until this file exists, so the check can call a channel tool.
// The file stays, so a later turn of the same task ends at once.
const release = join(root, "release");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const PERSON = { id: "local", name: "Alex" };
const PACKET_STARTS = [
  "You have one assignment in a shared OpenBot channel chat.",
  "You have a new assignment in the same shared OpenBot channel chat.",
];
const CHANNEL_RULE = "Use channel_history for earlier history";
const SUMMARY_REQUEST = "Summarize shared facts";
const SUMMARY_TEXT = "Summary: the team discussed the release.";
// The complete packet budget is 120,000 characters, and its transcript part is a quarter of that.
const TRANSCRIPT_CHARACTERS = 30_000;
const MEASURE = process.env.CHANNEL_CONTEXT_MEASURE?.replace(/[^\w-]/g, "") || null;
const MEASURE_TURNS = 30;
// A reply and a summary of about the size that a real member writes.
const MEASURE_REPLY = `Reply: ${"I checked this step and wrote down what is left to do. ".repeat(36)}`;
const MEASURE_SUMMARY = `${SUMMARY_TEXT} ${"The members checked one more step of the plan. ".repeat(85)}`;

/**
 * A Codex app-server with the methods that the service calls. It logs the text input of each turn
 * with its thread, answers a summary request with a short summary, and every other turn with "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const RELEASE = ${JSON.stringify(release)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
let calls = 0;
// The tool calls that wait for the answer of OpenBot, by request id.
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
// Runs each step on its own tick, as a provider sends them one by one.
const run = (steps) => {
  const next = () => {
    const step = steps.shift();
    if (!step) return;
    step();
    setTimeout(next, 20);
  };
  setTimeout(next, 20);
};
const usage = (threadId, turnId, used) => {
  const counts = { totalTokens: used, inputTokens: used, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
  write({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { last: counts, total: counts, modelContextWindow: 100000 } } });
};
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }, { model: "gpt-6-sol", displayName: "GPT-6 Sol" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const threadId = params.threadId;
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      log({ threadId, turnId, text, model: params.model });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      // Only the current assignment selects a behavior: the transcript repeats earlier ones.
      const assignment = (text.match(/Current assignment:\\n([^\\n]*)/) || [])[1] || "";
      const reply = text.includes(${JSON.stringify(SUMMARY_REQUEST)})
        ? ${JSON.stringify(MEASURE ? MEASURE_SUMMARY : SUMMARY_TEXT)}
        : assignment.startsWith("MEASURE") ? ${JSON.stringify(MEASURE_REPLY)} : "Done.";
      const steps = [];
      if (assignment.startsWith("STUCK")) {
        // Codex compacts by itself twice, and each time the session stays at 95% of its window.
        for (let index = 0; index < 2; index++) {
          const item = { type: "contextCompaction", id: "compaction-" + turnId + "-" + index };
          steps.push(() => write({ method: "item/started", params: { threadId, turnId, item } }));
          steps.push(() => write({ method: "item/completed", params: { threadId, turnId, item } }));
          steps.push(() => usage(threadId, turnId, 95000));
        }
      }
      if (assignment.startsWith("USAGE")) steps.push(() => usage(threadId, turnId, 60000));
      if (assignment.startsWith("RETRY")) {
        steps.push(() => usage(threadId, turnId, 60000));
        for (let index = 0; index < 3; index++)
          steps.push(() => write({ method: "error", params: { threadId, turnId, willRetry: true, error: { message: "stream disconnected before completion" } } }));
      }
      const finish = () => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: reply, phase: "final_answer" };
        write({ method: "item/completed", params: { threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      };
      // An agent saves a fact with openbot.remember: first with a memoryId, then without one.
      const call = (args, then) => {
        const id = "tool-" + (++calls);
        waiting.set(id, (response) => {
          log({ threadId, turnId, method: "tool/result", text: JSON.stringify(response.result ?? response.error) });
          then();
        });
        write({ id, method: "item/tool/call", params: { threadId, turnId, callId: "call-" + calls, namespace: "openbot", tool: "remember", arguments: args } });
      };
      if (assignment.startsWith("REMEMBER")) {
        const text = assignment.slice("REMEMBER: ".length);
        steps.push(() => call({ text, memoryId: "memory-1" }, () => call({ text }, finish)));
      } else if (assignment.startsWith("HOLD"))
        steps.push(() => {
          const wait = setInterval(() => {
            if (!existsSync(RELEASE)) return;
            clearInterval(wait);
            finish();
          }, 20);
        });
      else steps.push(finish);
      return run(steps);
    }
    case "thread/compact/start": {
      log({ threadId: params.threadId, method: "thread/compact/start", text: "" });
      write({ id: message.id, result: {} });
      const threadId = params.threadId;
      const turnId = "turn-" + (++turns);
      const item = { type: "contextCompaction", id: "compaction-" + turnId };
      return run([
        () => write({ method: "turn/started", params: { threadId, turn: { id: turnId } } }),
        () => write({ method: "item/started", params: { threadId, turnId, item } }),
        () => write({ method: "item/completed", params: { threadId, turnId, item } }),
        () => write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } }),
        () => usage(threadId, turnId, 10000),
      ]);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (waiting.has(message.id)) {
        const done = waiting.get(message.id);
        waiting.delete(message.id);
        done(message);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface TurnLog {
  threadId: string;
  model?: string;
  turnId?: string;
  method?: string;
  text: string;
}

interface PacketReport {
  agent: string;
  length: number;
  delta: boolean;
  transcriptLength: number;
  omitted: string | null;
}

const report: {
  packets: PacketReport[];
  summary?: {
    before: { version: number; throughSequence: number };
    after: { version: number; throughSequence: number };
  };
  summaryRequests?: { beforeContinue: number; afterContinue: number };
  checks: { name: string; passed: boolean }[];
  notices?: { code: string; message: string }[];
  history?: {
    pageMessages?: number;
    pageCharacters?: number;
    longCharacters?: number;
    handoffPacketCharacters?: number;
  };
  passed: boolean;
  error?: string;
} = { packets: [], checks: [], passed: false };

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
};

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turnLogs(): TurnLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const packets = () => turnLogs().filter((entry) => PACKET_STARTS.some((start) => entry.text.includes(start)));
const compactions = (threadId: string) =>
  turnLogs().filter((entry) => entry.method === "thread/compact/start" && entry.threadId === threadId).length;
const summaryInputs = () => turnLogs().filter((entry) => entry.text.includes(SUMMARY_REQUEST));
const summaryRequests = () => summaryInputs().length;

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

/** The blocks of a packet, which are separated by blank lines. An empty block adds more of them. */
const blocks = (packet: string) => packet.split(/\n{2,}/);

/** The transcript block of a packet: the recent messages of a complete one, or the unread ones of a delta. */
function transcript(packet: string): string {
  const block = blocks(packet).find(
    (entry) => entry.startsWith("Recent shared messages:") || entry.startsWith("Shared messages after"),
  );
  assert.ok(block, "The packet has no transcript block.");
  return block;
}

/** The message rows of one block, parsed. */
function rows(block: string): { id: string; author: { id: string } }[] {
  return block
    .split("\n")
    .slice(1)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

/** The JSON block with the channel and task facts. */
function facts(packet: string): {
  channel?: { instructions: string; isolated?: boolean };
  task?: { id?: string; instruction?: string; expectedResult?: string };
} {
  return JSON.parse(
    blocks(packet).find((entry) => entry.startsWith('{"channel":') || entry.startsWith('{"agentId":')) ?? "{}",
  );
}

function referenced(packet: string): string {
  const block = blocks(packet).find((entry) => entry.startsWith("Referenced messages:"));
  assert.ok(block, "The packet has no referenced messages block.");
  return block;
}

function record(agent: string, packet: string): void {
  const omitted = blocks(packet).find((entry) => entry.includes("are left out to keep this turn small")) ?? null;
  report.packets.push({
    agent,
    length: packet.length,
    delta: packet.includes("Shared messages after the ones you already have"),
    transcriptLength: transcript(packet).length,
    omitted,
  });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
});
const channels = () => agents.channels;
const events: { code: string; agentId?: string; message: string }[] = [];
agents.on("event", (event: AgentEvent) => {
  if (event.type === "error")
    events.push({ code: event.code, message: event.message, ...(event.agentId ? { agentId: event.agentId } : {}) });
});

/** Waits until no task of the channel is open and no member turn runs. */
function settled(channelId: string) {
  return waitFor("the channel tasks to end", () =>
    channels()
      .store.tasks(channelId)
      .every((task) => !["queued", "running", "waiting"].includes(task.state)),
  );
}

/**
 * Sends a person's message to one member and waits for its packet. Without `open`, it also waits
 * for the channel to settle.
 */
async function send(
  channelId: string,
  recipientAgentId: string,
  text: string,
  replyToMessageId: string | null = null,
  open = false,
): Promise<string> {
  const before = packets().length;
  await runCauseEffect(
    channels().command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text,
        recipientAgentId,
        replyToMessageId,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  const packet = await waitFor("the member packet", () => packets()[before]?.text);
  if (!open) await settled(channelId);
  return packet;
}

const messages = (channelId: string): ChannelMessage[] => channels().store.messages(channelId);

const isPage = (value: unknown): value is HistoryPage =>
  typeof value === "object" && value !== null && "messages" in value && "cutMessages" in value;
const isPart = (value: unknown): value is HistoryPart =>
  typeof value === "object" && value !== null && "nextOffset" in value && "text" in value;

try {
  await runCauseEffect(agents.initialize());
  const create = async (name: string, model?: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        ...(model ? { provider: "codex" as const, model } : {}),
        name,
        description: `${name} works in the team channel.`,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
    await waitFor(`the first chat turn of ${name} to end`, () =>
      agents
        .listQueue(agent.id)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
    );
    return agent;
  };
  // The Lead's model costs more than the provider's default model, which the summaries then use.
  const lead = await create("Lead", "gpt-6-sol");
  const tester = await create("Tester");
  const writer = MEASURE ? await create("Writer") : null;
  const channelId = randomUUID();
  const save = (instructions: string, update = true, isolated?: boolean) =>
    runCauseEffect(
      channels().command(
        {
          type: "save",
          operationId: randomUUID(),
          channelId,
          draft: {
            name: "team",
            title: "",
            instructions,
            members: [lead, tester, ...(writer ? [writer] : [])].map((agent) => ({ agentId: agent.id })),
            leadAgentId: lead.id,
            ...(isolated === undefined ? {} : { isolated }),
          },
          ...(update ? { update } : {}),
        },
        PERSON,
      ),
    );
  await save("Ship the release.", false);

  if (MEASURE) {
    const members = [lead, tester, writer ?? lead];
    const turns: { agent: string; threadId: string; characters: number; delta: boolean }[] = [];
    for (let index = 0; index < MEASURE_TURNS; index++) {
      const member = members[index % members.length] ?? lead;
      const packet = await send(
        channelId,
        member.id,
        `MEASURE ${index}: ${"Please check the next part of the release plan and say what is left. ".repeat(4)}`,
      );
      const threadId = packets().find((entry) => entry.text === packet)?.threadId ?? "";
      turns.push({
        agent: member.name,
        threadId,
        characters: packet.length,
        delta: packet.includes("Shared messages after the ones you already have"),
      });
    }
    const summaries = summaryInputs().map((entry) => entry.text.length);
    const sessions = [...new Set(turns.map((turn) => turn.threadId))].map((threadId) => {
      const items = turns.filter((turn) => turn.threadId === threadId);
      return {
        agent: items[0]?.agent,
        turns: items.length,
        packetCharacters: items.reduce((total, turn) => total + turn.characters, 0),
        // The provider session holds each packet and each reply of the member.
        contextCharacters: items.reduce((total, turn) => total + turn.characters + MEASURE_REPLY.length, 0),
      };
    });
    const packetCharacters = turns.reduce((total, turn) => total + turn.characters, 0);
    const summaryCharacters = summaries.reduce((total, length) => total + length, 0);
    const measured = {
      label: MEASURE,
      turns: turns.length,
      replyCharacters: MEASURE_REPLY.length,
      packetCharacters,
      largestPacket: Math.max(...turns.map((turn) => turn.characters)),
      deltaTurns: turns.filter((turn) => turn.delta).length,
      summaryRequests: summaries.length,
      summaryCharacters,
      // About four characters make one token.
      estimatedInputTokens: Math.round((packetCharacters + summaryCharacters) / 4),
      sessions,
      perTurn: turns.map(({ agent, characters, delta }) => ({ agent, characters, delta })),
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `measure-${MEASURE}.json`), `${JSON.stringify(measured, null, 2)}\n`);
    process.stdout.write(`MEASURE ${join(OUT, `measure-${MEASURE}.json`)}\n`);
  } else {
    // 1. The assignment is first, and a short one again at the end.
    const first = await send(channelId, lead.id, "Plan the release checklist.");
    record("Lead", first);
    const firstBlocks = blocks(first);
    pass(
      "The assignment is the second block of the packet",
      firstBlocks[1]?.startsWith("Current assignment:\nPlan the release checklist.") === true,
      firstBlocks[1],
    );
    pass(
      "A short assignment is given again at the end",
      firstBlocks.at(-1)?.startsWith("Current assignment, again:\nPlan the release checklist.") === true,
      firstBlocks.at(-1),
    );
    const firstFacts = facts(first);
    pass(
      "The task facts do not give the instruction again",
      typeof firstFacts.task?.id === "string" &&
        !("instruction" in firstFacts.task) &&
        !("expectedResult" in firstFacts.task),
      JSON.stringify(firstFacts.task),
    );
    pass(
      "The complete packet has the channel rules and facts",
      first.includes(CHANNEL_RULE) && Boolean(firstFacts.channel),
    );

    // 2 and 3. A reply to the first request continues its task: the delta has no own reply, and the
    // first request, which the cursor passed and no summary covers, is a referenced message.
    const request = messages(channelId).find((message) => message.message.text === "Plan the release checklist.");
    assert.ok(request, "The first request is not stored.");
    const reply = await send(channelId, lead.id, "Add the database backup step.", request.id);
    record("Lead", reply);
    pass("The second packet is a delta", reply.includes("Shared messages after the ones you already have"));
    pass(
      "The delta has no reply of the member itself",
      rows(transcript(reply)).every((row) => row.author.id !== lead.id),
      transcript(reply),
    );
    pass(
      "The first request, which the cursor passed, is a referenced message",
      rows(referenced(reply)).some((row) => row.id === request.id),
      referenced(reply),
    );
    pass("The delta does not give the channel rules again", !reply.includes(CHANNEL_RULE));
    pass(
      "The delta has no channel facts while the channel is the same",
      !facts(reply).channel,
      JSON.stringify(facts(reply)),
    );
    // A person changes the instructions in the channel settings. That writes no channel message.
    await save("Ship the release on Friday.");
    const changed = await send(channelId, lead.id, "Check the date.");
    record("Lead", changed);
    pass(
      "The delta after a settings change gives the new channel facts",
      facts(changed).channel?.instructions === "Ship the release on Friday.",
      JSON.stringify(facts(changed)),
    );

    // 4. Grow the history over the start of the summary after a turn, but not over the packet
    // threshold. Only the summary after a turn summarizes it now: no packet is prepared.
    const paragraph = (index: number) => `Note ${index}: ${"the release needs one more check. ".repeat(180)}`;
    const notes: string[] = [];
    for (let index = 0; index < 4; index++) notes.push(await send(channelId, lead.id, paragraph(index)));
    pass(
      "The next delta has no channel facts again",
      notes[0] !== undefined && !facts(notes[0]).channel,
      JSON.stringify(notes[0] && facts(notes[0])),
    );
    const ahead = await waitFor("the summary after a turn", () => {
      const summary = channels().store.summary(channelId);
      return summary.throughSequence > 0 && summary;
    });
    pass("A long channel is summarized after a turn ends", ahead.text === SUMMARY_TEXT);
    const summaryModels = [...new Set(summaryInputs().map((entry) => entry.model))];
    pass(
      "The summary runs on the provider's smaller model",
      summaryModels.length === 1 && summaryModels[0] === "gpt-6-luna",
      JSON.stringify(summaryModels),
    );
    const leadModels = [
      ...new Set(
        packets()
          .filter((entry) => entry.text.includes(`"agentId":"${lead.id}"`))
          .map((entry) => entry.model),
      ),
    ];
    pass(
      "The Lead's turns run on its own model",
      leadModels.length === 1 && leadModels[0] === "gpt-6-sol",
      JSON.stringify(leadModels),
    );
    const aheadInput = summaryInputs().at(-1)?.text ?? "";
    pass("The summary keeps the newest note as it is", !aheadInput.includes("Note 3:"));

    // The Tester has no session in this channel, so its first packet is complete.
    for (let index = 4; index < 6; index++) await send(channelId, lead.id, paragraph(index));
    const complete = await send(channelId, tester.id, "Review the checklist.");
    record("Tester", complete);
    pass("The first packet of a new member is complete", complete.includes("Recent shared messages:"));
    pass("The complete packet has the summary", complete.includes(`Shared history summary (through `));
    pass(
      "No message is left out of both the summary and the transcript",
      !complete.includes("are left out to keep this turn small"),
    );
    const largest = Math.max(...rows(transcript(complete)).map((row) => JSON.stringify(row).length));
    pass(
      "The transcript of the complete packet stays in its part of the budget",
      transcript(complete).length <= TRANSCRIPT_CHARACTERS + largest,
      String(transcript(complete).length),
    );
    pass("The transcript keeps the newest notes", complete.includes("Note 4:") && complete.includes("Note 5:"));
    pass("The new request of the Tester is in the packet", complete.includes("Review the checklist."));

    // 5. Grow the history more, then continue a summarized task.
    for (let index = 8; index < 16; index++) await send(channelId, lead.id, paragraph(index));
    await send(channelId, lead.id, "Summarize where we are.");
    const before = channels().store.summary(channelId);
    pass("The channel has a summary", before.throughSequence > 0 && before.text === SUMMARY_TEXT);
    const summarizedReply = messages(channelId).find(
      (message) =>
        message.author.kind === "agent" &&
        message.author.id === lead.id &&
        message.taskId !== null &&
        !message.superseded &&
        message.sequence <= before.throughSequence,
    );
    assert.ok(summarizedReply, "No reply of the lead is in the summary.");
    const requestsBefore = summaryRequests();
    await send(channelId, lead.id, "Go on with this one.", summarizedReply.id);
    const after = channels().store.summary(channelId);
    report.summary = {
      before: { version: before.version, throughSequence: before.throughSequence },
      after: { version: after.version, throughSequence: after.throughSequence },
    };
    report.summaryRequests = { beforeContinue: requestsBefore, afterContinue: summaryRequests() };
    pass(
      "The continued turn is superseded",
      messages(channelId).some((message) => message.id === summarizedReply.id && message.superseded),
    );
    pass(
      "The summary stays after a summarized turn is superseded",
      after.throughSequence >= before.throughSequence && after.text === SUMMARY_TEXT,
      JSON.stringify(report.summary),
    );
    // A rebuild starts again at the first message, so the model gets the first request again.
    pass(
      "The channel is not summarized again from the first message",
      summaryInputs()
        .slice(requestsBefore)
        .every((entry) => !entry.text.includes(request.id)),
      JSON.stringify(report.summaryRequests),
    );

    // 6. Codex compacts the Tester's session twice in one turn, and the session stays almost full.
    const stuck = await send(channelId, tester.id, "STUCK: check the context of this chat.");
    const stuckThread = packets().find((entry) => entry.text === stuck)?.threadId;
    assert.ok(stuckThread, "The Tester's packet has no thread.");
    const ineffective = await waitFor("the notice about compactions that do not help", () =>
      events.find((event) => event.code === "context_compaction_ineffective" && event.agentId === tester.id),
    );
    pass("The notice gives the share of the window", ineffective.message.includes("95%"), ineffective.message);
    pass("OpenBot asks for no compaction of the full session", compactions(stuckThread) === 0);

    // 7. Codex retries a request of the Lead three times while its session is at 60% of the window.
    const retried = await send(channelId, lead.id, "RETRY: run the release check.");
    const retryThread = packets().find((entry) => entry.text === retried)?.threadId;
    assert.ok(retryThread, "The Lead's packet has no thread.");
    const retrying = events.filter(
      (event) => event.code === "agent_warning" && event.agentId === lead.id && event.message.includes("3 times"),
    );
    pass("A request that the provider retries three times gives one notice", retrying.length === 1);
    pass(
      "The notice gives the share of the window",
      retrying[0]?.message.includes("60%") === true,
      retrying[0]?.message,
    );
    await waitFor("the compaction after the retries", () => compactions(retryThread) > 0);
    pass("The session compacts after a turn that the provider retried", compactions(retryThread) === 1);

    // 8. A person posts a message longer than one history part. The Tester then reads the history
    // during an open turn.
    const long = `Long log start. ${"The release log has one more line. ".repeat(1_200)}Long log end.`;
    const longPacket = await send(channelId, lead.id, long);
    pass(
      "The packet gives a long request once",
      longPacket.split("Long log start.").length === 2 &&
        longPacket.includes('[the text under \\"Current assignment\\"]'),
      String(longPacket.length),
    );
    const longMessage = messages(channelId).find((message) => message.message.text === long);
    assert.ok(longMessage, "The long message is not stored.");
    await send(channelId, tester.id, "HOLD: read the history.", null, true);
    const assignment = await waitFor("the open turn of the Tester", () =>
      channels()
        .store.assignments(channelId)
        .find(
          (item) =>
            item.agentId === tester.id &&
            item.turnId &&
            channels()
              .store.tasks(channelId)
              .some((task) => task.id === item.taskId && task.state === "running"),
        ),
    );
    const turnId = assignment.turnId ?? "";
    const history = (args: Record<string, string | number>) =>
      runCauseEffect(channels().tool(channelId, tester.id, turnId, randomUUID(), "channel_history", args));
    const page = await history({});
    assert.ok(isPage(page), "channel_history gave no page.");
    const pageSize = page.messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
    report.history = { pageMessages: page.messages.length, pageCharacters: pageSize, longCharacters: long.length };
    pass("A history page stays in its budget", pageSize <= 24_000, String(pageSize));
    pass(
      "The page cuts the long message and names it",
      page.cutMessages.some((item) => item.messageId === longMessage.id && item.totalCharacters === long.length) &&
        page.messages.some((message) => message.id === longMessage.id && message.message.text.length < long.length),
      JSON.stringify(page.cutMessages),
    );
    pass(
      "The page gives a cursor to the older messages",
      page.olderCursor !== null && page.olderCursor === page.messages[0]?.sequence,
      String(page.olderCursor),
    );
    pass(
      "The page gives only the tasks that its messages name",
      page.tasks.every((task) => page.messages.some((message) => message.taskId === task.id)),
    );
    const longTask = channels()
      .store.tasks(channelId)
      .find((task) => task.instruction === long);
    const pageTask = page.tasks.find((task) => task.id === longTask?.id);
    pass(
      "The page cuts the long instruction of a task",
      pageTask !== undefined &&
        page.tasks.every((task) => task.instruction.length <= 2_001 && task.expectedResult.length <= 2_001),
      String(pageTask?.instruction.length),
    );
    const older = await history({ beforeSequence: page.olderCursor ?? 0 });
    assert.ok(isPage(older), "channel_history gave no older page.");
    pass(
      "The older page continues before the first page",
      older.messages.length > 0 && older.messages.every((message) => message.sequence < (page.olderCursor ?? 0)),
    );
    let text = "";
    let offset: number | null = 0;
    let parts = 0;
    while (offset !== null && parts < 10) {
      const part = await history({ messageId: longMessage.id, offset });
      assert.ok(isPart(part), "channel_history gave no message part.");
      text += part.text;
      offset = part.nextOffset;
      parts++;
    }
    pass(
      "A read by messageId gives the long message in parts",
      parts === Math.ceil(long.length / 16_000) && text === long,
    );
    // The Tester hands a pasted log to the Lead. The Lead's packet cuts it, and points to the rest.
    const handoffText = `Handoff log start. ${"One more line of the pasted log. ".repeat(900)}Handoff log end.`;
    const holdRequest = messages(channelId).find((message) => message.message.text === "HOLD: read the history.");
    assert.ok(holdRequest, "The HOLD request is not stored.");
    const beforeHandoff = packets().length;
    await runCauseEffect(
      channels().tool(channelId, tester.id, turnId, randomUUID(), "channel_assign", {
        recipientAgentId: lead.id,
        task: handoffText,
        expectedResult: "A short result.",
        sourceMessageIds: [holdRequest.id],
      }),
    );
    const handoffPacket = await waitFor(
      "the packet of the handoff",
      () =>
        packets()
          .slice(beforeHandoff)
          .find((entry) => entry.text.includes("Handoff log start."))?.text,
    );
    const pointer = handoffPacket.match(/channel_history with messageId "([^"]+)" and offset (\d+)/);
    report.history = { ...report.history, handoffPacketCharacters: handoffPacket.length };
    pass(
      "The packet cuts a long handoff of an agent once",
      pointer !== null &&
        handoffPacket.split("Handoff log start.").length === 2 &&
        handoffPacket.length < handoffText.length,
      String(handoffPacket.length),
    );
    const rest = await history({ messageId: pointer?.[1] ?? "", offset: Number(pointer?.[2]) });
    assert.ok(isPart(rest), "channel_history gave no handoff part.");
    pass(
      "The pointer reads the part of the handoff that the packet left out",
      rest.text.startsWith(handoffText.slice(18_000, 18_100)),
      rest.text.slice(0, 80),
    );
    writeFileSync(release, "");
    await settled(channelId);

    // 9. The Lead's session is at 60% of its window. A short message does not compact it, and a
    // message of about 22,000 tokens compacts it before its turn.
    const usageThread = retryThread;
    await send(channelId, lead.id, "USAGE: report the size.");
    const atSixty = compactions(usageThread);
    await send(channelId, lead.id, "Say one word.");
    pass("A short message does not compact a session at 60%", compactions(usageThread) === atSixty);
    await send(channelId, lead.id, "USAGE: report the size again.");
    const beforeLarge = compactions(usageThread);
    const large = `Large paste start. ${"A pasted line of a large log file. ".repeat(2_550)}`;
    const largePacket = await send(channelId, lead.id, large);
    const order = turnLogs().filter((entry) => entry.threadId === usageThread);
    const packetIndex = order.findIndex((entry) => entry.text === largePacket);
    pass(
      "A session compacts before a turn whose input fills it",
      compactions(usageThread) === beforeLarge + 1 &&
        order.slice(0, packetIndex).filter((entry) => entry.method === "thread/compact/start").length ===
          beforeLarge + 1,
      `${beforeLarge} -> ${compactions(usageThread)}, ${large.length} characters`,
    );

    // 10. #4332: in an isolated channel, openbot.remember saves a channel memory, and the agent keeps
    // none of it. A save without the field, as from a client before it, keeps the channel isolated.
    await save("Ship the release.", true, true);
    await save("Ship the release.");
    pass("A save without isolated keeps the channel isolated", channels().store.get(channelId).isolated === true);
    const fact = "The release branch is release-7.";
    const agentMemories = agents.listMemories(tester.id).length;
    const isolatedPacket = await send(channelId, tester.id, `REMEMBER: ${fact}`);
    pass(
      "The packet says that the channel is isolated",
      facts(isolatedPacket).channel?.isolated === true &&
        isolatedPacket.includes("openbot.remember saves a channel memory here"),
    );
    const results = turnLogs()
      .filter((entry) => entry.method === "tool/result")
      .map((entry) => entry.text);
    pass(
      "remember cannot change an own memory from an isolated channel",
      results[0]?.includes("cannot change your own memories") === true,
      results[0],
    );
    pass(
      "remember saves a channel memory in an isolated channel",
      results[1]?.includes("channel memory") === true &&
        channels()
          .memories.list(channelId)
          .some((memory) => memory.text === fact),
      results[1],
    );
    pass(
      "The agent keeps no memory from the isolated channel",
      agents.listMemories(tester.id).length === agentMemories &&
        !agents.listMemories(tester.id).some((memory) => memory.text === fact),
    );
    await save("Ship the release.", true, false);
    const sharedPacket = await send(channelId, tester.id, "Say one word.");
    pass(
      "The packet says when isolation is off",
      facts(sharedPacket).channel?.isolated === undefined &&
        sharedPacket.includes("no longer isolated") &&
        !sharedPacket.includes("openbot.remember saves a channel memory here"),
    );
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  report.notices = events.map(({ code, message }) => ({ code, message }));
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  if (!MEASURE) writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  if (!MEASURE) process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
