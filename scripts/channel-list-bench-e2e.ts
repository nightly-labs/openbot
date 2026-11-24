import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const CHANNEL_COUNT = 64;
const MESSAGE_COUNT = 500;
const TASK_COUNT = 12;
const RUNS = 7;
const MEMBER_ID = "member-bench";
const SHOWN_MESSAGE_SQL =
  "(instr(message_json, '\"deleted\"') = 0 OR json_extract(message_json, '$.deleted') IS NOT 1)";
const outputPath = resolve(".openbot-build", "channel-list-bench.json");

function channel(id: string) {
  return {
    id,
    name: `Channel ${id}`,
    title: `Channel ${id}`,
    instructions: "",
    members: [{ agentId: "agent-1" }, { agentId: "agent-2" }, { agentId: "agent-3" }],
    leadAgentId: "agent-1",
    archived: false,
    revision: 0,
    createdAt: "2026-11-23T00:00:00.000Z",
  };
}

function message(channelId: string, sequence: number) {
  const itemType = sequence % 17 === 0 ? "plan" : sequence % 19 === 0 ? "commentary" : undefined;
  return {
    id: `${channelId}-message-${sequence}`,
    channelId,
    sequence,
    author: { kind: "agent", id: "agent-1", name: "Agent 1" },
    taskId: null,
    superseded: false,
    ...(sequence % 23 === 0 ? { deleted: true } : {}),
    message: {
      id: `${channelId}-message-${sequence}`,
      author: "assistant",
      text: `Message ${sequence}`,
      status: "completed",
      createdAt: `2026-11-23T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
      ...(itemType ? { itemType } : {}),
    },
  };
}

function task(channelId: string, index: number) {
  const state = ["queued", "waiting", "running", "completed"][index % 4];
  return {
    id: `${channelId}-task-${index}`,
    channelId,
    parentTaskId: null,
    rootTaskId: `${channelId}-task-${index}`,
    ownerAgentId: "agent-1",
    requestMessageId: `${channelId}-message-1`,
    instruction: "Run the task.",
    attachmentDraftIds: [],
    expectedResult: "",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state,
    revision: 0,
    assignmentCount: 0,
    error: null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timed(run: () => void): number {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-channel-list-bench-"));
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  try {
    const connection = database.connection;
    const insertChannel = connection.prepare("INSERT INTO projection_channels VALUES (?, ?)");
    const insertMessage = connection.prepare("INSERT INTO projection_channel_messages VALUES (?, ?, ?, ?)");
    const insertTask = connection.prepare("INSERT INTO projection_channel_tasks VALUES (?, ?, ?)");
    const insertRead = connection.prepare("INSERT INTO projection_channel_reads VALUES (?, ?, ?)");
    for (let channelIndex = 0; channelIndex < CHANNEL_COUNT; channelIndex += 1) {
      const channelId = `channel-${channelIndex}`;
      insertChannel.run(channelId, JSON.stringify(channel(channelId)));
      insertRead.run(channelId, MEMBER_ID, MESSAGE_COUNT - 100);
      for (let sequence = 1; sequence <= MESSAGE_COUNT; sequence += 1) {
        const entry = message(channelId, sequence);
        insertMessage.run(channelId, entry.id, sequence, JSON.stringify(entry));
      }
      for (let taskIndex = 0; taskIndex < TASK_COUNT; taskIndex += 1) {
        const entry = task(channelId, taskIndex);
        insertTask.run(entry.id, channelId, JSON.stringify(entry));
      }
    }
    const cold = Array.from({ length: RUNS }, () => timed(() => new ChannelStore(database).list(MEMBER_ID)));
    const channels = new ChannelStore(database);
    const summaries = channels.list(MEMBER_ID);
    const warm = Array.from({ length: RUNS }, () => timed(() => channels.list(MEMBER_ID)));
    const oneChanged = Array.from({ length: RUNS }, (_, run) =>
      timed(() => {
        channels.markRead(`channel-${run}`, MEMBER_ID, MESSAGE_COUNT - 100, `bench-read-${run}`);
        channels.list(MEMBER_ID);
      }),
    );
    const expectedUnread = Number(
      connection
        .prepare(
          `SELECT COUNT(*) AS count FROM projection_channel_messages
           WHERE channel_id = 'channel-0' AND sequence > ? AND ${SHOWN_MESSAGE_SQL}
             AND COALESCE(json_extract(message_json, '$.message.itemType'), '') NOT IN ('plan', 'commentary')`,
        )
        .get(MESSAGE_COUNT - 100)?.count ?? -1,
    );
    const firstSummary = summaries.find((summary) => summary.id === "channel-0");
    if (summaries.length !== CHANNEL_COUNT)
      throw new Error(`Expected ${CHANNEL_COUNT} summaries, got ${summaries.length}.`);
    if (firstSummary?.unreadCount !== expectedUnread)
      throw new Error(`Expected ${expectedUnread} unread messages, got ${firstSummary?.unreadCount}.`);
    if (firstSummary.openTasks !== 9 || firstSummary.activeTasks !== 3)
      throw new Error(`Unexpected task counts ${firstSummary.openTasks}/${firstSummary.activeTasks}.`);
    const counts = {
      channels: CHANNEL_COUNT,
      messages: CHANNEL_COUNT * MESSAGE_COUNT,
      tasks: CHANNEL_COUNT * TASK_COUNT,
      summaries: summaries.length,
      unreadInFirstChannel: firstSummary.unreadCount,
    };
    const medianMs = { cold: median(cold), warm: median(warm), oneChanged: median(oneChanged) };
    await mkdir(resolve(".openbot-build"), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify({ counts, runs: RUNS, medianMs }, null, 2)}\n`);
    process.stdout.write(`${outputPath}\n`);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
