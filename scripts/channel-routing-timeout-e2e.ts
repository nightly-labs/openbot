import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ChannelOperationError } from "../src/backend/channel-effects";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-routing-timeout-e2e");
const PERSON = { id: "member-e2e", name: "Owner" };
const WAIT_MS = 5_000;

interface Report {
  routingCalls: number;
  task?: { ownerAgentId: string | null; state: string; error: string | null };
  leadAssigned?: boolean;
  coordinatorMessages?: string[];
  passed: boolean;
  failure?: string;
}
const report: Report = { routingCalls: 0, passed: false };

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

const directory = await mkdtemp(join(tmpdir(), "openbot-channel-routing-timeout-"));
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
  const service = new ChannelService(
    database,
    new MailboxStore(directory, join(directory, "shared"), database),
    new ChannelImages(join(directory, "channel-images")),
    {
      agents: () => agents,
      generate: () =>
        Effect.suspend(() => {
          report.routingCalls += 1;
          return Effect.fail(
            new ChannelOperationError({ cause: new Error(sourceText("error.agent.profileTimedOut")) }),
          );
        }),
      schedule: () => {},
      interrupt: () => Effect.void,
      busy: () => false,
      changed: () => {},
      error: (error) => {
        throw error;
      },
    },
  );
  channels = service;
  const channelId = randomUUID();
  await runCauseEffect(
    service.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Team",
          title: "Introduce the team",
          instructions: "",
          members: agents.map((item) => ({ agentId: item.id })),
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );
  await runCauseEffect(
    service.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: "Why are the replies so slow?",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  const task = await until(
    () =>
      service.store
        .tasks(channelId)
        .find((item) => item.parentTaskId === null && (item.ownerAgentId !== null || item.state === "paused")),
    "the routed or stopped request",
  );
  report.task = { ownerAgentId: task.ownerAgentId, state: task.state, error: task.error };
  report.leadAssigned = service.store
    .assignments(channelId)
    .some((assignment) => assignment.taskId === task.id && assignment.agentId === lead.id);
  report.coordinatorMessages = service.store
    .messages(channelId)
    .filter((entry) => entry.author.kind === "coordinator")
    .map((entry) => entry.message.text);
  assert.equal(report.routingCalls, 1, "The routing turn did not run once.");
  assert.notEqual(task.state, "paused", "A routing timeout stopped the request.");
  assert.equal(task.ownerAgentId, lead.id, "The lead did not take the request after a routing timeout.");
  assert.equal(task.error, null);
  assert.ok(report.leadAssigned, "The lead got no assignment.");
  assert.deepEqual(report.coordinatorMessages, []);
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
