// A channel request that already names an agent-bridge reply must not stop for Coordinator.
// The lead's routing model is a stub. It returns the questions from the report. The check uses the
// real ChannelService and the real member packet.
// bun scripts/channel-bridge-routing-e2e.ts
// Writes .openbot-build/channel-bridge-routing-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ChannelHistory } from "../src/backend/channel-history";
import {
  bridgeReplySpecified,
  CHANNEL_ASSIGNMENT_BRIDGE_RULE,
  CHANNEL_ROUTING_BRIDGE_RULE,
  routingQuestionSuperseded,
} from "../src/backend/channel-routing";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-bridge-routing-e2e");
const BRIDGE = "Reply on agent-bridge MCP.\nfrom=openbot\nto=grok-tunner\nbody=RESULT-DIG the freeze comparison.";
const AGENT_MCP_QUESTION =
  "What should be sent, and which channel member is agent-Mcp? No member with that name is listed.";
const SEND_QUESTION = "What should be sent, and to whom?";
const PLAIN = "Summarize the notes from yesterday.";

const root = await mkdtemp(join(tmpdir(), "openbot-channel-bridge-routing-"));
const database = new OpenBotDatabase(root);
const mailbox = new MailboxStore(root, join(root, "shared"), database);

const agent = (id: string, name: string): AgentSummary => ({
  id,
  name,
  title: "Engineer",
  description: "Does the requested work.",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: root,
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});
const lead = agent("lead", "Codex Engineering");
const worker = agent("worker", "Research");
const images = new ChannelImages(join(root, "avatars", "channels"));
const prompts: string[] = [];

const channels = new ChannelService(database, mailbox, images, {
  agents: () => [lead, worker],
  // One answer per send, in order: the bridge question, the plain question, then a member choice.
  generate: (_agent, prompt, _fallbacks, _background) => {
    prompts.push(prompt);
    const answer =
      prompts.length === 1
        ? { question: AGENT_MCP_QUESTION }
        : prompts.length === 2
          ? { question: SEND_QUESTION }
          : { agentIds: [worker.id] };
    return Effect.succeed(JSON.stringify(answer));
  },
  schedule: () => undefined,
  interrupt: () => Effect.void,
  // The owner is busy, so routing can finish without a provider turn.
  busy: () => true,
  changed: () => undefined,
  error: (error) => {
    throw error;
  },
});

interface TaskReport {
  ownerAgentId: string | null;
  state: string;
  error: string | null;
  coordinator: string | null;
}

const report: {
  passed: boolean;
  bridge: TaskReport | null;
  plain: TaskReport | null;
  assigned: TaskReport | null;
  packetHasRule: boolean;
  promptHasRule: boolean;
} = {
  passed: false,
  bridge: null,
  plain: null,
  assigned: null,
  packetHasRule: false,
  promptHasRule: false,
};

const actor = { id: "local", name: "Alex" };

function taskByText(text: string): ChannelTask | undefined {
  return channels.store.tasks(channelId).find((task) => task.instruction.startsWith(text.slice(0, 24)));
}

function reportOf(task: ChannelTask): TaskReport {
  const note = channels.store
    .messages(channelId)
    .find((message) => message.taskId === task.id && message.author.kind === "coordinator");
  return {
    ownerAgentId: task.ownerAgentId,
    state: task.state,
    error: task.error,
    coordinator: note?.message.text ?? null,
  };
}

async function until(label: string, ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out: ${label}`);
}

let channelId = "";

try {
  assert.equal(
    routingQuestionSuperseded(AGENT_MCP_QUESTION, BRIDGE),
    true,
    "The agent-Mcp question must not stop a named bridge reply.",
  );
  assert.equal(
    routingQuestionSuperseded(SEND_QUESTION, BRIDGE),
    true,
    "A from and to reply must not stop to ask what to send.",
  );
  assert.equal(
    routingQuestionSuperseded(AGENT_MCP_QUESTION, "Use the MCP bridge and post the result."),
    true,
    "A question that names agent-Mcp must not stop bridge work.",
  );
  assert.equal(routingQuestionSuperseded(SEND_QUESTION, PLAIN), false, "A normal request can still ask.");
  assert.equal(
    routingQuestionSuperseded("Which design do you want?", BRIDGE),
    false,
    "A real choice still waits for a person.",
  );
  assert.equal(bridgeReplySpecified("from the office to the client via the bridge"), false);
  assert.equal(bridgeReplySpecified(BRIDGE), true);

  await Effect.runPromise(database.initialize());
  await runCauseEffect(mailbox.initialize());
  channelId = randomUUID();
  await runCauseEffect(
    channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Codex Engineering",
          title: "Codex Engineering",
          instructions: "",
          members: [{ agentId: lead.id }, { agentId: worker.id }],
          leadAgentId: lead.id,
        },
      },
      actor,
    ),
  );

  const send = (text: string) =>
    runCauseEffect(
      channels.command(
        {
          type: "send",
          operationId: randomUUID(),
          channelId,
          text,
          recipientAgentId: null,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );

  await send(BRIDGE);
  await until("the bridge request has an owner", () => taskByText(BRIDGE)?.ownerAgentId != null);
  const bridgeTask = taskByText(BRIDGE);
  assert.ok(bridgeTask);
  report.bridge = reportOf(bridgeTask);
  assert.equal(bridgeTask.ownerAgentId, lead.id);
  assert.equal(bridgeTask.state, "queued");
  assert.equal(bridgeTask.error, null);
  assert.equal(report.bridge.coordinator, null);

  await send(PLAIN);
  await until("the plain request stops", () => taskByText(PLAIN)?.state === "paused");
  const plainTask = taskByText(PLAIN);
  assert.ok(plainTask);
  report.plain = reportOf(plainTask);
  assert.equal(plainTask.ownerAgentId, null);
  assert.equal(plainTask.error, SEND_QUESTION);
  assert.equal(report.plain.coordinator, SEND_QUESTION);

  await send(`BRIDGE-ASSIGN ${BRIDGE}`);
  await until("the model assignment has an owner", () => taskByText("BRIDGE-ASSIGN")?.ownerAgentId != null);
  const assigned = taskByText("BRIDGE-ASSIGN");
  assert.ok(assigned);
  report.assigned = reportOf(assigned);
  assert.equal(assigned.ownerAgentId, worker.id, "A real member choice stays.");
  assert.equal(assigned.error, null);

  report.promptHasRule = prompts.some((prompt) => prompt.includes(CHANNEL_ROUTING_BRIDGE_RULE));
  assert.equal(report.promptHasRule, true);

  const history = new ChannelHistory(
    channels.store,
    () => Effect.die("The packet check does not summarize."),
    channels.memories,
  );
  const packet = await Effect.runPromise(history.prepare(bridgeTask, lead, lead, null, []));
  report.packetHasRule = packet.text.includes(CHANNEL_ASSIGNMENT_BRIDGE_RULE) && packet.text.includes("from=openbot");
  assert.equal(report.packetHasRule, true);

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await runCauseEffect(channels.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
}

if (!report.passed) process.exit(1);
