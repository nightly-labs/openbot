import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ChannelTask, ChannelTaskState } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { deliveryPromptInput } from "../src/backend/agent/delivery-content";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelRequestReturns } from "../src/backend/channel-request-returns";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-request-self-return-e2e");
const PERSON = { id: "member-e2e", name: "Owner" };
const WAIT_MS = 5_000;
const RETURN_MARK = "This answers your openbot.send_to_channel request.";

interface CaseReport {
  name: string;
  ownerAgentId: string | null;
  state: ChannelTaskState;
  returned: number;
  text?: string;
}

interface Report {
  cases: CaseReport[];
  chatCards?: { incoming: number; outgoing: number };
  promptFraming?: { channelResult: boolean; startTask: boolean };
  otherMemberReturned?: number;
  requeuedAfterRestart?: boolean;
  passed: boolean;
  failure?: string;
}
const report: Report = { cases: [], passed: false };

const agent = (id: string, name: string): AgentSummary => ({
  id,
  name,
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});
const lead = agent("agent-lead", "Lead");
const writer = agent("agent-writer", "Writer");
const agents = [lead, writer];

const directory = await mkdtemp(join(tmpdir(), "openbot-channel-self-return-"));
const database = new OpenBotDatabase(directory);
let channels: ChannelService | null = null;

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await new Promise((done) => setImmediate(done));
  }
}

try {
  await Effect.runPromise(database.initialize());
  const mailbox = new MailboxStore(directory, join(directory, "shared"), database);
  const service = new ChannelService(database, mailbox, new ChannelImages(join(directory, "channel-images")), {
    agents: () => agents,
    generate: () => Effect.never,
    schedule: () => {},
    interrupt: () => Effect.void,
    busy: () => false,
    changed: () => {},
    error: (error) => {
      throw error;
    },
  });
  channels = service;
  const returns = new ChannelRequestReturns(service, mailbox, {
    agentExists: (agentId) => agents.some((item) => item.id === agentId),
    delivered: () => Effect.void,
    error: (error) => {
      throw error;
    },
  });
  const channelId = randomUUID();
  await runCauseEffect(
    service.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Team",
          title: "Self return",
          instructions: "",
          members: agents.map((item) => ({ agentId: item.id })),
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );
  returns.restore();

  const returnsTo = (agentId: string) =>
    mailbox
      .listQueue(agentId)
      .deliveries.filter((delivery) => delivery.replyToMessageId !== null && delivery.text.includes(RETURN_MARK));

  const finish = async (
    name: string,
    requester: AgentSummary,
    recipientAgentIds: string[],
    ownerAgentId: string | null,
    state: ChannelTaskState,
  ): Promise<CaseReport> => {
    const before = returnsTo(requester.id).length;
    const text = `E2E request ${name}`;
    await runCauseEffect(
      service.handoff({
        operationId: randomUUID(),
        channelId,
        senderAgentId: requester.id,
        text,
        recipientAgentIds,
        sourcePaths: [],
      }),
    );
    const task: ChannelTask = await until(
      () => service.store.tasks(channelId).find((item) => item.parentTaskId === null && item.instruction === text),
      `the task of ${name}`,
    );
    const current = service.store.tasks(channelId).find((item) => item.id === task.id) ?? task;
    service.store.update(service.store.get(channelId), {
      tasks: [
        {
          ...current,
          ownerAgentId,
          state,
          revision: current.revision + 1,
          error: state === "completed" ? null : "E2E stop",
        },
      ],
    });
    await Effect.runPromise(returns.reconcile(channelId));
    const added = returnsTo(requester.id).slice(before);
    const entry: CaseReport = {
      name,
      ownerAgentId,
      state,
      returned: added.length,
      ...(added[0] ? { text: added[0].text } : {}),
    };
    report.cases.push(entry);
    return entry;
  };

  const self = await finish("lead names itself, completed", lead, [lead.id], lead.id, "completed");
  assert.equal(self.returned, 1, "A completed task that the requester did itself sent no result.");
  const failed = await finish("lead names itself, failed", lead, [lead.id], lead.id, "failed");
  assert.equal(failed.returned, 1, "A failed task that the requester did itself sent no note.");
  assert.match(failed.text ?? "", /Status: blocked/);
  const paused = await finish("lead names itself, paused", lead, [lead.id], lead.id, "paused");
  assert.equal(paused.returned, 1, "A paused task that the requester did itself sent no note.");
  assert.match(paused.text ?? "", /Status: paused/);
  const unowned = await finish("lead with no owner, completed", lead, [], null, "completed");
  assert.equal(unowned.returned, 1, "A lead request that ended with no owner sent no result.");
  const other = await finish("writer does the lead's request", lead, [writer.id], writer.id, "completed");
  report.otherMemberReturned = other.returned;
  assert.equal(other.returned, 1, "A result from another member stopped coming back.");

  const cards = mailbox
    .conversationMessages(lead.id)
    .filter((message) => message.exchange && message.text.includes(RETURN_MARK));
  report.chatCards = {
    incoming: cards.filter((message) => message.exchange?.direction === "incoming").length,
    outgoing: cards.filter((message) => message.exchange?.direction === "outgoing").length,
  };
  assert.equal(report.chatCards.incoming, 5, "Each returned result needs one card in the chat that asked.");
  assert.equal(report.chatCards.outgoing, 0, "A result that the agent sent to itself also showed as a sent message.");

  const selfDelivery = returnsTo(lead.id).find(
    (delivery) => delivery.sender.kind === "agent" && delivery.sender.agentId === lead.id,
  );
  assert.ok(selfDelivery, "No self-sent result is queued.");
  const prompt = deliveryPromptInput(
    { delivery: selfDelivery, managedAttachments: [] },
    {
      agentNames: new Map(agents.map((item) => [item.id, item.name])),
      snapshot: { agentId: lead.id, threadId: null, activeTurnId: null, revision: 0, messages: [] },
      routineRun: null,
    },
  )
    .map((item) => ("text" in item ? item.text : ""))
    .join("\n");
  report.promptFraming = {
    channelResult: prompt.includes("You did that channel work yourself"),
    startTask: prompt.includes("openbot.start_task"),
  };
  assert.ok(report.promptFraming.channelResult, "The self-sent result is not framed as a channel result.");
  assert.ok(!report.promptFraming.startTask, "The self-sent result is framed as a start_task brief.");
  await Effect.runPromise(mailbox.markStarting(selfDelivery.id));
  report.requeuedAfterRestart = await Effect.runPromise(mailbox.requeueAfterRestart(selfDelivery.id, false));
  assert.ok(report.requeuedAfterRestart, "A restart dropped the self-sent result instead of queuing it again.");
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (channels) await Effect.runPromise(channels.stop());
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
