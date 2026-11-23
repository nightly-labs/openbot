import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const CHANNEL_COUNT = 64;
const MESSAGE_COUNT = 500;
const TASK_COUNT = 12;
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

const latestQuery = `SELECT channel_id, message_json FROM (
  SELECT m.channel_id, m.message_json,
    ROW_NUMBER() OVER (PARTITION BY m.channel_id ORDER BY m.sequence DESC, m.message_id DESC) AS row_number
  FROM projection_channel_messages AS m
  WHERE ${SHOWN_MESSAGE_SQL.replaceAll("message_json", "m.message_json")}
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'
    AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'
) WHERE row_number = 1`;
const taskQuery = `SELECT channel_id,
  SUM(CASE WHEN json_extract(task_json, '$.state') = 'running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN json_extract(task_json, '$.state') IN ('queued', 'waiting', 'running') THEN 1 ELSE 0 END) AS open
  FROM projection_channel_tasks GROUP BY channel_id`;
const unreadQuery = `SELECT c.channel_id, COUNT(m.message_id) AS unread
  FROM projection_channels AS c
  LEFT JOIN projection_channel_reads AS r ON r.channel_id = c.channel_id AND r.member_id = ?
  LEFT JOIN projection_channel_messages AS m ON m.channel_id = c.channel_id
    AND m.sequence > COALESCE(r.through_sequence, 0)
  GROUP BY c.channel_id`;

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
    const channels = new ChannelStore(database);
    const startedAt = performance.now();
    const summaries = channels.list(MEMBER_ID);
    const elapsedMs = performance.now() - startedAt;
    const plans = {
      latest: connection.prepare(`EXPLAIN QUERY PLAN ${latestQuery}`).all(),
      tasks: connection.prepare(`EXPLAIN QUERY PLAN ${taskQuery}`).all(),
      unread: connection.prepare(`EXPLAIN QUERY PLAN ${unreadQuery}`).all(MEMBER_ID),
    };
    const counts = {
      channels: connection.prepare("SELECT COUNT(*) AS count FROM projection_channels").get(),
      messages: connection.prepare("SELECT COUNT(*) AS count FROM projection_channel_messages").get(),
      tasks: connection.prepare("SELECT COUNT(*) AS count FROM projection_channel_tasks").get(),
      summaries: summaries.length,
    };
    await mkdir(resolve(".openbot-build"), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify({ counts, elapsedMs, plans }, null, 2)}\n`);
    process.stdout.write(`${outputPath}\n`);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
