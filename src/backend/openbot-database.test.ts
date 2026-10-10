// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type { AgentProviderId, AgentSummary, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import {
  hostedSiteConversationEventItemType,
  hostedSiteConversationEventText,
  isConversationVisibilityAfter,
  routineConversationEventItemType,
  routineRunConversationEventItemType,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { AgentRoutineStore } from "./agent-routine-store";
import { ChannelRoutineStore } from "./channel-routine-store";
import { ChannelStore } from "./channel-store";
import { ConversationReadStore } from "./conversation-read-store";
import {
  CONVERSATION_CACHE_BYTES_LIMIT,
  CONVERSATION_CACHE_MESSAGE_LIMIT,
  retainConversationMessages,
} from "./database/conversation-retention";
import type { ConversationReveal } from "./database/conversation-visibility";
import { runCauseEffect } from "./effect-boundary";
import { MailboxStore } from "./mailbox-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenBotDatabase", () => {
  it("rolls back a failed channel migration and preserves agent history on retry", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("seed-channel-upgrade", [agent], "agents.updated");
    const original = {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: null,
      revision: 0,
      messages: [
        {
          id: "retained-message",
          author: "user" as const,
          text: "Keep this conversation",
          status: "completed" as const,
          createdAt: "2026-09-07T12:00:00.000Z",
        },
      ],
    };
    database.persistConversation(original, "conversation.saved");
    const path = database.path;
    const root = database.userDataPath;
    database.close();
    const legacy = new DatabaseSync(path);
    removeSchemaAfterVersion14(legacy);
    // The squatted name is the index's, not a table's: the migration creates its tables with
    // IF NOT EXISTS, and SQLite refuses an index whose name a table already holds however the
    // statement is spelled. What is under test is the rollback, not which object collides.
    legacy.exec("CREATE TABLE channel_tasks_channel (conflict TEXT)");
    legacy.close();
    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 18 failed");
    const check = new DatabaseSync(path);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'projection_channels'").get()).toBeUndefined();
    expect(check.prepare("SELECT version FROM schema_migrations WHERE version = 17").get()).toEqual({ version: 17 });
    expect(check.prepare("SELECT version FROM schema_migrations WHERE version = 18").get()).toBeUndefined();
    check.exec("DROP TABLE channel_tasks_channel");
    check.close();
    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(retried.listAgents()).toEqual([agent]);
    expect(retried.readConversation(agent.id, agent.threadId).messages).toEqual(original.messages);
    expect(retried.connection.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    retried.close();
  });

  it("configures a private WAL database with every required projection", async () => {
    const database = await createDatabase();
    const tables = database.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => {
        if (!isDynamicRecord(row) || !isString(row.name)) throw new Error("Invalid table row.");
        return row.name;
      });

    expect(tables).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "orchestration_events",
        "orchestration_command_receipts",
        "projection_agents",
        "projection_agent_memories",
        "projection_agent_routines",
        "projection_routine_triggers",
        "projection_routine_runs",
        "projection_threads",
        "projection_provider_sessions",
        "projection_turns",
        "projection_thread_messages",
        "provider_history_imports",
        "provider_history_turns",
        "provider_history_staging",
        "projection_thread_activities",
        "projection_mailbox_messages",
        "projection_deliveries",
        "projection_queue_state",
        "projection_reactions",
        "projection_attachments",
        "projection_thread_summaries",
        "projection_direct_threads",
        "projection_direct_messages",
        "projection_direct_reads",
        "projection_channel_memories",
        "projection_channel_routines",
        "projection_channel_routine_triggers",
        "projection_channel_routine_runs",
        "projection_routine_webhooks",
        "projection_channel_routine_webhooks",
        "projection_webhook_route_revocations",
        "projection_webhook_receipts",
        "file_deletion_outbox",
      ]),
    );
    expect(database.connection.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
    expect((await stat(database.path)).mode & 0o777).toBe(0o600);
    expect(database.connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
    ]);
    database.close();
  });

  it("commits bounded provider pages with attachment preservation and retry markers", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("provider-history-agent", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const session = database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "provider-history-thread",
      model: agent.model,
      effort: agent.reasoningEffort,
    });
    const stored: ConversationSnapshot = {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: null,
      revision: 0,
      messages: [
        {
          id: "provider-answer",
          turnId: "provider-turn",
          author: "assistant",
          text: "Before",
          createdAt: "2026-09-01T12:00:00.000Z",
          status: "completed",
          attachments: [
            {
              id: "kept-attachment",
              name: "notes.txt",
              size: 5,
              kind: "file",
              mimeType: "text/plain",
              previewKind: "text",
              previewUrl: null,
            },
          ],
        },
      ],
    };
    const storedMessage = stored.messages[0];
    assert(storedMessage);
    database.persistConversation(stored, "conversation.seeded");
    database.ensureProviderHistoryImport({
      sessionId: session.id,
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: session.externalSessionId,
    });
    const item = { id: "provider-answer", type: "agentMessage", text: "After" };
    database.stageProviderHistoryFragment({
      sessionId: session.id,
      fragment: { turnId: "provider-turn", status: "completed", items: [item], complete: false },
    });
    database.importProviderHistoryMessages({
      sessionId: session.id,
      turnId: "provider-turn",
      agentId: agent.id,
      threadId: agent.threadId,
      messages: [withoutAttachments({ ...storedMessage, text: "After" })],
      throughItemIndex: 0,
      complete: false,
    });
    expect(database.providerHistoryImport(session.id)?.state).toBe("active");
    expect(database.stagedProviderHistoryItems({ sessionId: session.id, turnId: "provider-turn" })).toEqual([
      expect.objectContaining({ itemIndex: 0, imported: true }),
    ]);

    database.stageProviderHistoryFragment({
      sessionId: session.id,
      fragment: { turnId: "provider-turn", status: "completed", items: [item], complete: true },
    });
    database.importProviderHistoryMessages({
      sessionId: session.id,
      turnId: "provider-turn",
      agentId: agent.id,
      threadId: agent.threadId,
      messages: [withoutAttachments({ ...storedMessage, text: "After" })],
      throughItemIndex: 0,
      complete: true,
    });
    database.importProviderHistoryMessages({
      sessionId: session.id,
      turnId: "provider-turn",
      agentId: agent.id,
      threadId: agent.threadId,
      messages: [withoutAttachments({ ...storedMessage, text: "After" })],
      complete: true,
    });

    expect(database.providerHistoryImport(session.id)?.state).toBe("active");
    expect(database.stagedProviderHistoryTurns(session.id)).toEqual([
      expect.objectContaining({ turnId: "provider-turn", complete: true, imported: true }),
    ]);
    expect(database.readConversation(agent.id, agent.threadId).messages).toEqual([
      expect.objectContaining({
        id: "provider-answer",
        text: "After",
        attachments: [expect.objectContaining({ id: "kept-attachment" })],
      }),
    ]);
    expect(database.readConversation(agent.id, agent.threadId).messages).toHaveLength(1);
    database.close();
  });

  it("rolls back events, projections, and receipts as one transaction", async () => {
    const database = await createDatabase();
    expect(() =>
      database.dispatch(
        "broken-command",
        [
          {
            aggregateType: "test",
            aggregateId: "one",
            eventType: "test.started",
            payload: {},
          },
        ],
        () => {
          throw new Error("projection failed");
        },
      ),
    ).toThrow("projection failed");

    expect(eventCount(database)).toBe(0);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_command_receipts WHERE command_id = ?")
        .get("broken-command"),
    ).toMatchObject({ count: 0 });
    database.close();
  });

  it("keeps a terminal hosted-site outcome pending until its marker command is durable", async () => {
    const database = await createDatabase();
    const pending = {
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      operationId: "operation-1",
      action: "publish" as const,
      status: "succeeded" as const,
      details: {
        siteId: "site-1",
        title: "Launch page",
        hostname: "launch-page-23456789ab.openbot.site",
        url: "https://launch-page-23456789ab.openbot.site",
      },
      markerCommandId: "hosted-site-event:chief:operation-1:succeeded",
      createdAt: "2026-09-01T12:00:00.000Z",
    };

    database.recordPendingHostedSiteTerminalEvent(pending);
    database.recordPendingHostedSiteTerminalEvent(pending);
    expect(database.pendingHostedSiteTerminalEvents()).toEqual([pending]);
    expect(
      database.connection
        .prepare(
          "SELECT aggregate_type, aggregate_id FROM orchestration_events WHERE event_type = 'hosted-site.terminal-pending'",
        )
        .get(),
    ).toEqual({ aggregate_type: "hosted-site-terminal", aggregate_id: pending.agentId });

    database.dispatch(pending.markerCommandId, [], () => ({ recorded: true }));
    expect(database.pendingHostedSiteTerminalEvents()).toEqual([]);
    database.deletePendingHostedSiteTerminalEvent(pending.agentId, pending.operationId, pending.status);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'hosted-site.terminal-pending'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_command_receipts WHERE command_id LIKE 'hosted-site-terminal-pending:%'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
    database.close();
  });

  it("stores only active hosted-site operations for restart reconciliation", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-running-sites", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent needs a thread.");
    const threadId = agent.threadId;
    const details = {
      siteId: "site-1",
      title: "Launch page",
      hostname: "launch-page-23456789ab.openbot.site",
      url: "https://launch-page-23456789ab.openbot.site",
    };
    const recordActive = (operationId: string, createdAt: string) => {
      database.recordActiveHostedSiteConversationEvent({
        agentId: agent.id,
        threadId,
        turnId: `turn-${operationId}`,
        createdAt,
        event: { action: "replace", status: "running", operationId, ...details },
      });
    };

    recordActive("operation-complete", "2026-09-01T12:00:00.000Z");
    database.deleteActiveHostedSiteConversationEvent(agent.id, "operation-complete");
    recordActive("operation-running", "2026-09-01T12:00:02.000Z");

    expect(database.activeHostedSiteConversationEvents()).toEqual([
      expect.objectContaining({
        agentId: agent.id,
        threadId: agent.threadId,
        turnId: "turn-operation-running",
        event: expect.objectContaining({ operationId: "operation-running", status: "running" }),
      }),
    ]);
    database.close();
  });

  it("returns the durable command receipt without running a command twice", async () => {
    const database = await createDatabase();
    let projections = 0;
    const run = () =>
      database.dispatch(
        "stable-command",
        [
          {
            aggregateType: "test",
            aggregateId: "one",
            eventType: "test.completed",
            payload: { value: 42 },
          },
        ],
        () => ({ projections: ++projections }),
      );

    expect(run()).toEqual({ projections: 1 });
    expect(run()).toEqual({ projections: 1 });
    expect(projections).toBe(1);
    expect(eventCount(database)).toBe(1);
    database.close();
  });

  it("reads a completed conversation after a database restart without a provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-restart-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const threadId = agent.threadId;
    database.replaceAgents("agents-import", [agent], "agents.imported");
    const snapshot: ConversationSnapshot = {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: [
        {
          id: "user-1",
          author: "user",
          text: "Return 42",
          createdAt: "2026-08-18T10:00:00.000Z",
          status: "completed",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          author: "assistant",
          text: "42",
          createdAt: "2026-08-18T10:00:01.000Z",
          status: "completed",
        },
      ],
    };
    const saved = database.persistConversation(snapshot, "turn.completed", {
      turnId: "turn-1",
      status: "completed",
    });
    database.connection.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(agent.threadId);
    expect(database.readConversation(agent.id, agent.threadId).messages).toEqual([]);
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    expect(database.rebuildThreadProjection(agent.threadId).messages).toMatchObject([
      { text: "Return 42", status: "completed" },
      { text: "42", status: "completed" },
    ]);
    database.close();

    const restored = new OpenBotDatabase(root);
    await runCauseEffect(restored.initialize());
    expect(restored.readConversation(agent.id, agent.threadId)).toMatchObject({
      revision: saved.revision,
      messages: [
        { text: "Return 42", status: "completed" },
        { text: "42", status: "completed" },
      ],
    });
    restored.close();
  });

  it("appends one conversation marker and replays it without another full snapshot", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-append-marker", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const saved = database.persistConversation(
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: "turn-1",
        revision: 0,
        messages: [
          {
            id: "user-before-marker",
            author: "user",
            text: "Run the routine",
            createdAt: "2026-08-18T10:00:00.000Z",
            status: "completed",
          },
        ],
      },
      "turn.started",
    );
    const marker: ConversationMessage = {
      id: "routine-marker",
      author: "system",
      source: "system",
      text: "Morning brief",
      createdAt: "2026-08-18T10:00:01.000Z",
      status: "completed",
      itemType: "routine-run-event:running:routine-1:run-1",
    };

    const revision = database.appendConversationMessage({
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: "turn-1",
      message: marker,
      eventType: "routine.run-running",
      detail: { routineId: "routine-1", runId: "run-1", status: "running" },
    });

    expect(revision).toBeGreaterThan(saved.revision);
    expect(database.readConversation(agent.id, agent.threadId)).toMatchObject({
      revision,
      messages: [{ id: "user-before-marker" }, { id: marker.id, itemType: marker.itemType }],
    });
    const event = database.connection
      .prepare("SELECT payload_json FROM orchestration_events WHERE event_type = 'routine.run-running'")
      .get();
    if (!isDynamicRecord(event) || !isString(event.payload_json)) throw new Error("The marker event is invalid.");
    const eventPayload = JSON.parse(event.payload_json);
    expect(eventPayload).toMatchObject({ appendedMessage: { id: marker.id } });
    expect(eventPayload).not.toHaveProperty("snapshot");

    database.connection.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(agent.threadId);
    expect(database.rebuildThreadProjection(agent.threadId)).toMatchObject({
      revision,
      messages: [{ id: "user-before-marker" }, { id: marker.id, itemType: marker.itemType }],
    });
    database.close();
  });

  it("reads bounded runtime metadata without loading a full conversation", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-runtime", [agent], "agents.imported");
    database.persistConversation(
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: "turn-active",
        revision: 0,
        messages: [
          {
            id: "assistant-latest",
            author: "assistant",
            text: "Latest answer",
            createdAt: "2026-08-29T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "user-after",
            author: "user",
            text: "Follow-up",
            createdAt: "2026-08-29T10:01:00.000Z",
            status: "completed",
          },
          {
            id: "commentary-after",
            author: "assistant",
            text: "Checking the sources",
            createdAt: "2026-08-29T10:02:00.000Z",
            status: "completed",
            itemType: "commentary",
          },
          {
            id: "question-after",
            author: "assistant",
            text: "Which source should I use?",
            createdAt: "2026-08-29T10:03:00.000Z",
            status: "completed",
            itemType: "question_prompt",
          },
          {
            id: "attachment-after",
            author: "assistant",
            text: "",
            createdAt: "2026-08-29T10:04:00.000Z",
            status: "completed",
            itemType: "agent_attachment",
          },
        ],
      },
      "turn.started",
      { turnId: "turn-active" },
    );

    expect(database.readConversationRuntime(agent.id, agent.threadId)).toEqual({
      activeTurnId: "turn-active",
      latestMessage: expect.objectContaining({ id: "assistant-latest", text: "Latest answer" }),
    });
    database.close();
  });

  it("pages and searches a 1,000-message conversation without gaps", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-large-history", [agent], "agents.imported");
    const messages: ConversationMessage[] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `message-${index.toString().padStart(5, "0")}`,
      author: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: index === 234 || index === 235 ? "A unique pagination needle" : `Message ${index}`,
      ...(index === 235 ? { itemType: "commentary" } : {}),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString(),
      status: "completed" as const,
    }));
    database.persistConversation(
      { agentId: agent.id, threadId: agent.threadId, activeTurnId: null, revision: 0, messages },
      "conversation.large-history",
    );

    const latest = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50);
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[0]?.id).toBe("message-00950");
    expect(latest.messages.at(-1)?.id).toBe("message-00999");
    expect(latest.pageInfo.hasOlder).toBe(true);

    const seen = new Set(latest.messages.map((message) => message.id));
    let page = latest;
    while (page.pageInfo.olderCursor) {
      page = database.readConversationPage(
        agent.id,
        agent.threadId,
        { type: "before", cursor: page.pageInfo.olderCursor },
        50,
      );
      for (const message of page.messages) expect(seen.has(message.id)).toBe(false);
      page.messages.forEach((message) => {
        seen.add(message.id);
      });
    }
    expect(seen.size).toBe(1_000);

    const around = database.readConversationPage(
      agent.id,
      agent.threadId,
      { type: "around", messageId: "message-00500" },
      50,
    );
    expect(around.messages).toHaveLength(50);
    expect(around.messages.some((message) => message.id === "message-00500")).toBe(true);
    expect(database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 1_000).messages).toHaveLength(
      100,
    );

    const search = database.searchConversationMessages("pagination needle", agent.id, undefined, 100);
    expect(search.total).toBe(1);
    expect(search.results.map((result) => result.message.id)).toEqual(["message-00234"]);
    expect(search.nextCursor).toBeNull();
    expect(database.searchConversationMessages("pagination needle")).toEqual(search);
    database.close();
  });

  it("pages a conversation in the order the live conversation shows it (#1540)", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-acp-order", [agent], "agents.imported");
    const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
    const message = (id: string, seconds: number, fields: Partial<ConversationMessage> = {}): ConversationMessage => ({
      id,
      author: "assistant",
      text: id,
      createdAt: at(seconds),
      status: "completed",
      ...fields,
    });
    const messages: ConversationMessage[] = [];
    for (let turn = 0; turn < 12; turn += 1) {
      const start = turn * 100;
      const turnId = `turn-${turn}`;
      messages.push(
        // Each later question was queued while the turn before it ran.
        message(`${turnId}-question`, turn === 0 ? 0 : start - 50, { author: "user", turnId }),
        message(`${turnId}-thought`, start + 1, { turnId, itemType: "commentary" }),
        message(`${turnId}-tie`, start + 1, { turnId, itemType: "commentary" }),
        // An ACP agent sends its answer only when the turn ends.
        message(`${turnId}-answer`, start + 90, { turnId }),
      );
    }
    // Grok refuses a steer and answers it in the same turn, after the first answer.
    messages.push(
      message("steered-question", 2_000, { author: "user", turnId: "steered" }),
      message("steered-thought", 2_001, { turnId: "steered", itemType: "commentary" }),
      message("steer", 2_010, { author: "user", turnId: "steered" }),
      message("steered-first-answer", 2_020, { turnId: "steered" }),
      message("steered-second-thought", 2_021, { turnId: "steered", itemType: "commentary" }),
      message("steered-second-answer", 2_030, { turnId: "steered" }),
      message("marker", 2_015),
    );
    // The shared order puts a turn's question first even when its answer has an earlier time.
    messages.push(
      message("skewed-answer", 1_500, { turnId: "skewed" }),
      message("skewed-thought", 1_501, { turnId: "skewed", itemType: "commentary" }),
      message("skewed-question", 1_502, { author: "user", turnId: "skewed" }),
    );
    // Two messages alone at one time keep the order they were stored in.
    messages.push(message("tie-z", 1_600), message("tie-a", 1_600));
    // A turn larger than a page, with a steer on its last page.
    messages.push(
      message("large-question", 2_999, { author: "user", turnId: "large" }),
      message("large-answer", 3_200, { turnId: "large" }),
    );
    for (let index = 0; index < 120; index += 1) {
      const id = `large-${index.toString().padStart(3, "0")}`;
      messages.push(
        index === 110
          ? message(id, 3_000 + index, { author: "user", turnId: "large" })
          : message(id, 3_000 + index, { turnId: "large", itemType: "commentary" }),
      );
    }
    // The live runtime sorts a snapshot before it stores it.
    sortConversationMessages(messages);
    const expected = messages.map(({ id }) => id);
    database.persistConversation(
      { agentId: agent.id, threadId: agent.threadId, activeTurnId: null, revision: 0, messages },
      "conversation.acp-order",
    );

    expect(database.readConversation(agent.id, agent.threadId).messages.map(({ id }) => id)).toEqual(expected);
    expect(expected.indexOf("turn-1-question")).toBeGreaterThan(expected.indexOf("turn-0-answer"));
    expect(expected.indexOf("steer")).toBeGreaterThan(expected.indexOf("steered-thought"));
    expect(expected.indexOf("skewed-answer")).toBeGreaterThan(expected.indexOf("skewed-question"));
    expect(expected.indexOf("tie-a")).toBeGreaterThan(expected.indexOf("tie-z"));
    expect(expected.indexOf("steered-first-answer")).toBeLessThan(expected.indexOf("steered-second-thought"));

    for (const limit of [1, 5, 50]) {
      const pages: string[][] = [];
      let page = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, limit);
      pages.unshift(page.messages.map(({ id }) => id));
      while (page.pageInfo.olderCursor) {
        page = database.readConversationPage(
          agent.id,
          agent.threadId,
          { type: "before", cursor: page.pageInfo.olderCursor },
          limit,
        );
        expect(page.messages.length).toBeLessThanOrEqual(100);
        pages.unshift(page.messages.map(({ id }) => id));
      }
      expect(pages.flat()).toEqual(expected);
      const pageOfTurn = new Map<string, number>();
      pages.forEach((ids, index) => {
        for (const id of ids) {
          const turnId = messages.find((candidate) => candidate.id === id)?.turnId;
          if (!turnId || turnId === "large") continue;
          expect(pageOfTurn.get(turnId) ?? index).toBe(index);
          pageOfTurn.set(turnId, index);
        }
      });
    }

    // The marker came while the steered turn ran and shows after it. Read through it, only the
    // answer of the later turn is unread.
    expect(new ConversationReadStore(database).markReadForThread("member", agent.threadId, "marker")).toEqual({
      unreadCount: 1,
      firstUnreadMessageId: "large-answer",
      throughMessageId: "marker",
    });
    // Read through the thought, the answer shown after it is still unread.
    expect(
      new ConversationReadStore(database).markReadForThread("skew-reader", agent.threadId, "skewed-thought"),
    ).toMatchObject({ firstUnreadMessageId: "skewed-answer" });

    // An anchor late in a turn larger than a page still gets the rows after it.
    const lateAnchor = database.readConversationPage(
      agent.id,
      agent.threadId,
      { type: "around", messageId: "large-105" },
      4,
    );
    expect(lateAnchor.messages.length).toBeLessThanOrEqual(100);
    expect(lateAnchor.messages.map(({ id }) => id)).toContain("large-106");

    // An anchor at the start of a turn keeps the page's room for that turn, not for earlier turns.
    const turnStart = database.readConversationPage(
      agent.id,
      agent.threadId,
      { type: "around", messageId: "large-question" },
      50,
    );
    expect(turnStart.messages.map(({ id }) => id)).toEqual(
      expected.slice(expected.indexOf("large-question"), expected.indexOf("large-question") + 100),
    );

    // With limit 2 the turn before the anchor already fills the page; the rest of the turn still comes.
    for (const limit of [2, 4]) {
      const around = database.readConversationPage(
        agent.id,
        agent.threadId,
        { type: "around", messageId: "steer" },
        limit,
      );
      expect(around.messages.map(({ id }) => id)).toEqual(
        expected.filter((id) => id.startsWith("steered") || id === "steer"),
      );
    }

    const ordinal = expected.indexOf("turn-6-question");
    const legacyCursor = Buffer.from(
      JSON.stringify({ version: 1, createdAt: at(550), ordinal, messageId: "turn-6-question" }),
    ).toString("base64url");
    const legacyPage = database.readConversationPage(
      agent.id,
      agent.threadId,
      { type: "before", cursor: legacyCursor },
      100,
    );
    expect(legacyPage.messages.map(({ id }) => id)).toEqual(expected.slice(0, expected.indexOf("turn-6-question")));
    database.close();
  });

  it("keeps the channel thread of an agent out of the conversation search", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-channel-search", [agent], "agents.imported");
    const channelThreadId = "openbot-thread-channel-search";
    const now = "2026-09-01T12:00:00.000Z";
    database.connection
      .prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)")
      .run("channel-1", JSON.stringify({ id: "channel-1", name: "Project" }));
    database.connection
      .prepare(
        `INSERT INTO projection_threads
           (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
         VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      )
      .run(channelThreadId, agent.id, "Project", now, now);
    database.connection
      .prepare("INSERT INTO projection_channel_contexts(channel_id, agent_id, thread_id) VALUES (?, ?, ?)")
      .run("channel-1", agent.id, channelThreadId);
    const message = (id: string, text: string) => ({
      id,
      author: "assistant" as const,
      text,
      createdAt: now,
      status: "completed" as const,
    });
    database.persistConversation(
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [message("normal-hit", "A unique channel needle in the chat")],
      },
      "conversation.channel-search-normal",
    );
    database.persistConversation(
      {
        agentId: agent.id,
        threadId: channelThreadId,
        activeTurnId: null,
        revision: 0,
        messages: [message("channel-hit", "A unique channel needle in the channel")],
      },
      "conversation.channel-search-channel",
    );

    // A result names an agent and a message, and opening one shows the normal conversation of that
    // agent. A channel message is not there, so the search must not offer it.
    const search = database.searchConversationMessages("unique channel needle");
    expect(search.results.map((result) => result.message.id)).toEqual(["normal-hit"]);
    expect(search.total).toBe(1);
    expect(database.searchConversationMessages("unique channel needle", agent.id).total).toBe(1);
    database.close();
  });

  it("fills legacy pages after excluding action markers", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-routine-history", [agent], "agents.imported");
    const routineEvent = (id: string, createdAt: string) => ({
      id,
      author: "system" as const,
      source: "system" as const,
      text: "Morning brief",
      createdAt,
      status: "completed" as const,
      itemType: routineConversationEventItemType("updated", "routine-1"),
    });
    const routineRunEvent = (id: string, createdAt: string) => ({
      id,
      author: "system" as const,
      source: "system" as const,
      text: "Morning brief",
      createdAt,
      status: "completed" as const,
      itemType: routineRunConversationEventItemType("running", "routine-1", "run-1"),
    });
    const hostedSiteEvent = (id: string, createdAt: string) => ({
      id,
      author: "system" as const,
      source: "system" as const,
      text: hostedSiteConversationEventText({
        siteId: null,
        title: "Launch page",
        hostname: null,
        url: null,
      }),
      createdAt,
      status: "completed" as const,
      itemType: hostedSiteConversationEventItemType("publish", "running", "operation-1"),
    });
    database.persistConversation(
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [
          {
            id: "reply-old",
            author: "assistant",
            text: "Older reply",
            createdAt: "2026-08-29T10:00:00.000Z",
            status: "completed",
          },
          routineEvent("routine-event-1", "2026-08-29T10:01:00.000Z"),
          {
            id: "reply-new",
            author: "assistant",
            text: "Newer reply",
            createdAt: "2026-08-29T10:02:00.000Z",
            status: "completed",
          },
          routineEvent("routine-event-2", "2026-08-29T10:03:00.000Z"),
          routineRunEvent("routine-run-event-1", "2026-08-29T10:04:00.000Z"),
          routineEvent("routine-event-3", "2026-08-29T10:05:00.000Z"),
          hostedSiteEvent("hosted-site-event-1", "2026-08-29T10:06:00.000Z"),
        ],
      },
      "conversation.routine-history",
    );

    const latest = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 1, {
      excludeRoutineEvents: true,
      excludeRoutineRunEvents: true,
      excludeHostedSiteEvents: true,
    });
    expect(latest.messages.map((message) => message.id)).toEqual(["reply-new"]);
    expect(latest.pageInfo.hasOlder).toBe(true);
    if (!latest.pageInfo.olderCursor) throw new Error("The older page cursor is missing.");

    const older = database.readConversationPage(
      agent.id,
      agent.threadId,
      { type: "before", cursor: latest.pageInfo.olderCursor },
      1,
      { excludeRoutineEvents: true, excludeRoutineRunEvents: true, excludeHostedSiteEvents: true },
    );
    expect(older.messages.map((message) => message.id)).toEqual(["reply-old"]);
    expect(older.pageInfo.hasOlder).toBe(false);
    expect(database.searchConversationMessages("Morning brief", agent.id).total).toBe(0);
    expect(database.searchConversationMessages("Launch page", agent.id).total).toBe(0);
    database.close();
  });

  it("keeps one full conversation snapshot and a small idempotency receipt", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    const snapshot = conversationSnapshot(agent, "x".repeat(40_000));

    const first = database.persistConversation(snapshot, "response.delta-flushed", {}, "stable-conversation");
    expect(database.persistConversation(snapshot, "response.delta-flushed", {}, "stable-conversation")).toEqual(first);
    for (let index = 0; index < 100; index += 1) {
      database.persistConversation(snapshot, "response.delta-flushed");
    }

    expect(snapshotEventCount(database, agent.threadId)).toBe(1);
    expect(
      database.connection
        .prepare(
          `SELECT COUNT(*) AS count, SUM(LENGTH(result_json)) AS bytes
           FROM orchestration_command_receipts WHERE command_id LIKE 'conversation:%'`,
        )
        .get(),
    ).toMatchObject({ count: 1, bytes: expect.any(Number) });
    const receipt = database.connection
      .prepare(
        `SELECT result_json FROM orchestration_command_receipts
         WHERE command_id LIKE 'conversation:%' LIMIT 1`,
      )
      .get();
    expect(receipt).toMatchObject({ result_json: expect.stringMatching(/^\{"revision":\d+\}$/) });
    database.close();
  });

  it("writes only the streamed message and keeps one event for the whole run", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const snapshot = streamingSnapshot(agent, 40);
    database.persistConversation(snapshot, "turn.started", { turnId: "turn-1" });
    const settledSequences = messageSequences(database, agent.threadId);

    const streamed = snapshot.messages[snapshot.messages.length - 1];
    if (!streamed) throw new Error("The streaming message is missing.");
    let revision = snapshot.revision;
    for (let index = 0; index < 100; index += 1) {
      streamed.text += "token ";
      revision = database.persistStreamingMessage({
        snapshot,
        messageId: streamed.id,
        eventType: "response.delta-flushed",
        detail: { turnId: "turn-1" },
      });
    }

    const conversation = database.readConversation(agent.id, agent.threadId);
    expect(conversation.revision).toBe(revision);
    expect(conversation.messages.at(-1)).toMatchObject({ id: "assistant-live", text: "token ".repeat(100) });
    // The settled history keeps the sequence it was written at, so the streamed message is the only
    // row a flush touched. A flush that rewrote the whole thread would stamp every row with its own
    // sequence, which is the cost this write path exists to avoid.
    const rewritten = Object.entries(messageSequences(database, agent.threadId))
      .filter(([messageId, sequence]) => settledSequences[messageId] !== sequence)
      .map(([messageId]) => messageId);
    expect(rewritten).toEqual(["assistant-live"]);
    // One hundred flushes, one event and one receipt: each flush drops the one it supersedes.
    expect(streamedMessageEventCount(database, agent.threadId)).toBe(1);
    expect(
      database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_command_receipts
           WHERE command_id LIKE 'conversation:response.delta-flushed:%'`,
        )
        .get(),
    ).toMatchObject({ count: 1 });
    database.close();
  });

  it("replays a thread whose streamed text was replaced rather than appended", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const snapshot = streamingSnapshot(agent, 3);
    database.persistConversation(snapshot, "turn.started", { turnId: "turn-1" });
    const streamed = snapshot.messages[snapshot.messages.length - 1];
    if (!streamed) throw new Error("The streaming message is missing.");

    streamed.text = "partial answ";
    database.persistStreamingMessage({ snapshot, messageId: streamed.id, eventType: "response.delta-flushed" });
    // `item/completed` replaces the text instead of adding to it, so a replay that summed the
    // flushes would rebuild "partial answ" plus the whole answer.
    streamed.text = "The complete answer.";
    streamed.status = "completed";
    const revision = database.persistStreamingMessage({
      snapshot,
      messageId: streamed.id,
      eventType: "response.delta-flushed",
    });

    database.connection.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(agent.threadId);
    expect(database.rebuildThreadProjection(agent.threadId)).toMatchObject({
      revision,
      activeTurnId: "turn-1",
    });
    expect(database.readConversation(agent.id, agent.threadId).messages.at(-1)).toMatchObject({
      id: "assistant-live",
      text: "The complete answer.",
      status: "completed",
    });
    database.close();
  });

  it("drops the streamed message events once a whole snapshot supersedes them", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const snapshot = streamingSnapshot(agent, 3);
    database.persistConversation(snapshot, "turn.started", { turnId: "turn-1" });
    const streamed = snapshot.messages[snapshot.messages.length - 1];
    if (!streamed) throw new Error("The streaming message is missing.");
    streamed.text = "An answer that streamed in.";
    database.persistStreamingMessage({ snapshot, messageId: streamed.id, eventType: "response.delta-flushed" });
    expect(streamedMessageEventCount(database, agent.threadId)).toBe(1);

    streamed.status = "completed";
    snapshot.activeTurnId = null;
    database.persistConversation(snapshot, "turn.completed", { turnId: "turn-1", status: "completed" });

    expect(streamedMessageEventCount(database, agent.threadId)).toBe(0);
    expect(snapshotEventCount(database, agent.threadId)).toBe(1);
    // The whole snapshot carries the streamed text, so dropping the flushes loses nothing.
    database.connection.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(agent.threadId);
    expect(database.rebuildThreadProjection(agent.threadId).messages.at(-1)).toMatchObject({
      text: "An answer that streamed in.",
      status: "completed",
    });
    database.close();
  });

  it("falls back to a whole snapshot when the streamed message left the thread", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const snapshot = streamingSnapshot(agent, 2);
    database.persistConversation(snapshot, "turn.started", { turnId: "turn-1" });
    // A thread reset between the buffer and its flush leaves the message unknown to the snapshot.
    snapshot.messages = snapshot.messages.slice(0, 1);

    const revision = database.persistStreamingMessage({
      snapshot,
      messageId: "assistant-live",
      eventType: "response.delta-flushed",
    });

    const conversation = database.readConversation(agent.id, agent.threadId);
    expect(conversation.revision).toBe(revision);
    expect(conversation.messages.map((message) => message.id)).toEqual(["settled-0"]);
    database.close();
  });

  it("rolls back mailbox attachments when the matching conversation projection fails", async () => {
    const database = await createDatabase();
    const mailboxState = {
      messages: [],
      deliveries: [],
      drafts: [],
      generatedAttachments: [],
      pausedAgentIds: [],
      idempotency: {},
      reactions: [],
    };
    database.replaceMailboxState("mailbox-baseline", mailboxState, "mailbox.baseline");
    const snapshot: ConversationSnapshot = {
      agentId: "missing-agent",
      threadId: "missing-thread",
      activeTurnId: null,
      revision: 0,
      messages: [],
    };

    expect(() =>
      database.persistConversationAndMailbox(
        snapshot,
        "response.attachments-added",
        {},
        {
          ...mailboxState,
          generatedAttachments: [
            {
              id: "generated-1",
              name: "screenshot.png",
              size: 12,
              kind: "image",
              mimeType: "image/png",
              previewKind: "image",
              previewUrl: "openbot-attachment://file/generated-1",
              path: "/tmp/screenshot.png",
              sha256: "hash",
            },
          ],
        },
        "attachment.generated-batch",
      ),
    ).toThrow("Unknown agent for conversation");
    expect(database.readMailboxState()).toMatchObject({ generatedAttachments: [] });
    expect(database.connection.isTransaction).toBe(false);
    database.close();
  });

  it("removes messages omitted from the latest full conversation snapshot", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    const snapshot = conversationSnapshot(agent, "Canonical reply");
    const [reply] = snapshot.messages;
    assert(reply);
    snapshot.messages.push({
      ...reply,
      id: "provisional-reply",
    });
    database.persistConversation(snapshot, "conversation.snapshot-updated");

    snapshot.messages = snapshot.messages.filter((message) => message.id !== "provisional-reply");
    database.persistConversation(snapshot, "provider-history.backfilled");

    expect(database.readConversation(agent.id, agent.threadId).messages.map((message) => message.id)).toEqual([
      "assistant-1",
    ]);
    database.close();
  });

  it("rebuilds provider turn links, summaries, and attachment projections from compact history", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const session = database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "provider-thread-1",
      model: agent.model,
      effort: agent.reasoningEffort,
    });
    const running = conversationSnapshot(agent, "Working");
    running.activeTurnId = "turn-1";
    const [message] = running.messages;
    assert(message);
    running.messages[0] = {
      ...message,
      turnId: "turn-1",
      status: "streaming",
      attachments: [
        {
          id: "attachment-1",
          name: "report.csv",
          size: 12,
          kind: "file",
          mimeType: "text/csv",
          previewKind: "text",
          previewUrl: null,
        },
      ],
    };
    database.persistConversation(running, "response.delta-flushed");
    const completed = structuredClone(running);
    completed.activeTurnId = null;
    const [completedMessage] = completed.messages;
    assert(completedMessage);
    completedMessage.status = "completed";
    database.persistConversation(completed, "turn.completed", { turnId: "turn-1", status: "completed" });
    database.saveThreadSummary(agent.threadId, completedMessage.id, "Saved context", 3);

    expect(snapshotEventCount(database, agent.threadId)).toBe(1);
    database.rebuildThreadProjection(agent.threadId);

    expect(
      database.connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
    ).toMatchObject({ provider_session_id: session.id });
    expect(
      database.connection
        .prepare("SELECT name FROM projection_attachments WHERE attachment_id = ?")
        .get(`${agent.threadId}:assistant-1:attachment-1`),
    ).toMatchObject({ name: "report.csv" });
    expect(
      database.connection
        .prepare("SELECT payload_json FROM projection_thread_activities WHERE activity_type = 'turn.completed'")
        .get(),
    ).toEqual({ payload_json: '{"turnId":"turn-1","status":"completed"}' });
    expect(database.latestThreadSummary(agent.threadId)).toMatchObject({ text: "Saved context" });
    database.close();
  });

  it("keeps only the latest full mailbox state", async () => {
    const database = await createDatabase();
    const state = {
      messages: [],
      deliveries: [],
      drafts: [],
      generatedAttachments: [],
      pausedAgentIds: [],
      idempotency: {},
      reactions: [],
    };
    database.replaceMailboxState("mailbox:first", state, "mailbox.updated");
    database.replaceMailboxState(
      "mailbox:second",
      { ...state, idempotency: { request: "message-1" } },
      "mailbox.updated",
    );

    expect(
      database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_events
           WHERE aggregate_type = 'mailbox' AND aggregate_id = 'mailbox'`,
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(
      database.connection
        .prepare("SELECT command_id FROM orchestration_command_receipts WHERE command_id LIKE 'mailbox:%'")
        .all(),
    ).toEqual([{ command_id: "mailbox:second" }]);
    database.close();
  });

  it("migrates version 3 history, preserves the current chat, and reclaims disk space", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-v3-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    const snapshot = conversationSnapshot(agent, "x".repeat(40_000));
    database.persistConversation(snapshot, "conversation.snapshot-updated");
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.exec("PRAGMA journal_mode = WAL");
    legacy
      .prepare("DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)")
      .run();
    legacy
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)")
      .run("2026-08-20T10:00:00.000Z");
    const insertEvent = legacy.prepare(`
      INSERT INTO orchestration_events (
        event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json
      ) VALUES (?, ?, 'thread', ?, 'provider-history.backfilled', ?, ?)
    `);
    const insertReceipt = legacy.prepare(`
      INSERT INTO orchestration_command_receipts (
        command_id, accepted_at, first_sequence, last_sequence, result_json
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 100; index += 1) {
      const commandId = `legacy-conversation-${index}`;
      const result = insertEvent.run(
        randomUUID(),
        commandId,
        agent.threadId,
        "2026-08-20T10:00:00.000Z",
        JSON.stringify({ detail: {}, snapshot }),
      );
      const sequence = Number(result.lastInsertRowid);
      insertReceipt.run(
        commandId,
        "2026-08-20T10:00:00.000Z",
        sequence,
        sequence,
        JSON.stringify({ ...snapshot, revision: sequence }),
      );
    }
    legacy.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    legacy.close();
    const sizeBefore = (await stat(database.path)).size;

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    const sizeAfter = (await stat(database.path)).size;
    expect(sizeAfter).toBeLessThan(sizeBefore / 2);
    expect(snapshotEventCount(migrated, agent.threadId)).toBe(1);
    expect(migrated.readConversation(agent.id, agent.threadId).messages[0]?.text).toHaveLength(40_000);
    expect(migrated.connection.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    expect(migrated.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 8").get()).toEqual({
      applied: 1,
    });
    expect(migrated.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 9").get()).toEqual({
      applied: 1,
    });
    expect(migrated.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 10").get()).toEqual({
      applied: 1,
    });
    expect(migrated.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 11").get()).toEqual({
      applied: 1,
    });
    migrated.close();

    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(snapshotEventCount(reopened, agent.threadId)).toBe(1);
    reopened.close();
  }, 20_000);

  // A release shipped versions 15 and 16 for usage analytics, so every database upgraded by that
  // release stands at 16 with no channel storage. Channel storage has to arrive above it: numbered
  // at or below 16 it would be filtered out as already applied, and the tables would never appear.
  it("adds channel projections to a database that already ran the analytics versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-v16-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const analyticsRelease = new DatabaseSync(database.path);
    for (const table of ["memories", "routines", "routine_triggers", "routine_runs"])
      analyticsRelease.exec(`DROP TABLE projection_channel_${table}`);
    for (const table of ["assignments", "tasks", "messages", "summaries", "reads", "contexts"])
      analyticsRelease.exec(`DROP TABLE projection_channel_${table}`);
    analyticsRelease.exec("DROP TABLE projection_channels");
    analyticsRelease.exec("DELETE FROM schema_migrations WHERE version >= 17");
    analyticsRelease.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (
             'projection_channels', 'projection_channel_messages',
             'projection_channel_memories', 'projection_channel_routines'
           ) ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "projection_channel_memories" },
      { name: "projection_channel_messages" },
      { name: "projection_channel_routines" },
      { name: "projection_channels" },
    ]);
    expect(migrated.connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
    ]);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();
  });

  it.each([false, true])("adds provider history tables without losing data (failed attempt=%s)", async (failFirst) => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-provider-history-v29-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const threadId = agent.threadId;
    database.replaceAgents("provider-history-migration", [agent], "agents.imported");
    database.persistConversation(conversationSnapshot(agent, "Keep this message"), "conversation.seeded");
    database.bindProviderSession({
      threadId,
      provider: "codex",
      externalSessionId: "history-v29-session",
      model: agent.model,
      effort: agent.reasoningEffort,
    });
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeProviderHistorySchema(legacy);
    legacy.prepare("DELETE FROM schema_migrations WHERE version IN (29, 30, 31)").run();
    if (failFirst) legacy.exec("CREATE TABLE provider_history_imports_thread (conflict TEXT)");
    legacy.close();

    if (failFirst) {
      await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
        "migration to version 29 failed",
      );
      const rolledBack = new DatabaseSync(database.path);
      expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 29").get()).toBeUndefined();
      expect(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'provider_history_%'").all()).toEqual([
        { name: "provider_history_imports_thread" },
      ]);
      expect(rolledBack.prepare("SELECT message_json FROM projection_thread_messages").all()).toHaveLength(1);
      rolledBack.exec("DROP TABLE provider_history_imports_thread");
      rolledBack.close();
    }

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'provider_history_%' ORDER BY name")
        .all(),
    ).toEqual([
      { name: "provider_history_imports" },
      { name: "provider_history_imports_thread" },
      { name: "provider_history_staging" },
      { name: "provider_history_staging_pending" },
      { name: "provider_history_staging_turn" },
      { name: "provider_history_turns" },
      { name: "provider_history_turns_pending" },
    ]);
    expect(migrated.readConversation(agent.id, threadId).messages[0]?.text).toBe("Keep this message");
    expect(migrated.listProviderSessions(threadId)).toHaveLength(1);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();
  });

  it("repairs the provider constraint in a pre-merge channel schema without losing channel data", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-channel-v18-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "channel-v18-session",
      model: "gpt-5.6-luna",
      effort: "medium",
    });
    const sessionId = database
      .listProviderSessions(agent.threadId)
      .find((session) => session.externalSessionId === "channel-v18-session")?.id;
    if (!sessionId) throw new Error("The provider session was not stored.");
    database.connection
      .prepare(
        `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('channel-v18-turn', ?, ?, 'completed', '2026-09-07T12:00:00.000Z',
           '2026-09-07T12:00:05.000Z', 1)`,
      )
      .run(agent.threadId, sessionId);
    database.connection
      .prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)")
      .run("channel-v18", JSON.stringify({ id: "channel-v18", purpose: "Keep this channel" }));
    database.connection
      .prepare(
        `INSERT INTO projection_channel_messages(channel_id, message_id, sequence, message_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run("channel-v18", "channel-v18-message", 1, JSON.stringify({ text: "Keep this channel message" }));
    database.close();

    // Recreate the unshipped channel branch's version 18 profile: channel migrations are marked through
    // 18, while its provider table still has the three-provider CHECK that migration 17 widens.
    const legacy = new DatabaseSync(database.path);
    removeProviderHistorySchema(legacy);
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_v18 (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok')),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_v18 SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_v18 RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      DELETE FROM schema_migrations WHERE version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31);
      PRAGMA foreign_keys = ON;
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare("SELECT channel_json FROM projection_channels WHERE channel_id = ?")
        .get("channel-v18"),
    ).toEqual({ channel_json: JSON.stringify({ id: "channel-v18", purpose: "Keep this channel" }) });
    expect(
      migrated.connection
        .prepare("SELECT message_json FROM projection_channel_messages WHERE message_id = ?")
        .get("channel-v18-message"),
    ).toEqual({ message_json: JSON.stringify({ text: "Keep this channel message" }) });
    expect(
      migrated.connection
        .prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?")
        .get("channel-v18-turn"),
    ).toEqual({ provider_session_id: sessionId });
    expect(
      migrated.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projection_provider_sessions'")
        .get(),
    ).toMatchObject({ sql: expect.not.stringContaining("CHECK(provider") });
    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 31,
    });
    migrated.close();
  });

  it("adds the MCP server projection to a version 19 database and keeps its rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-v19-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.close();

    // A version 19 database: the table migration 20 creates is not there, and neither is its row.
    const legacy = new DatabaseSync(database.path);
    removeProviderHistorySchema(legacy);
    legacy.exec(`
      DROP TABLE projection_mcp_servers;
      DELETE FROM schema_migrations WHERE version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31);
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(migrated.listAgents().map((summary) => summary.id)).toEqual([agent.id]);
    migrated.connection
      .prepare(
        `INSERT INTO projection_mcp_servers
           (mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
            working_directory, url, headers_json, position, created_at, updated_at)
         VALUES ('mcp-1', 'Filesystem', 'stdio', 1, 'npx', '[]', '[]', '[]', '', '', '[]', 0,
           '2026-09-14T10:00:00.000Z', '2026-09-14T10:00:00.000Z')`,
      )
      .run();
    migrated.close();

    // Re-running is a no-op: the row the user already has survives a second start.
    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(reopened.connection.prepare("SELECT name FROM projection_mcp_servers").all()).toEqual([
      { name: "Filesystem" },
    ]);
    expect(reopened.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 31,
    });
    reopened.close();
  });

  it.each([false, true])(
    "adds the messaging projections to a version 24 database and keeps its data (failed attempt=%s)",
    async (failFirst) => {
      const root = await mkdtemp(join(tmpdir(), "openbot-db-v24-messaging-"));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      database.replaceAgents("agents-import", [agent], "agents.imported");
      const conversation = {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [
          {
            id: "kept-before-messaging",
            author: "user" as const,
            text: "Keep this conversation",
            status: "completed" as const,
            createdAt: "2026-09-29T12:00:00.000Z",
          },
        ],
      };
      database.persistConversation(conversation, "conversation.saved");
      database.close();

      // A version 24 database: neither the tables of migration 25 nor its marker.
      const legacy = new DatabaseSync(database.path);
      removeProviderHistorySchema(legacy);
      legacy.exec(`
        DROP TABLE projection_messaging_threads;
        DROP TABLE projection_messaging_connections;
        DELETE FROM schema_migrations WHERE version IN (25, 26, 27, 28, 29, 30, 31);
      `);
      // The squatted name is the index's: the tables use IF NOT EXISTS, so only the index can collide.
      if (failFirst) legacy.exec("CREATE TABLE messaging_threads_agent (conflict TEXT)");
      legacy.close();

      if (failFirst) {
        await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
          "migration to version 25 failed",
        );
        const rolledBack = new DatabaseSync(database.path);
        expect(
          rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'projection_messaging_%'").all(),
        ).toEqual([]);
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 25").get()).toBeUndefined();
        rolledBack.exec("DROP TABLE messaging_threads_agent");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(migrated.listAgents()).toEqual([agent]);
      expect(migrated.readConversation(agent.id, agent.threadId).messages).toEqual(conversation.messages);
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      const now = "2026-09-29T12:00:00.000Z";
      connection
        .prepare(
          `INSERT INTO projection_messaging_connections
             (connection_id, platform, workspace_id, workspace_name, enabled, orchestrator_agent_id, created_at, updated_at)
           VALUES ('connection-1', 'slack', 'T1', 'Acme', 1, ?, ?, ?)`,
        )
        .run(agent.id, now, now);
      const link = (linkId: string, threadId: string) =>
        connection
          .prepare(
            `INSERT INTO projection_messaging_threads
               (link_id, connection_id, agent_id, platform_channel_id, thread_key, is_direct, thread_id, title,
                created_at, updated_at)
             VALUES (?, 'connection-1', ?, 'C1', ?, 0, ?, 'Slack thread', ?, ?)`,
          )
          .run(linkId, agent.id, linkId, threadId, now, now);
      link("link-1", agent.threadId);
      expect(() => link("link-2", "missing-thread")).toThrow(/FOREIGN KEY constraint failed/u);
      migrated.close();

      // A second start runs nothing and keeps the row.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.connection.prepare("SELECT link_id FROM projection_messaging_threads").all()).toEqual([
        { link_id: "link-1" },
      ]);
      reopened.close();
    },
  );

  it("moves a saved server off the Computer Use name and keeps what the user configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-v20-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    // A version 20 database, written when `computer_use` was still a name a user could take. The
    // second row holds the first name the migration reaches for, so it has to reach further.
    const legacy = new DatabaseSync(database.path);
    removeProviderHistorySchema(legacy);
    legacy.exec(`
      INSERT INTO projection_mcp_servers
        (mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
         working_directory, url, headers_json, position, created_at, updated_at)
      VALUES
        ('mcp-1', 'computer_use', 'stdio', 1, 'my-driver', '["--serve"]', '[]', '[]', '', '', '[]', 0,
         '2026-09-14T10:00:00.000Z', '2026-09-14T10:00:00.000Z'),
        ('mcp-2', 'computer_use_saved', 'stdio', 1, 'other', '[]', '[]', '[]', '', '', '[]', 1,
         '2026-09-14T10:00:00.000Z', '2026-09-14T10:00:00.000Z');
      DELETE FROM schema_migrations WHERE version IN (21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31);
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare("SELECT name, command, args_json, enabled FROM projection_mcp_servers ORDER BY position")
        .all(),
    ).toEqual([
      { name: "computer_use_saved_2", command: "my-driver", args_json: '["--serve"]', enabled: 1 },
      { name: "computer_use_saved", command: "other", args_json: "[]", enabled: 1 },
    ]);
    migrated.close();

    // Running again renames nothing: the name is free now, so a second start leaves the row alone.
    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(reopened.connection.prepare("SELECT name FROM projection_mcp_servers ORDER BY position").all()).toEqual([
      { name: "computer_use_saved_2" },
      { name: "computer_use_saved" },
    ]);
    reopened.close();
  });

  it("adds post-v4 agent memory and routine projections", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-v4-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.exec(`
      DROP TABLE projection_routine_runs;
      DROP TABLE projection_routine_triggers;
      DROP TABLE projection_agent_routines;
      DROP TABLE projection_agent_memories;
      DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (4, '2026-08-20T10:00:00.000Z');
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    const tables = migrated.connection
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (
           'projection_agent_memories', 'projection_agent_routines',
           'projection_routine_triggers', 'projection_routine_runs'
         ) ORDER BY name`,
      )
      .all();
    expect(tables).toEqual([
      { name: "projection_agent_memories" },
      { name: "projection_agent_routines" },
      { name: "projection_routine_runs" },
      { name: "projection_routine_triggers" },
    ]);
    expect(migrated.connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 4 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
    ]);
    migrated.close();
  });

  it("migrates legacy reactions to user-owned rows and permits another actor", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-reactions-v7-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeReactionsToV7(legacy);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare(
          "SELECT actor_kind, actor_agent_id FROM projection_reactions WHERE agent_id = 'chief' AND message_id = 'message-1'",
        )
        .get(),
    ).toEqual({ actor_kind: "user", actor_agent_id: "" });
    expect(() =>
      migrated.connection
        .prepare(
          `INSERT INTO projection_reactions (
             agent_id, message_id, emoji, actor_kind, actor_agent_id, updated_at, last_event_sequence
           ) VALUES ('chief', 'message-1', '🎉', 'agent', 'chief', '2026-08-20T10:01:00.000Z', 2)`,
        )
        .run(),
    ).not.toThrow();
    migrated.close();
  });

  it("rolls back a failed baseline migration and succeeds on retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-rollback-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeReactionsToV7(legacy);
    legacy.exec("CREATE TABLE projection_reactions_v8 (blocker TEXT)");
    legacy.close();

    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 8 failed");

    const rolledBack = new DatabaseSync(database.path);
    expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 8").get()).toBeUndefined();
    expect(rolledBack.prepare("PRAGMA table_info(projection_reactions)").all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "actor_kind" })]),
    );
    rolledBack.exec("DROP TABLE projection_reactions_v8");
    rolledBack.close();

    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(retried.connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
    ]);
    retried.close();
  });

  it("deactivates existing provider sessions when reaction guidance changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-runtime-v9-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "legacy-tool-session",
      model: "gpt-5.6-luna",
      effort: "medium",
    });
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.prepare("DELETE FROM schema_migrations WHERE version >= 10").run();
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(migrated.activeProviderSession(agent.threadId, "codex")).toBeNull();
    expect(migrated.listProviderSessions(agent.threadId)).toEqual([
      expect.objectContaining({ externalSessionId: "legacy-tool-session", state: "inactive" }),
    ]);
    migrated.close();
  });

  it("deactivates existing provider sessions when response attachment tools are added", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-runtime-v11-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "session-without-response-attachments",
      model: "gpt-5.6-luna",
      effort: "medium",
    });
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.prepare("DELETE FROM schema_migrations WHERE version >= 11").run();
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(migrated.activeProviderSession(agent.threadId, "codex")).toBeNull();
    expect(migrated.listProviderSessions(agent.threadId)).toEqual([
      expect.objectContaining({
        externalSessionId: "session-without-response-attachments",
        state: "inactive",
      }),
    ]);
    migrated.close();
  });

  it("rolls back a failed response attachment session refresh and succeeds on retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-runtime-v11-rollback-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.bindProviderSession({
      threadId: agent.threadId,
      provider: "codex",
      externalSessionId: "session-before-failed-refresh",
      model: "gpt-5.6-luna",
      effort: "medium",
    });
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.exec(`
      DELETE FROM schema_migrations WHERE version >= 11;
      CREATE TRIGGER reject_session_refresh
      BEFORE UPDATE OF state ON projection_provider_sessions
      BEGIN
        SELECT RAISE(ABORT, 'blocked session refresh');
      END;
    `);
    legacy.close();

    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 11 failed");
    const rolledBack = new DatabaseSync(database.path);
    expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 11").get()).toBeUndefined();
    expect(
      rolledBack
        .prepare("SELECT external_session_id, state FROM projection_provider_sessions WHERE thread_id = ?")
        .get(agent.threadId),
    ).toEqual({ external_session_id: "session-before-failed-refresh", state: "active" });
    rolledBack.exec("DROP TRIGGER reject_session_refresh");
    rolledBack.close();

    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(retried.activeProviderSession(agent.threadId, "codex")).toBeNull();
    expect(retried.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 11").get()).toEqual({
      applied: 1,
    });
    retried.close();
  });

  it("keeps an agent's reaction attributed to that agent across the actor column rename", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-reactions-v12-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeToV11(legacy);
    legacy.exec(`
      INSERT INTO projection_reactions (
        agent_id, message_id, emoji, actor_kind, actor_bot_id, updated_at, last_event_sequence
      ) VALUES
        ('chief', 'message-1', '👍', 'bot', 'helper', '2026-08-20T10:00:00.000Z', 1),
        ('chief', 'message-1', '🎉', 'user', '', '2026-08-20T10:00:01.000Z', 2);
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(
      migrated.connection
        .prepare("SELECT emoji, actor_kind, actor_agent_id FROM projection_reactions ORDER BY last_event_sequence")
        .all(),
    ).toEqual([
      { emoji: "👍", actor_kind: "agent", actor_agent_id: "helper" },
      { emoji: "🎉", actor_kind: "user", actor_agent_id: "" },
    ]);
    migrated.close();
  });

  it("rolls back a failed reaction actor rename and succeeds on retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-reactions-rollback-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeToV11(legacy);
    legacy.exec(`
      INSERT INTO projection_reactions (
        agent_id, message_id, emoji, actor_kind, actor_bot_id, updated_at, last_event_sequence
      ) VALUES ('chief', 'message-1', '\u{1F44D}', 'bot', 'helper', '2026-08-20T10:00:00.000Z', 1);
    `);
    // This migration rebuilds the reaction table and rewrites the actor kind inside the copy, and it runs
    // with foreign keys on so a real violation surfaces rather than hiding. The blocker is a child row
    // pointing at the reaction under its pre-rename actor kind, so the rebuild orphans it and the
    // migration throws after it has already written the new table.
    legacy.exec(`
      CREATE TABLE blocker (
        agent_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_bot_id TEXT NOT NULL,
        FOREIGN KEY(agent_id, message_id, actor_kind, actor_bot_id)
          REFERENCES projection_reactions(agent_id, message_id, actor_kind, actor_bot_id)
      );
      INSERT INTO blocker VALUES ('chief', 'message-1', 'bot', 'helper');
    `);
    legacy.close();

    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 12 failed");

    const rolledBack = new DatabaseSync(database.path);
    expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 12").get()).toBeUndefined();
    expect(rolledBack.prepare("SELECT actor_kind, actor_bot_id FROM projection_reactions").all()).toEqual([
      { actor_kind: "bot", actor_bot_id: "helper" },
    ]);
    rolledBack.exec("DROP TABLE blocker");
    rolledBack.close();

    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(retried.connection.prepare("SELECT actor_kind, actor_agent_id FROM projection_reactions").all()).toEqual([
      { actor_kind: "agent", actor_agent_id: "helper" },
    ]);
    retried.close();
  });

  it("rewrites agent ids without losing a thread, its messages, or its hosted-site history", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-ids-v13-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacyId = "bot-2f1c9a44-1d2e-4a7b-9c30-5e6f7a8b9c0d";
    const agentId = "agent-2f1c9a44-1d2e-4a7b-9c30-5e6f7a8b9c0d";
    const legacyWorkspace = `/Users/dev/OpenBot/Agents/${legacyId}`;
    const workspace = `/Users/dev/OpenBot/Agents/${agentId}`;
    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeToV11(legacy);
    seedLegacyAgent(legacy, legacyId, legacyWorkspace);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());

    expect(migrated.connection.prepare("SELECT agent_id, thread_id FROM projection_agents").get()).toEqual({
      agent_id: agentId,
      thread_id: `openbot-thread-${agentId}`,
    });
    expect(
      migrated.connection
        .prepare("SELECT json_extract(agent_json, '$.workspacePath') AS path FROM projection_agents")
        .get(),
    ).toEqual({ path: workspace });
    expect(migrated.connection.prepare("SELECT thread_id, message_id FROM projection_thread_messages").get()).toEqual({
      thread_id: `openbot-thread-${agentId}`,
      message_id: "message-1",
    });
    // A message that quoted the old workspace path points at where that workspace lives now.
    expect(
      migrated.connection
        .prepare("SELECT json_extract(message_json, '$.text') AS text FROM projection_thread_messages")
        .get(),
    ).toEqual({ text: `Wrote ${workspace}/index.html` });
    // `aggregate_id` carries no foreign key, so a row missed here would be silently lost history, and the
    // marker command id is compared against a string rebuilt from the agent id, so both have to move.
    expect(
      migrated.connection
        .prepare(
          "SELECT aggregate_id, command_id FROM orchestration_events WHERE event_type = 'hosted-site.terminal-pending'",
        )
        .get(),
    ).toEqual({
      aggregate_id: agentId,
      command_id: `hosted-site-terminal-pending:${agentId}:operation-1:succeeded`,
    });
    expect(migrated.pendingHostedSiteTerminalEvents()).toEqual([
      expect.objectContaining({
        agentId,
        markerCommandId: `hosted-site-event:${agentId}:operation-1:succeeded`,
      }),
    ]);
    // The seed is the input to the function that draws the face, not an identifier. Rewriting it with the
    // id gives every pre-rename agent a different face on upgrade, in the projection and in the events a
    // replay would rebuild that projection from.
    expect(
      migrated.connection
        .prepare("SELECT json_extract(agent_json, '$.avatarSeed') AS seed FROM projection_agents")
        .get(),
    ).toEqual({ seed: legacyId });
    expect(
      migrated.connection
        .prepare(
          "SELECT json_extract(payload_json, '$.agents[0].avatarSeed') AS seed, json_extract(payload_json, '$.agents[0].id') AS id FROM orchestration_events WHERE event_type = 'agents.replaced'",
        )
        .get(),
    ).toEqual({ seed: legacyId, id: agentId });
    // A memory is the only free text this database indexes, under `UNIQUE(agent_id, normalized_text)`. These
    // two say the same sentence in the two spellings, so rewriting one would duplicate the other: aborting
    // locks the user out of a migration that has no backup, and collapsing the pair discards a record with
    // its own origin and timestamps. Both survive with the sentence as written, both still the agent's own.
    expect(
      migrated.connection.prepare("SELECT agent_id, text FROM projection_agent_memories ORDER BY text").all(),
    ).toEqual([
      { agent_id: agentId, text: `remember ${agentId} deploys` },
      { agent_id: agentId, text: `remember ${legacyId} deploys` },
    ]);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // v13 moves the id values and leaves the key names, because rewriting a key by text substitution would
    // also edit a message quoting it. So the released spellings arrive at the reader, and the reader has to
    // answer with the message rather than with "Invalid conversation message." -- which is the whole page,
    // not one message, for anyone whose agents ever wrote to each other.
    const page = migrated.readConversationPage(agentId, `openbot-thread-${agentId}`);
    expect(page.messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        senderAgentId: agentId,
        exchange: expect.objectContaining({
          senderAgentId: agentId,
          recipientAgentIds: ["helper"],
          deliveries: [expect.objectContaining({ recipientAgentId: "helper" })],
        }),
        reactions: [{ emoji: "\u{1F44D}", actor: { kind: "agent", agentId } }],
      }),
    ]);
    migrated.close();
  });

  it("rolls back a failed agent id rewrite and succeeds on retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-ids-rollback-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const legacyId = "bot-6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";
    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeToV11(legacy);
    seedLegacyAgent(legacy, legacyId, `/Users/dev/OpenBot/Bots/${legacyId}`);
    // This migration rewrites every text column in the database with foreign keys switched off, which is
    // the widest blast radius of any migration here and the one that runs on a file with no backup. The
    // blocker makes it throw partway, once the substitution has already written rows.
    legacy.exec("CREATE TABLE blocker (value TEXT CHECK(value NOT LIKE 'agent-%'))");
    legacy.prepare("INSERT INTO blocker (value) VALUES (?)").run(legacyId);
    legacy.close();

    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 13 failed");

    const rolledBack = new DatabaseSync(database.path);
    expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 13").get()).toBeUndefined();
    expect(rolledBack.prepare("SELECT agent_id FROM projection_agents").all()).toEqual([{ agent_id: legacyId }]);
    expect(rolledBack.prepare("SELECT thread_id FROM projection_thread_messages").all()).toEqual([
      { thread_id: `openbot-thread-${legacyId}` },
    ]);
    rolledBack.exec("DROP TABLE blocker");
    rolledBack.close();

    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(retried.connection.prepare("SELECT agent_id FROM projection_agents").all()).toEqual([
      { agent_id: `agent-${legacyId.slice("bot-".length)}` },
    ]);
    expect(retried.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    retried.close();
  });

  it("leaves an agent id the application did not mint alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-ids-custom-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    // `bot-` is not proof of a generated id, and neither is a UUID after it. `bot-research` is a name a
    // user or an imported `bots.json` chose; `bot-<uuid>` is one `getOrCreate` will accept from any caller.
    // Either can be sitting beside the `agent-` spelling this migration would rename it to, and renaming
    // one onto the other is a primary-key collision the substitution resolves by dropping a row -- so an
    // agent nobody touched disappears on upgrade.
    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    downgradeToV11(legacy);
    seedLegacyAgent(legacy, "bot-research", "/Users/dev/OpenBot/Agents/bot-research");
    seedLegacyAgent(legacy, "agent-research", "/Users/dev/OpenBot/Agents/agent-research");
    seedLegacyAgent(legacy, "bot-8c41d0f2-6b5a-4e93-8d17-2a0b3c4d5e6f", "/Users/dev/OpenBot/Agents/pair-legacy");
    seedLegacyAgent(legacy, "agent-8c41d0f2-6b5a-4e93-8d17-2a0b3c4d5e6f", "/Users/dev/OpenBot/Agents/pair");
    // And the rename travels as a text substitution, so an id that *contains* a generated one is caught by
    // it: rewriting `bot-<uuid>` inside `bot-<uuid>-copy` renames a second agent nobody asked about, onto
    // an id its neighbour already holds -- which the row-level conflict resolution settles by deleting one
    // of them. Three agents in, three agents out.
    seedLegacyAgent(legacy, "bot-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607", "/Users/dev/OpenBot/Agents/prefix");
    seedLegacyAgent(legacy, "bot-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607-copy", "/Users/dev/OpenBot/Agents/copy");
    seedLegacyAgent(legacy, "agent-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607-copy", "/Users/dev/OpenBot/Agents/twin");
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());

    expect(migrated.connection.prepare("SELECT agent_id FROM projection_agents ORDER BY agent_id").all()).toEqual([
      { agent_id: "agent-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607-copy" },
      { agent_id: "agent-8c41d0f2-6b5a-4e93-8d17-2a0b3c4d5e6f" },
      { agent_id: "agent-research" },
      { agent_id: "bot-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607" },
      { agent_id: "bot-1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607-copy" },
      { agent_id: "bot-8c41d0f2-6b5a-4e93-8d17-2a0b3c4d5e6f" },
      { agent_id: "bot-research" },
    ]);
    migrated.close();
  });

  it("rejects a database created by a newer application", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-newer-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const newer = new DatabaseSync(database.path);
    // One past the latest this application knows, whatever that is today.
    newer
      .prepare("INSERT INTO schema_migrations(version, applied_at) SELECT MAX(version) + 1, ? FROM schema_migrations")
      .run("2026-08-20T10:00:00.000Z");
    newer.close();

    const downgradedApp = new OpenBotDatabase(root);
    await expect(runCauseEffect(downgradedApp.initialize())).rejects.toThrow("newer than this application supports");
  });

  it("rejects modern migration history with a missing baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 8").run();
    incomplete.close();

    const reopened = new OpenBotDatabase(root);
    await expect(runCauseEffect(reopened.initialize())).rejects.toThrow("migration history is missing version 8");
  });

  it("widens the provider-session constraint for Grok without losing Codex or Claude sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-provider-v6-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    if (!agent.threadId) throw new Error("The test agent has no thread.");
    const threadId = agent.threadId;
    database.replaceAgents("agents-import", [agent], "agents.imported");
    database.bindProviderSession({
      threadId,
      provider: "codex",
      externalSessionId: "codex-session",
      model: "gpt-5.4",
      effort: "medium",
    });
    database.bindProviderSession({
      threadId,
      provider: "claude",
      externalSessionId: "claude-session",
      model: "claude-opus-5",
      effort: "high",
    });
    database.close();

    const legacy = new DatabaseSync(database.path);
    removeSchemaAfterVersion14(legacy);
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_v6 (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude')),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_v6 SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_v6 RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (6, '2026-08-20T10:00:00.000Z');
      PRAGMA foreign_keys = ON;
    `);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(migrated.listProviderSessions(threadId).map((session) => session.provider)).toEqual(["codex", "claude"]);
    const table = migrated.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projection_provider_sessions'")
      .get();
    // A pre-v8 database goes through migrations 8, 17, 22, 23, 24, 26 and 28 in one start, and 28 removes
    // the provider CHECK that the others widen.
    expect(table).toMatchObject({ sql: expect.not.stringContaining("CHECK(provider") });
    expect(() =>
      migrated.bindProviderSession({
        threadId,
        provider: "grok",
        externalSessionId: "grok-session",
        model: "grok-4.5",
        effort: "xhigh",
      }),
    ).not.toThrow();
    migrated.close();
  });

  it.each([false, true])(
    "widens the provider-session constraint without losing data (failed attempt=%s)",
    async (failFirst) => {
      const root = await mkdtemp(join(tmpdir(), "openbot-db-provider-v16-"));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      database.bindProviderSession({
        threadId,
        provider: "codex",
        externalSessionId: "codex-session",
        model: "gpt-5.4",
        effort: "medium",
      });
      database.bindProviderSession({
        threadId,
        provider: "claude",
        externalSessionId: "claude-session",
        model: "claude-opus-5",
        effort: "high",
      });
      const codexSessionId = database
        .listProviderSessions(threadId)
        .find((session) => session.provider === "codex")?.id;
      if (!codexSessionId) throw new Error("The codex provider session was not stored.");
      // A turn points at the session the rebuild drops. With foreign keys on, the DROP would fire
      // ON DELETE SET NULL and blank this column on every turn in the database.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:05.000Z', 1)`,
        )
        .run(threadId, codexSessionId);
      database.close();

      // A v16 database: the shipped three-provider constraint, and the migration ledger stamped one short.
      const legacy = new DatabaseSync(database.path);
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version >= 17;
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_v16 (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok')),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_v16 SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_v16 RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_17 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 17 BEGIN SELECT RAISE(ABORT, 'reject migration 17'); END;
    `);
      legacy.close();

      if (failFirst) {
        const failed = new OpenBotDatabase(root);
        await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 17 failed");
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: codexSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 17").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.not.stringContaining("'opencode'") });
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_17");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      expect(migrated.connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(migrated.connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(
        migrated.connection.prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 17").get(),
      ).toEqual({ applied: 1 });
      expect(migrated.listProviderSessions(threadId).map((session) => session.provider)).toEqual(["codex", "claude"]);
      expect(
        migrated.connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: codexSessionId });
      expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const table = migrated.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projection_provider_sessions'")
        .get();
      // A v16 database goes through migrations 17, 22, 23, 24, 26 and 28 in one start, and 28 removes the
      // provider CHECK that the others widen.
      expect(table).toMatchObject({ sql: expect.not.stringContaining("CHECK(provider") });
      // Written through SQL, not `bindProviderSession`: the table itself must accept the row.
      expect(() =>
        migrated.connection
          .prepare(
            `INSERT INTO projection_provider_sessions
             (id, thread_id, provider, external_session_id, model, effort, state,
              created_at, updated_at, resume_cursor, last_event_sequence)
           VALUES (?, ?, 'opencode', 'opencode-session', 'opencode/big-pickle', 'medium', 'active', ?, ?, NULL, 0)`,
          )
          .run("session-opencode", threadId, "2026-08-20T10:00:10.000Z", "2026-08-20T10:00:10.000Z"),
      ).not.toThrow();
      migrated.close();
    },
  );

  it.each([false, true])(
    "widens the provider-session constraint for Antigravity without losing data (failed attempt=%s)",
    async (failFirst) => {
      const root = await mkdtemp(join(tmpdir(), "openbot-db-provider-v21-"));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      for (const [provider, model] of [
        ["codex", "gpt-5.4"],
        ["claude", "claude-opus-5"],
        ["grok", "grok-4.5"],
        ["opencode", "opencode/big-pickle"],
      ] as const) {
        database.bindProviderSession({
          threadId,
          provider,
          externalSessionId: `${provider}-session`,
          model,
          effort: "medium",
          resumeCursor: `${provider}-cursor`,
        });
      }
      const opencodeSessionId = database
        .listProviderSessions(threadId)
        .find((session) => session.provider === "opencode")?.id;
      if (!opencodeSessionId) throw new Error("The opencode provider session was not stored.");
      // With foreign keys on, the DROP in the rebuild would set this column to NULL.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:05.000Z', 1)`,
        )
        .run(threadId, opencodeSessionId);
      database.close();

      // A v21 database: the four-provider constraint that migration 17 wrote, and no marker for 22.
      const legacy = new DatabaseSync(database.path);
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version >= 22;
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_v21 (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode')),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_v21 SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_v21 RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      const originalIndexes = legacy.prepare("PRAGMA index_list(projection_provider_sessions)").all();
      const originalIndexColumns = legacy.prepare("PRAGMA index_info(provider_sessions_thread)").all();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_22 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 22 BEGIN SELECT RAISE(ABORT, 'reject migration 22'); END;
    `);
      legacy.close();

      if (failFirst) {
        const failed = new OpenBotDatabase(root);
        await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 22 failed");
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: opencodeSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 22").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.not.stringContaining("'antigravity'") });
        expect(
          rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v22'").get(),
        ).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_22");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      expect(migrated.connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(migrated.connection.prepare("PRAGMA index_list(projection_provider_sessions)").all()).toEqual(
        originalIndexes,
      );
      expect(migrated.connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(
        originalIndexColumns,
      );
      expect(migrated.connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrated.connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(
        migrated.connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: opencodeSessionId });
      const antigravity = migrated.bindProviderSession({
        threadId,
        provider: "antigravity",
        externalSessionId: "antigravity-session",
        model: "gemini-3-pro",
        effort: "medium",
      });
      expect(migrated.activeProviderSession(threadId, "antigravity")).toEqual(antigravity);
      expectUnknownProviderRejected(migrated, threadId);
      migrated.close();

      // A second start runs nothing: the Antigravity session and the older sessions stay.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.listProviderSessions(threadId).map((session) => session.provider)).toEqual([
        "codex",
        "claude",
        "grok",
        "opencode",
        "antigravity",
      ]);
      reopened.close();
    },
  );

  // Every shipped provider-session table: the v16 baseline (three providers), v17 to v21 (the same
  // four-provider table), and v22 (five). Migration 23 must keep every row, the turn link, the index
  // and the UNIQUE constraint, and only then accept `acp`.
  it.each([
    { source: 16, providers: ["codex", "claude", "grok"], failFirst: false },
    { source: 21, providers: ["codex", "claude", "grok", "opencode"], failFirst: false },
    { source: 22, providers: ["codex", "claude", "grok", "opencode", "antigravity"], failFirst: false },
    { source: 22, providers: ["codex", "claude", "grok", "opencode", "antigravity"], failFirst: true },
  ] as const)(
    "widens the provider-session constraint for custom agents from v$source without losing data (failed attempt=$failFirst)",
    async ({ source, providers, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-provider-v${source}-acp-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      for (const provider of providers) {
        database.bindProviderSession({
          threadId,
          provider,
          externalSessionId: `${provider}-session`,
          model: `${provider}-model`,
          effort: "medium",
          resumeCursor: `${provider}-cursor`,
        });
      }
      const linkedSessionId = database.listProviderSessions(threadId).at(-1)?.id;
      if (!linkedSessionId) throw new Error("No provider session was stored.");
      // With foreign keys on, the DROP in the rebuild would set this column to NULL.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-09-27T10:00:00.000Z', '2026-09-27T10:00:05.000Z', 1)`,
        )
        .run(threadId, linkedSessionId);
      database.close();

      const legacy = new DatabaseSync(database.path);
      const list = providers.map((provider) => `'${provider}'`).join(", ");
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version > ${source};
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_shipped (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN (${list})),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_shipped SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_shipped RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      const originalIndexes = legacy.prepare("PRAGMA index_list(projection_provider_sessions)").all();
      const originalIndexColumns = legacy.prepare("PRAGMA index_info(provider_sessions_thread)").all();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_23 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 23 BEGIN SELECT RAISE(ABORT, 'reject migration 23'); END;
    `);
      legacy.close();

      if (failFirst) {
        const failed = new OpenBotDatabase(root);
        await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 23 failed");
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: linkedSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 23").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.not.stringContaining("'acp'") });
        expect(
          rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v23'").get(),
        ).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_23");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(connection.prepare("PRAGMA index_list(projection_provider_sessions)").all()).toEqual(originalIndexes);
      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(
        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: linkedSessionId });
      const custom = migrated.bindProviderSession({
        threadId,
        provider: "acp",
        externalSessionId: "goose:acp-session",
        model: "goose/default",
        effort: "medium",
      });
      expect(migrated.activeProviderSession(threadId, "acp")).toEqual(custom);
      const insert = (id: string, provider: string, externalSessionId: string) =>
        connection
          .prepare(
            `INSERT INTO projection_provider_sessions
             (id, thread_id, provider, external_session_id, model, effort, state,
              created_at, updated_at, resume_cursor, last_event_sequence)
           VALUES (?, ?, ?, ?, 'model', 'medium', 'inactive', ?, ?, NULL, 0)`,
          )
          .run(id, threadId, provider, externalSessionId, "2026-09-27T10:00:10.000Z", "2026-09-27T10:00:10.000Z");
      expectUnknownProviderRejected(migrated, threadId);
      expect(() => insert("session-duplicate", "acp", "goose:acp-session")).toThrow(/UNIQUE constraint failed/u);
      migrated.close();

      // A second start runs nothing: the table already allows `acp`, so the rebuild is skipped.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.listProviderSessions(threadId).map((session) => session.provider)).toEqual([...providers, "acp"]);
      reopened.close();
    },
  );

  it("refuses a v23 database whose history has lost migration 22", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-22-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 22").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 22",
    );
  });

  // Every shipped provider-session table: the v16 baseline (three providers), v17 to v21 (four), v22
  // (five) and v23 (six). Migration 24 must keep every row, the turn link, the index and the UNIQUE
  // constraint, and only then accept `cursor`.
  it.each([
    { source: 16, providers: ["codex", "claude", "grok"], failFirst: false },
    { source: 21, providers: ["codex", "claude", "grok", "opencode"], failFirst: false },
    { source: 22, providers: ["codex", "claude", "grok", "opencode", "antigravity"], failFirst: false },
    { source: 23, providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp"], failFirst: false },
    { source: 23, providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp"], failFirst: true },
  ] as const)(
    "widens the provider-session constraint for Cursor from v$source without losing data (failed attempt=$failFirst)",
    async ({ source, providers, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-provider-v${source}-cursor-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      for (const provider of providers) {
        database.bindProviderSession({
          threadId,
          provider,
          externalSessionId: `${provider}-session`,
          model: `${provider}-model`,
          effort: "medium",
          resumeCursor: `${provider}-cursor`,
        });
      }
      const linkedSessionId = database.listProviderSessions(threadId).at(-1)?.id;
      if (!linkedSessionId) throw new Error("No provider session was stored.");
      // With foreign keys on, the DROP in the rebuild would set this column to NULL.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-09-30T10:00:00.000Z', '2026-09-30T10:00:05.000Z', 1)`,
        )
        .run(threadId, linkedSessionId);
      database.close();

      const legacy = new DatabaseSync(database.path);
      const list = providers.map((provider) => `'${provider}'`).join(", ");
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version > ${source};
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_shipped (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN (${list})),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_shipped SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_shipped RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      const originalIndexes = legacy.prepare("PRAGMA index_list(projection_provider_sessions)").all();
      const originalIndexColumns = legacy.prepare("PRAGMA index_info(provider_sessions_thread)").all();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_24 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 24 BEGIN SELECT RAISE(ABORT, 'reject migration 24'); END;
    `);
      legacy.close();

      if (failFirst) {
        const failed = new OpenBotDatabase(root);
        await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 24 failed");
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: linkedSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 24").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.not.stringContaining("'cursor'") });
        expect(
          rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v24'").get(),
        ).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_24");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(connection.prepare("PRAGMA index_list(projection_provider_sessions)").all()).toEqual(originalIndexes);
      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(
        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: linkedSessionId });
      const cursor = migrated.bindProviderSession({
        threadId,
        provider: "cursor",
        externalSessionId: "cursor-session",
        model: "auto",
        effort: "medium",
      });
      expect(migrated.activeProviderSession(threadId, "cursor")).toEqual(cursor);
      const insert = (id: string, provider: string, externalSessionId: string) =>
        connection
          .prepare(
            `INSERT INTO projection_provider_sessions
             (id, thread_id, provider, external_session_id, model, effort, state,
              created_at, updated_at, resume_cursor, last_event_sequence)
           VALUES (?, ?, ?, ?, 'model', 'medium', 'inactive', ?, ?, NULL, 0)`,
          )
          .run(id, threadId, provider, externalSessionId, "2026-09-30T10:00:10.000Z", "2026-09-30T10:00:10.000Z");
      expectUnknownProviderRejected(migrated, threadId);
      expect(() => insert("session-duplicate", "cursor", "cursor-session")).toThrow(/UNIQUE constraint failed/u);
      migrated.close();

      // A second start runs nothing: the table already allows `cursor`, so the rebuild is skipped.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.listProviderSessions(threadId).map((session) => session.provider)).toEqual([
        ...providers,
        "cursor",
      ]);
      reopened.close();
    },
  );

  it("refuses a v24 database whose history has lost migration 23", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-23-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 23").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 23",
    );
  });

  // Every shipped provider-session table: the v16 baseline (three providers), v17 to v21 (four), v22
  // (five), v23 (six) and v24 to v25 (seven). Migration 26 must keep every row, the turn link, the
  // index and the UNIQUE constraint, and only then accept `cline`.
  it.each([
    { source: 16, providers: ["codex", "claude", "grok"], failFirst: false },
    { source: 21, providers: ["codex", "claude", "grok", "opencode"], failFirst: false },
    { source: 22, providers: ["codex", "claude", "grok", "opencode", "antigravity"], failFirst: false },
    { source: 23, providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp"], failFirst: false },
    {
      source: 24,
      providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor"],
      failFirst: false,
    },
    {
      source: 25,
      providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor"],
      failFirst: false,
    },
    { source: 25, providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor"], failFirst: true },
  ] as const)(
    "widens the provider-session constraint for Cline from v$source without losing data (failed attempt=$failFirst)",
    async ({ source, providers, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-provider-v${source}-cline-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      for (const provider of providers) {
        database.bindProviderSession({
          threadId,
          provider,
          externalSessionId: `${provider}-session`,
          model: `${provider}-model`,
          effort: "medium",
          resumeCursor: `${provider}-cursor`,
        });
      }
      const linkedSessionId = database.listProviderSessions(threadId).at(-1)?.id;
      if (!linkedSessionId) throw new Error("No provider session was stored.");
      // With foreign keys on, the DROP in the rebuild would set this column to NULL.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-09-30T10:00:00.000Z', '2026-09-30T10:00:05.000Z', 1)`,
        )
        .run(threadId, linkedSessionId);
      database.close();

      const legacy = new DatabaseSync(database.path);
      const list = providers.map((provider) => `'${provider}'`).join(", ");
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version > ${source};
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_shipped (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN (${list})),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_shipped SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_shipped RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      const originalIndexes = legacy.prepare("PRAGMA index_list(projection_provider_sessions)").all();
      const originalIndexColumns = legacy.prepare("PRAGMA index_info(provider_sessions_thread)").all();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_26 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 26 BEGIN SELECT RAISE(ABORT, 'reject migration 26'); END;
    `);
      legacy.close();

      if (failFirst) {
        const failed = new OpenBotDatabase(root);
        await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 26 failed");
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: linkedSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 26").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.not.stringContaining("'cline'") });
        expect(
          rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v26'").get(),
        ).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_26");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(connection.prepare("PRAGMA index_list(projection_provider_sessions)").all()).toEqual(originalIndexes);
      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(
        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: linkedSessionId });
      const cline = migrated.bindProviderSession({
        threadId,
        provider: "cline",
        externalSessionId: "1790935203755_bvm7e_cli",
        model: "anthropic/claude-sonnet-5",
        effort: "medium",
      });
      expect(migrated.activeProviderSession(threadId, "cline")).toEqual(cline);
      const insert = (id: string, provider: string, externalSessionId: string) =>
        connection
          .prepare(
            `INSERT INTO projection_provider_sessions
             (id, thread_id, provider, external_session_id, model, effort, state,
              created_at, updated_at, resume_cursor, last_event_sequence)
           VALUES (?, ?, ?, ?, 'model', 'medium', 'inactive', ?, ?, NULL, 0)`,
          )
          .run(id, threadId, provider, externalSessionId, "2026-09-30T10:00:10.000Z", "2026-09-30T10:00:10.000Z");
      expectUnknownProviderRejected(migrated, threadId);
      expect(() => insert("session-duplicate", "cline", "1790935203755_bvm7e_cli")).toThrow(
        /UNIQUE constraint failed/u,
      );
      migrated.close();

      // A second start runs nothing: the table already allows `cline`, so the rebuild is skipped.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.listProviderSessions(threadId).map((session) => session.provider)).toEqual([
        ...providers,
        "cline",
      ]);
      reopened.close();
    },
  );

  it("refuses a v26 database whose history has lost migration 25", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-25-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 25").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 25",
    );
  });

  it("refuses a v27 database whose history has lost migration 26", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-26-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 26").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 26",
    );
  });

  // The agent routine table is the v8 baseline's and the channel one is migration 19's, and neither
  // changed before migration 27. So v19 is the oldest shipped database with both, and v26 the newest.
  it.each([
    { source: 19, failFirst: false },
    { source: 26, failFirst: false },
    { source: 26, failFirst: true },
  ])(
    "adds the routine limit policy from v$source without losing a routine (failed attempt=$failFirst)",
    async ({ source, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-routine-policy-v${source}-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      database.replaceAgents("agents-import", [agent], "agents.imported");
      const now = new Date("2026-10-05T07:00:00.000Z");
      const schedule = { kind: "daily", time: "08:00" } as const;
      const agentRoutine = new AgentRoutineStore(database).create(
        {
          agentId: agent.id,
          name: "Morning plan",
          instruction: "Write the plan.",
          active: true,
          timezone: "Europe/Budapest",
          schedule,
        },
        now,
      );
      const channels = new ChannelStore(database);
      const channel = channels.create("channel-1", {
        name: "Operations",
        title: "Release coordination",
        instructions: "Ship the release.",
        members: [{ agentId: agent.id }],
        leadAgentId: agent.id,
      });
      channels.commit("test.channel-create", { channel, messages: [], tasks: [], assignments: [] });
      const channelRoutine = new ChannelRoutineStore(database).create(
        {
          channelId: channel.id,
          name: "Hourly brief",
          instruction: "Write the brief.",
          active: false,
          timezone: "UTC",
          schedule,
        },
        now,
      );
      database.close();

      // The shipped shape: no policy column, and no marker past the source version.
      const legacy = new DatabaseSync(database.path);
      legacy.exec(`
        ALTER TABLE projection_agent_routines DROP COLUMN limit_policy;
        ALTER TABLE projection_channel_routines DROP COLUMN limit_policy;
        DELETE FROM schema_migrations WHERE version > ${source};
      `);
      const routineRows = (db: DatabaseSync) => ({
        agent: db.prepare("SELECT * FROM projection_agent_routines ORDER BY routine_id").all(),
        channel: db.prepare("SELECT * FROM projection_channel_routines ORDER BY routine_id").all(),
        triggers: db.prepare("SELECT * FROM projection_routine_triggers ORDER BY trigger_id").all(),
        channelTriggers: db.prepare("SELECT * FROM projection_channel_routine_triggers ORDER BY trigger_id").all(),
      });
      const original = routineRows(legacy);
      expect(original.agent).toHaveLength(1);
      expect(original.channel).toHaveLength(1);
      if (failFirst)
        legacy.exec(`
        CREATE TRIGGER reject_migration_27 BEFORE INSERT ON schema_migrations
        WHEN NEW.version = 27 BEGIN SELECT RAISE(ABORT, 'reject migration 27'); END;
      `);
      legacy.close();

      if (failFirst) {
        await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
          "migration to version 27 failed",
        );
        const rolledBack = new DatabaseSync(database.path);
        expect(routineRows(rolledBack)).toEqual(original);
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 27").get()).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_27");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      const waiting = (rows: readonly object[]) => rows.map((row) => ({ ...row, limit_policy: "wait" }));
      expect(routineRows(connection)).toEqual({
        ...original,
        agent: waiting(original.agent),
        channel: waiting(original.channel),
      });
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      const agentRoutines = new AgentRoutineStore(migrated);
      expect(agentRoutines.get(agent.id, agentRoutine.id)?.limitPolicy).toBe("wait");
      expect(new ChannelRoutineStore(migrated).get(channel.id, channelRoutine.id)?.limitPolicy).toBe("wait");
      agentRoutines.update({ agentId: agent.id, routineId: agentRoutine.id, limitPolicy: "skip" }, now);
      expect(() => connection.prepare("UPDATE projection_channel_routines SET limit_policy = 'later'").run()).toThrow(
        /CHECK constraint failed/u,
      );
      migrated.close();

      // A second start runs nothing and keeps the policy the user chose.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(new AgentRoutineStore(reopened).get(agent.id, agentRoutine.id)?.limitPolicy).toBe("skip");
      reopened.close();
    },
  );

  it("refuses a v28 database whose history has lost migration 27", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-27-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 27").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 27",
    );
  });

  // Every shipped provider-session table: the v16 baseline (three providers), v17 to v21 (four), v22
  // (five), v23 (six), v24 to v25 (seven) and v26 to v27 (eight). Migration 28 must keep every row, the
  // turn link, the index, the UNIQUE and the state CHECK, and remove only the provider CHECK.
  it.each([
    { source: 16, providers: ["codex", "claude", "grok"], failFirst: false },
    { source: 21, providers: ["codex", "claude", "grok", "opencode"], failFirst: false },
    { source: 22, providers: ["codex", "claude", "grok", "opencode", "antigravity"], failFirst: false },
    { source: 23, providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp"], failFirst: false },
    {
      source: 25,
      providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor"],
      failFirst: false,
    },
    {
      source: 27,
      providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"],
      failFirst: false,
    },
    {
      source: 27,
      providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"],
      failFirst: true,
    },
  ] as const)(
    "removes the provider-session constraint from v$source without losing data (failed attempt=$failFirst)",
    async ({ source, providers, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-provider-v${source}-open-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      const threadId = agent.threadId;
      database.replaceAgents("agents-import", [agent], "agents.imported");
      for (const provider of providers) {
        database.bindProviderSession({
          threadId,
          provider,
          externalSessionId: `${provider}-session`,
          model: `${provider}-model`,
          effort: "medium",
          resumeCursor: `${provider}-cursor`,
        });
      }
      const linkedSessionId = database.listProviderSessions(threadId).at(-1)?.id;
      if (!linkedSessionId) throw new Error("No provider session was stored.");
      // With foreign keys on, the DROP in the rebuild would set this column to NULL.
      database.connection
        .prepare(
          `INSERT INTO projection_turns
           (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
         VALUES ('turn-1', ?, ?, 'completed', '2026-10-06T10:00:00.000Z', '2026-10-06T10:00:05.000Z', 1)`,
        )
        .run(threadId, linkedSessionId);
      database.close();

      const legacy = new DatabaseSync(database.path);
      const list = providers.map((provider) => `'${provider}'`).join(", ");
      legacy.exec(`
      DELETE FROM schema_migrations WHERE version > ${source};
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_shipped (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN (${list})),
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_shipped SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_shipped RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread
        ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;
    `);
      const originalSessions = legacy.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all();
      const originalIndexes = legacy.prepare("PRAGMA index_list(projection_provider_sessions)").all();
      const originalIndexColumns = legacy.prepare("PRAGMA index_info(provider_sessions_thread)").all();
      const originalEvents = legacy.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get();
      if (failFirst)
        legacy.exec(`
      CREATE TRIGGER reject_migration_28 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 28 BEGIN SELECT RAISE(ABORT, 'reject migration 28'); END;
    `);
      legacy.close();

      if (failFirst) {
        await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
          "migration to version 28 failed",
        );
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
          originalSessions,
        );
        expect(
          rolledBack.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = 'turn-1'").get(),
        ).toEqual({ provider_session_id: linkedSessionId });
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 28").get()).toBeUndefined();
        expect(
          rolledBack.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
        ).toMatchObject({ sql: expect.stringContaining(`CHECK(provider IN (${list}))`) });
        expect(
          rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v28'").get(),
        ).toBeUndefined();
        expect(rolledBack.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_28");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(connection.prepare("SELECT * FROM projection_provider_sessions ORDER BY id").all()).toEqual(
        originalSessions,
      );
      expect(connection.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get()).toEqual(originalEvents);
      expect(connection.prepare("PRAGMA index_list(projection_provider_sessions)").all()).toEqual(originalIndexes);
      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(
        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),
      ).toEqual({ provider_session_id: linkedSessionId });
      expect(
        connection.prepare("SELECT sql FROM sqlite_master WHERE name = 'projection_provider_sessions'").get(),
      ).toMatchObject({ sql: expect.not.stringContaining("CHECK(provider") });
      expect(migrated.listProviderSessions(threadId).map((session) => session.provider)).toEqual(providers);
      expectUnknownProviderRejected(migrated, threadId);
      const insert = (id: string, state: string, externalSessionId: string) =>
        connection
          .prepare(
            `INSERT INTO projection_provider_sessions
             (id, thread_id, provider, external_session_id, model, effort, state,
              created_at, updated_at, resume_cursor, last_event_sequence)
           VALUES (?, ?, 'codex', ?, 'model', 'medium', ?, ?, ?, NULL, 0)`,
          )
          .run(id, threadId, externalSessionId, state, "2026-10-06T10:00:10.000Z", "2026-10-06T10:00:10.000Z");
      expect(() => insert("session-bad-state", "paused", "bad-state-session")).toThrow(/CHECK constraint failed/u);
      expect(() => insert("session-duplicate", "inactive", "codex-session")).toThrow(/UNIQUE constraint failed/u);
      const cline = migrated.bindProviderSession({
        threadId,
        provider: "cline",
        externalSessionId: "cline-after-v28",
        model: "anthropic/claude-sonnet-5",
        effort: "medium",
      });
      migrated.close();

      // A second start runs nothing and keeps the session bound after the migration.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.activeProviderSession(threadId, "cline")).toEqual(cline);
      expect(reopened.listProviderSessions(threadId)).toHaveLength(providers.length + 1);
      reopened.close();
    },
  );

  it("erases an agent's history without leaving a receipt whose events are gone", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    const createdAt = "2026-08-18T10:00:01.000Z";
    database.replaceAgents("agents:seed", [agent], "agents.replaced");
    database.dispatch(
      "agent-memory:seed",
      [{ aggregateType: "agent-memory", aggregateId: "memory-1", eventType: "agent-memory.created", payload: {} }],
      (db, sequences) => {
        db.prepare(
          `INSERT INTO projection_agent_memories
             (memory_id, agent_id, text, normalized_text, origin, source_turn_id,
              created_at, updated_at, last_event_sequence)
           VALUES ('memory-1', ?, 'remembers', 'remembers', 'manual', NULL, ?, ?, ?)`,
        ).run(agent.id, createdAt, createdAt, sequences[0] ?? 0);
        return null;
      },
    );
    database.dispatch(
      "agent-routine:seed",
      [{ aggregateType: "agent-routine", aggregateId: "routine-1", eventType: "agent-routine.created", payload: {} }],
      (db, sequences) => {
        db.prepare(
          `INSERT INTO projection_agent_routines
             (routine_id, agent_id, name, instruction, active, timezone,
              created_at, updated_at, last_event_sequence)
           VALUES ('routine-1', ?, 'Standup', 'Report status', 1, 'UTC', ?, ?, ?)`,
        ).run(agent.id, createdAt, createdAt, sequences[0] ?? 0);
        return null;
      },
    );
    database.recordPendingHostedSiteTerminalEvent({
      agentId: agent.id,
      threadId: "openbot-thread-chief",
      turnId: "turn-1",
      operationId: "operation-1",
      action: "publish",
      status: "succeeded",
      details: { siteId: "site-1", title: "Site", hostname: null, url: null },
      markerCommandId: `hosted-site-event:${agent.id}:operation-1:succeeded`,
      createdAt,
    });

    database.hardDeleteAgent("agents:delete", agent.id, agent.threadId, []);

    expect(database.listAgents()).toEqual([]);
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM projection_agent_memories").get()).toMatchObject({
      count: 0,
    });
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM projection_agent_routines").get()).toMatchObject({
      count: 0,
    });
    expect(database.pendingHostedSiteTerminalEvents()).toEqual([]);
    // An orphan receipt makes `dispatch` replay its stale result for a command that never ran.
    expect(
      database.connection
        .prepare(
          `SELECT command_id FROM orchestration_command_receipts receipt
           WHERE NOT EXISTS (
             SELECT 1 FROM orchestration_events
             WHERE orchestration_events.command_id = receipt.command_id
           )`,
        )
        .all(),
    ).toEqual([]);
    database.close();
  });

  it("refuses a v31 database whose history has lost migration 30", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-gap-30-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.close();

    const incomplete = new DatabaseSync(database.path);
    incomplete.prepare("DELETE FROM schema_migrations WHERE version = 30").run();
    incomplete.close();

    await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
      "migration history is missing version 30",
    );
  });

  // Migration 31 only adds the routine flow tables, which reference the agent routines and their
  // runs. Those tables last changed in migration 27, so v27 is the newest schema that changed them,
  // v19 the oldest that the v27 coverage above starts from, and v29 and v30 the shipped schemas of
  // v0.32.0 and v0.33.0, which this migration meets on an upgrade.
  it.each([
    { source: 19, failFirst: false },
    { source: 27, failFirst: false },
    { source: 29, failFirst: false },
    { source: 30, failFirst: true },
  ])(
    "adds the routine flow tables from v$source without losing a routine or a run (failed attempt=$failFirst)",
    async ({ source, failFirst }) => {
      const root = await mkdtemp(join(tmpdir(), `openbot-db-routine-flows-v${source}-`));
      roots.push(root);
      const database = new OpenBotDatabase(root);
      await runCauseEffect(database.initialize());
      const agent = testAgent();
      if (!agent.threadId) throw new Error("The test agent has no thread.");
      database.replaceAgents("agents-import", [agent], "agents.imported");
      const conversation = {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [
          {
            id: "kept-before-routine-flows",
            author: "user" as const,
            text: "Keep this conversation",
            status: "completed" as const,
            createdAt: "2026-10-06T07:00:00.000Z",
          },
        ],
      };
      database.persistConversation(conversation, "conversation.saved");
      const now = new Date("2026-10-06T07:00:00.000Z");
      const routines = new AgentRoutineStore(database);
      const routine = routines.create(
        {
          agentId: agent.id,
          name: "Morning brief",
          instruction: "Collect the news.",
          active: true,
          timezone: "Europe/Warsaw",
          schedule: { kind: "weekdays", time: "07:00" },
        },
        now,
      );
      const run = routines.createRun(routine, null, "manual", now.toISOString());
      database.close();

      // The shipped shape: no routine flow tables, and no marker past the source version.
      const legacy = new DatabaseSync(database.path);
      legacy.exec(`
        DROP TABLE routine_flow_steps;
        DROP TABLE routine_flow_links;
        DROP TABLE routine_flow_positions;
        ${source < 30 ? WEBHOOK_TABLES_DROP_SQL : ""}
        ${source < 29 ? PROVIDER_HISTORY_TABLES_DROP_SQL : ""}
        ${
          source < 27
            ? `ALTER TABLE projection_agent_routines DROP COLUMN limit_policy;
               ALTER TABLE projection_channel_routines DROP COLUMN limit_policy;`
            : ""
        }
        DELETE FROM schema_migrations WHERE version > ${source};
      `);
      const routineRows = (db: DatabaseSync) => ({
        routines: db
          .prepare("SELECT routine_id, agent_id, name, instruction, active FROM projection_agent_routines")
          .all(),
        triggers: db.prepare("SELECT * FROM projection_routine_triggers ORDER BY trigger_id").all(),
        runs: db.prepare("SELECT * FROM projection_routine_runs ORDER BY run_id").all(),
      });
      const original = routineRows(legacy);
      expect(original.routines).toHaveLength(1);
      expect(original.runs).toHaveLength(1);
      if (failFirst)
        legacy.exec(`
        CREATE TRIGGER reject_migration_31 BEFORE INSERT ON schema_migrations
        WHEN NEW.version = 31 BEGIN SELECT RAISE(ABORT, 'reject migration 31'); END;
      `);
      legacy.close();

      if (failFirst) {
        await expect(runCauseEffect(new OpenBotDatabase(root).initialize())).rejects.toThrow(
          "migration to version 31 failed",
        );
        const rolledBack = new DatabaseSync(database.path);
        expect(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'routine_flow_%'").all()).toEqual([]);
        expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = 31").get()).toBeUndefined();
        expect(routineRows(rolledBack)).toEqual(original);
        expect(rolledBack.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        rolledBack.exec("DROP TRIGGER reject_migration_31");
        rolledBack.close();
      }

      const migrated = new OpenBotDatabase(root);
      await runCauseEffect(migrated.initialize());
      const connection = migrated.connection;
      expect(migrated.listAgents()).toEqual([agent]);
      expect(migrated.readConversation(agent.id, agent.threadId).messages).toEqual(conversation.messages);
      expect(routineRows(connection)).toEqual(original);
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 31,
      });
      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      const stamp = now.toISOString();
      const link = (linkId: string, routineId: string) =>
        connection
          .prepare(
            `INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, created_at)
             VALUES (?, ?, ?, 'writer', ?)`,
          )
          .run(linkId, routineId, agent.id, stamp);
      const step = (stepId: string, runId: string) =>
        connection
          .prepare(
            `INSERT INTO routine_flow_steps (step_id, run_id, agent_id, input, status, created_at, updated_at)
             VALUES (?, ?, ?, 'Collect the news.', 'running', ?, ?)`,
          )
          .run(stepId, runId, agent.id, stamp, stamp);
      link("link-1", routine.id);
      step("step-1", run.id);
      expect(() => link("link-2", "missing-routine")).toThrow(/FOREIGN KEY constraint failed/u);
      expect(() => step("step-2", "missing-run")).toThrow(/FOREIGN KEY constraint failed/u);
      migrated.close();

      // A second start runs nothing and keeps the rows; deleting the routine takes its flow with it.
      const reopened = new OpenBotDatabase(root);
      await runCauseEffect(reopened.initialize());
      expect(reopened.connection.prepare("SELECT link_id FROM routine_flow_links").all()).toEqual([
        { link_id: "link-1" },
      ]);
      new AgentRoutineStore(reopened).delete(agent.id, routine.id);
      expect(reopened.connection.prepare("SELECT link_id FROM routine_flow_links").all()).toEqual([]);
      expect(reopened.connection.prepare("SELECT step_id FROM routine_flow_steps").all()).toEqual([]);
      reopened.close();
    },
  );
});

// Rebuilds the pre-v12 `projection_reactions` shape so v12, v13 and v14 run again over a fixture that
// looks the way a shipped release left it, rather than over a database that already carries their result.
function downgradeToV11(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE projection_reactions_v11 (
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user', 'bot')),
      actor_bot_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_event_sequence INTEGER NOT NULL,
      PRIMARY KEY(agent_id, message_id, actor_kind, actor_bot_id)
    );
    DROP TABLE projection_reactions;
    ALTER TABLE projection_reactions_v11 RENAME TO projection_reactions;
    DELETE FROM schema_migrations WHERE version >= 12;
  `);
}

// One agent whose id, thread, message text and hosted-site history all still spell the id `bot-<uuid>`.
function seedLegacyAgent(database: DatabaseSync, legacyId: string, workspacePath: string): void {
  const threadId = `openbot-thread-${legacyId}`;
  const agentJson = JSON.stringify({ id: legacyId, name: "Chief", threadId, workspacePath, avatarSeed: legacyId });
  const rosterJson = JSON.stringify({
    agents: [{ id: legacyId, name: "Chief", threadId, workspacePath, avatarSeed: legacyId }],
  });
  // The shape a released build persisted: the exchange between two agents and the reaction one of them
  // left spell the product agent `bot` in their keys and in the actor discriminant. v13 rewrites the id
  // values inside them and leaves the keys, so this is what a page read meets after the upgrade.
  const messageJson = JSON.stringify({
    id: "message-1",
    author: "agent",
    status: "completed",
    text: `Wrote ${workspacePath}/index.html`,
    createdAt: "2026-09-01T12:00:00.000Z",
    senderBotId: legacyId,
    exchange: {
      direction: "incoming",
      messageId: "exchange-1",
      senderBotId: legacyId,
      recipientBotIds: ["helper"],
      replyToMessageId: null,
      deliveries: [{ id: "delivery-1", recipientBotId: "helper", status: "completed", position: null, error: null }],
    },
    reactions: [{ emoji: "\u{1F44D}", actor: { kind: "bot", botId: legacyId } }],
  });
  const pendingJson = JSON.stringify({
    agentId: legacyId,
    threadId,
    turnId: "turn-1",
    operationId: "operation-1",
    action: "publish",
    status: "succeeded",
    details: {
      siteId: "site-1",
      title: "Launch page",
      hostname: "launch-page-23456789ab.openbot.site",
      url: "https://launch-page-23456789ab.openbot.site",
    },
    markerCommandId: `hosted-site-event:${legacyId}:operation-1:succeeded`,
    createdAt: "2026-09-01T12:00:00.000Z",
  });

  // Two memories of one agent that quote the id in each spelling. Rewriting the first makes it equal to the
  // second under `UNIQUE(agent_id, normalized_text)`, which is a duplicated sentence, not a reason to lock
  // the user out of their database.
  const memories = [`remember ${legacyId} deploys`, `remember ${legacyId.replace(/^bot-/u, "agent-")} deploys`];

  const insert = database.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Chief', NULL, '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z', 1)`,
  );
  insert.run(threadId, legacyId);
  database
    .prepare(
      `INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence)
       VALUES (?, ?, 'gpt-5.6-luna', '2026-09-01T12:00:00.000Z', 0, ?, 1)`,
    )
    .run(legacyId, threadId, agentJson);
  for (const [index, memory] of memories.entries()) {
    database
      .prepare(
        `INSERT OR IGNORE INTO projection_agent_memories
           (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
         VALUES (?, ?, ?, ?, 'manual', NULL, '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z', 1)`,
      )
      .run(`memory-${legacyId}-${index}`, legacyId, memory, memory);
  }
  database
    .prepare(
      `INSERT INTO projection_thread_messages
         (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
       VALUES (?, 'message-1', NULL, 'agent', 'completed', NULL, '2026-09-01T12:00:00.000Z', 0, ?, 1)`,
    )
    .run(threadId, messageJson);
  database
    .prepare(
      `INSERT INTO orchestration_events
         (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, 'hosted-site-terminal', ?, 'hosted-site.terminal-pending', '2026-09-01T12:00:00.000Z', ?)`,
    )
    .run(`event-${legacyId}`, `hosted-site-terminal-pending:${legacyId}:operation-1:succeeded`, legacyId, pendingJson);
  database
    .prepare(
      `INSERT INTO orchestration_events
         (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, 'agent-roster', 'agent-roster', 'agents.replaced', '2026-09-01T12:00:00.000Z', ?)`,
    )
    .run(`roster-${legacyId}`, `agents-replaced:${legacyId}`, rosterJson);
}

function downgradeReactionsToV7(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE projection_reactions_v7 (
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_event_sequence INTEGER NOT NULL,
      PRIMARY KEY(agent_id, message_id)
    );
    INSERT INTO projection_reactions_v7 VALUES (
      'chief', 'message-1', '❤️', '2026-08-20T10:00:00.000Z', 1
    );
    DROP TABLE projection_reactions;
    ALTER TABLE projection_reactions_v7 RENAME TO projection_reactions;
    DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (7, '2026-08-20T10:00:00.000Z');
  `);
}
describe("conversation visibility epochs", () => {
  async function fixture() {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("visibility-seed", [agent], "agents.updated");
    database.persistConversation(
      { agentId: agent.id, threadId: agent.threadId, activeTurnId: null, revision: 0, messages: [] },
      "visibility.seed",
    );
    const write = (message: ConversationMessage, commandId?: string) =>
      database.persistConversationChanges({
        agentId: agent.id,
        threadId: agent.threadId ?? "",
        activeTurnId: null,
        changedMessages: [message],
        eventType: "visibility.live",
        ...(commandId ? { commandId } : {}),
      });
    const read = (id = "input") => {
      const message = database.readConversation(agent.id, agent.threadId).messages.find((message) => message.id === id);
      assert(message);
      return message;
    };
    return { database, agent, write, read };
  }
  const input = (status: "queued" | "starting" | "running" | "completed" | "cancelled"): ConversationMessage => ({
    id: "input",
    author: "user",
    text: "Input",
    status: "completed",
    createdAt: "2026-10-08T00:00:00.000Z",
    delivery: { id: "delivery", status, position: status === "queued" ? 1 : null },
  });

  it("assigns only live visibility cycles and preserves epochs through visible updates", async () => {
    const { database, agent, write, read } = await fixture();
    const pending = { ...input("queued"), visibilityEpoch: 999999, visibilityKind: "revealed" as const };
    write(pending);
    expect(read().visibilityEpoch).toBeUndefined();
    expect(read().visibilityKind).toBeUndefined();
    expect(pending.visibilityEpoch).toBe(999999);
    const before = database.readConversation(agent.id, agent.threadId).revision;
    write(input("starting"));
    const first = read().visibilityEpoch;
    expect(first).toBe(before + 1);
    expect(read().visibilityKind).toBe("revealed");
    write({ ...input("running"), text: "Updated", visibilityEpoch: 999999 });
    write({ ...input("completed"), reaction: "❤️" });
    expect(read().visibilityEpoch).toBe(first);
    expect(read().visibilityKind).toBe("revealed");
    write(input("queued"));
    const secondBefore = database.readConversation(agent.id, agent.threadId).revision;
    write(input("starting"));
    expect(read().visibilityEpoch).toBe(secondBefore + 1);
    expect(read().visibilityEpoch).toBeGreaterThan(first ?? 0);
    write(input("cancelled"));
    expect(read().delivery?.status).toBe("cancelled");
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [],
      removedMessageIds: ["input"],
      eventType: "visibility.remove",
    });
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual([]);
    database.close();
  });

  it("does not stamp legacy visible rows or trust provider history markers", async () => {
    const { database, agent, write, read } = await fixture();
    database.upsertProviderHistoryMessage({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      message: { ...input("completed"), visibilityEpoch: 999999 },
    });
    write({ ...input("completed"), text: "Live edit" });
    expect(read().visibilityEpoch).toBeUndefined();
    write({
      ...input("queued"),
      id: "routine",
      routine: { routineId: "routine", runId: "run", name: "Routine", scheduledFor: "2026-10-08" },
    });
    expect(read("routine").visibilityEpoch).toBeTypeOf("number");
    expect(read("routine").visibilityKind).toBe("created");
    write({ ...input("starting"), id: "incoming", author: "agent" });
    expect(read("incoming").visibilityEpoch).toBeTypeOf("number");
    expect(
      database.rebuildThreadProjection(agent.threadId ?? "").messages.find((message) => message.id === "input")
        ?.visibilityEpoch,
    ).toBeUndefined();
    database.close();
  });

  it("preserves durable epochs through history, whole snapshots, streaming prune, replay and reopen", async () => {
    const { database, agent, write, read } = await fixture();
    write(input("queued"));
    write(input("starting"));
    const epoch = read().visibilityEpoch;
    database.upsertProviderHistoryMessage({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      message: { ...input("completed"), visibilityEpoch: 999999 },
    });
    expect(read().visibilityEpoch).toBe(epoch);
    const snapshot = database.readConversation(agent.id, agent.threadId);
    const returned = database.persistConversation(
      { ...snapshot, messages: snapshot.messages.map((message) => ({ ...message, visibilityEpoch: 999999 })) },
      "visibility.full",
    );
    expect(returned.messages[0]?.visibilityEpoch).toBe(epoch);
    expect(returned.messages[0]?.visibilityKind).toBe("revealed");
    const stream = {
      ...snapshot,
      messages: [{ ...read(), text: "Stream", status: "streaming" as const, visibilityEpoch: 999999 }],
    };
    database.persistStreamingMessage({ snapshot: stream, messageId: "input", eventType: "visibility.stream" });
    database.persistStreamingMessage({
      snapshot: {
        ...stream,
        messages: [{ ...read(), text: "Final", status: "completed" }],
      },
      messageId: "input",
      eventType: "visibility.stream",
    });
    expect(read().visibilityEpoch).toBe(epoch);
    const before = database.readConversation(agent.id, agent.threadId);
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual(before.messages);
    database.persistConversation(before, "visibility.compacted");
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual(before.messages);
    const root = database.userDataPath;
    database.close();
    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(reopened.readConversation(agent.id, agent.threadId).messages).toEqual(before.messages);
    reopened.close();
  });

  it("keeps lower-bound allocation and input clones consistent through failure, nested rollback and receipts", async () => {
    const { database, agent, write, read } = await fixture();
    const original = input("queued");
    write(original);
    const before = database.readConversation(agent.id, agent.threadId);
    const eventsBefore = eventCount(database);
    expect(() =>
      database.persistConversationChanges({
        agentId: "missing",
        threadId: agent.threadId ?? "",
        activeTurnId: null,
        changedMessages: [input("starting")],
        eventType: "visibility.fail",
      }),
    ).toThrow();
    expect(database.connection.isTransaction).toBe(false);
    expect(eventCount(database)).toBe(eventsBefore);
    expect(database.readConversation(agent.id, agent.threadId)).toEqual(before);
    database.connection.exec("BEGIN IMMEDIATE");
    write(input("starting"));
    expect(database.connection.isTransaction).toBe(true);
    expect(read().visibilityEpoch).toBe(before.revision + 1);
    database.connection.exec("ROLLBACK");
    expect(database.readConversation(agent.id, agent.threadId)).toEqual(before);
    const started = input("starting");
    const revision = write(started, "visibility-retry");
    const authoritative = read();
    const count = eventCount(database);
    expect(write(input("queued"), "visibility-retry")).toBe(revision);
    expect(eventCount(database)).toBe(count);
    expect(read()).toEqual(authoritative);
    expect(started.visibilityEpoch).toBeUndefined();
    expect(original.visibilityEpoch).toBeUndefined();
    database.close();
  });
  it("hydrates late-visible cold members without changing canonical pages or the shared retention budget", async () => {
    const { database, agent, write } = await fixture();
    write({ ...input("completed"), id: "old-prefix", turnId: "current", createdAt: "2026-10-08T00:00:02.000Z" });
    write(input("queued"));
    const replies = Array.from(
      { length: 100 },
      (_, index): ConversationMessage => ({
        id: `reply-${index}`,
        author: "assistant",
        text: "Reply",
        status: "completed",
        createdAt: "2026-10-08T00:00:02.000Z",
        turnId: "current",
      }),
    );
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: replies,
      eventType: "visibility.replies",
    });
    const canonical = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    write({ ...input("starting"), turnId: "current" });
    write({ ...input("completed"), turnId: "current" });
    const afterReveal = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    const root = database.userDataPath;
    database.close();
    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    const cold = reopened.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    expect(cold.messages).toEqual(canonical.messages);
    expect(cold.pageInfo).toEqual(afterReveal.pageInfo);
    expect(cold.pageInfo.olderCount).toBe(canonical.pageInfo.olderCount);
    expect(cold.windowMembers?.messages.map((message) => message.id)).toEqual(["input"]);
    expect(cold.windowMembers?.messages.map((message) => message.id)).not.toContain("old-prefix");
    const combined = [...(cold.windowMembers?.messages ?? []), ...cold.messages];
    const retained = retainConversationMessages(combined, null);
    expect(retained).toHaveLength(CONVERSATION_CACHE_MESSAGE_LIMIT);
    expect(retained.some((message) => message.id === "input")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(retained))).toBeLessThan(CONVERSATION_CACHE_BYTES_LIMIT);
    expect(
      reopened.readConversationPage(agent.id, agent.threadId, { type: "around", messageId: "old-prefix" }, 50)
        .windowMembers,
    ).toBeUndefined();
    const cursor = cold.pageInfo.olderCursor;
    assert(cursor);
    expect(
      reopened
        .readConversationPage(agent.id, agent.threadId, { type: "before", cursor }, 50)
        .messages.map((message) => message.id),
    ).toEqual(["input", "old-prefix"]);
    reopened.close();
  });

  it("does not hydrate ordinary same-epoch history outside the upstream bounded cold page", async () => {
    const { database, agent } = await fixture();
    const prefix = { ...input("completed"), id: "old-prefix", turnId: "current" };
    const replies = Array.from(
      { length: 120 },
      (_, index): ConversationMessage => ({
        id: `reply-${index}`,
        author: "assistant",
        text: "Reply",
        status: "completed",
        turnId: "current",
        createdAt: "2026-10-08T00:00:02.000Z",
      }),
    );
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [prefix, ...replies],
      eventType: "visibility.same-batch",
    });
    const half = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50);
    expect(half.messages).toHaveLength(100);
    expect(half.messages[0]?.id).toBe("reply-20");
    expect(half.windowMembers?.messages).toEqual([]);
    database.close();
  });

  it("hydrates an early queued reveal beside a new reply from the same visibility write", async () => {
    const { database, agent, write } = await fixture();
    write(input("queued"));
    const replies = Array.from(
      { length: 120 },
      (_, index): ConversationMessage => ({
        id: `reply-${index}`,
        author: "assistant",
        text: "Reply",
        status: "completed",
        turnId: "current",
        createdAt: "2026-10-08T00:00:02.000Z",
      }),
    );
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [{ ...input("completed"), turnId: "current" }, ...replies],
      eventType: "visibility.same-batch-reveal",
    });
    const page = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50);
    expect(
      new Set([...page.messages, ...(page.windowMembers?.messages ?? [])].map((message) => message.visibilityEpoch))
        .size,
    ).toBe(1);
    expect(page.windowMembers?.messages.map((message) => message.id)).toEqual(["input"]);
    expect(page.windowMembers?.messages[0]?.visibilityKind).toBe("revealed");
    const root = database.userDataPath;
    database.close();
    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(reopened.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50)).toEqual(page);
    reopened.close();
  });

  it("does not reuse an old cycle after a preserve-only transition and can explicitly write a live full snapshot", async () => {
    const { database, agent, write, read } = await fixture();
    write(input("starting"));
    const first = read().visibilityEpoch;
    write(input("queued"));
    database.upsertProviderHistoryMessage({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      message: { ...input("completed"), visibilityEpoch: 999999 },
    });
    expect(read().visibilityEpoch).toBeUndefined();
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages[0]?.visibilityEpoch).toBeUndefined();
    write(input("queued"));
    const before = database.readConversation(agent.id, agent.threadId);
    const full = database.persistConversation(
      { ...before, messages: [input("starting")] },
      "visibility.live-full",
      {},
      "visibility-live-full",
      "live",
    );
    expect(full.messages[0]?.visibilityEpoch).toBe(before.revision + 1);
    expect(full.messages[0]?.visibilityEpoch).toBeGreaterThan(first ?? 0);
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual(full.messages);
    const generated = { ...input("completed"), id: "generated", visibilityEpoch: 999999 };
    const paired = database.persistConversationChangesAndMailbox(
      { ...full, messages: [...full.messages, generated] },
      [generated],
      "visibility.generated",
      {},
      {
        messages: [],
        deliveries: [],
        drafts: [],
        generatedAttachments: [],
        pausedAgentIds: [],
        idempotency: {},
        reactions: [],
      },
      "visibility.mailbox-generated",
    );
    expect(paired.messages.find((message) => message.id === "generated")?.visibilityEpoch).toBe(full.revision + 1);
    expect(paired.messages).toEqual(database.readConversation(agent.id, agent.threadId).messages);
    expect(generated.visibilityEpoch).toBe(999999);
    const mailboxBefore = database.readMailboxState();
    const eventsBefore = eventCount(database);
    const readRows = vi.spyOn(database, "readConversationMessages").mockImplementationOnce(() => {
      throw new Error("Authority read failed");
    });
    expect(() =>
      database.persistConversationChangesAndMailbox(
        { ...paired, messages: [input("starting")] },
        [input("starting")],
        "visibility.paired-failure",
        {},
        {
          messages: [],
          deliveries: [],
          drafts: [],
          generatedAttachments: [],
          pausedAgentIds: [],
          idempotency: {},
          reactions: [],
        },
        "visibility.mailbox-failure",
      ),
    ).toThrow("Authority read failed");
    readRows.mockRestore();
    expect(database.connection.isTransaction).toBe(false);
    expect(database.readConversation(agent.id, agent.threadId).messages).toEqual(paired.messages);
    expect(database.readMailboxState()).toEqual(mailboxBefore);
    expect(eventCount(database)).toBe(eventsBefore);
    database.close();
  });

  it("keeps recovered historical rows unknown while recording durable hidden-to-visible reconciliation", async () => {
    const { database, agent, write, read } = await fixture();
    write(input("queued"));
    const before = database.readConversation(agent.id, agent.threadId).revision;
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [input("completed"), { ...input("completed"), id: "old-mailbox", visibilityEpoch: 999999 }],
      source: "reconcile",
      eventType: "conversation.mailbox-reconciled",
    });
    expect(read().visibilityEpoch).toBe(before + 1);
    expect(read("old-mailbox").visibilityEpoch).toBeUndefined();
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [
        { ...input("starting"), id: "accepted-live" },
        { ...input("completed"), id: "unobserved-history" },
      ],
      source: "reconcile",
      liveMessageIds: ["accepted-live"],
      eventType: "visibility.accepted-handoff",
    });
    expect(read("accepted-live").visibilityEpoch).toBeGreaterThan(before);
    expect(read("unobserved-history").visibilityEpoch).toBeUndefined();
    write(input("queued"));
    database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      activeTurnId: null,
      changedMessages: [input("completed")],
      source: "preserve",
      eventType: "visibility.recovery-preserved",
    });
    expect(read().visibilityEpoch).toBeUndefined();
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual(
      database.readConversation(agent.id, agent.threadId).messages,
    );
    database.close();
  });

  it("uses a durable mailbox reveal only without a conversation preimage and with a current operation receipt", async () => {
    const { database, agent } = await fixture();
    const mailbox = new MailboxStore(database.userDataPath, join(database.userDataPath, "Shared"), database);
    await runCauseEffect(mailbox.initialize());
    async function transition() {
      const receipt = await runCauseEffect(
        mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Input" }),
      );
      const id = receipt.deliveries[0]?.id;
      assert(id);
      const proofs: ConversationReveal[] = [];
      await runCauseEffect(
        mailbox.markSteering(id, "turn", { recipientAgentId: agent.id, revealed: (proof) => proofs.push(proof) }),
      );
      const message = mailbox.conversationMessages(agent.id).find((message) => message.id === id);
      assert(message);
      const proof = proofs[0];
      assert(proof);
      return { id, message, proof };
    }
    function writeProof(message: ConversationMessage, proof: ConversationReveal) {
      database.persistConversationChanges({
        agentId: agent.id,
        threadId: agent.threadId ?? "",
        activeTurnId: null,
        changedMessages: [message],
        source: "reconcile",
        reveals: [proof],
        eventType: "visibility.mailbox-proof",
      });
      return database.readConversationMessages(agent.id, agent.threadId, [message.id])[0];
    }
    const valid = await transition();
    expect(writeProof(valid.message, valid.proof)?.visibilityKind).toBe("revealed");
    const wrong = await transition();
    expect(writeProof(wrong.message, { ...wrong.proof, recipientAgentId: "other" })?.visibilityEpoch).toBeUndefined();
    const missing = await transition();
    expect(
      writeProof(missing.message, { ...missing.proof, current: { ...missing.proof.current, revision: -1 } })
        ?.visibilityKind,
    ).toBeUndefined();
    const stale = await transition();
    await runCauseEffect(mailbox.markRunning(stale.id, "turn"));
    expect(writeProof(stale.message, stale.proof)?.visibilityKind).toBeUndefined();
    const mismatched = await transition();
    assert(mismatched.message.delivery);
    expect(
      writeProof({ ...mismatched.message, delivery: { ...mismatched.message.delivery, id: "other" } }, mismatched.proof)
        ?.visibilityKind,
    ).toBeUndefined();
    const existing = await transition();
    database.upsertProviderHistoryMessage({
      agentId: agent.id,
      threadId: agent.threadId ?? "",
      message: existing.message,
    });
    expect(writeProof(existing.message, existing.proof)?.visibilityEpoch).toBeUndefined();
    expect(database.rebuildThreadProjection(agent.threadId ?? "").messages).toEqual(
      database.readConversation(agent.id, agent.threadId).messages,
    );
    database.close();
  });

  it("keeps the SQL boundary predicate in parity with the shared visibility comparator", async () => {
    const { database } = await fixture();
    for (const epoch of [undefined, 9, 10, 11]) {
      for (const kind of [undefined, "created", "revealed"] as const) {
        const message = { visibilityEpoch: epoch, visibilityKind: kind };
        const row = database.connection
          .prepare(
            "SELECT (json_extract(?, '$.visibilityEpoch') > ? OR (json_extract(?, '$.visibilityEpoch') = ? AND json_extract(?, '$.visibilityKind') = 'revealed')) AS admitted",
          )
          .get(JSON.stringify(message), 10, JSON.stringify(message), 10, JSON.stringify(message));
        assert(isDynamicRecord(row));
        expect(Boolean(row.admitted)).toBe(isConversationVisibilityAfter(message, 10));
      }
    }
    database.close();
  });

  it("bounds supplemental bodies and records a long-history query plan without hot-path scans", async () => {
    const { database, agent, write } = await fixture();
    const history = Array.from(
      { length: 5000 },
      (_, index): ConversationMessage => ({
        id: `history-${index}`,
        author: "assistant",
        text: "History".repeat(32),
        status: "completed",
        createdAt: new Date(Date.UTC(2026, 9, 8) + index / 4).toISOString(),
      }),
    );
    database.persistConversation(
      { agentId: agent.id, threadId: agent.threadId, activeTurnId: null, revision: 0, messages: history },
      "visibility.history",
    );
    write(input("queued"));
    write({
      id: "reply",
      author: "assistant",
      text: "Reply",
      createdAt: "2026-10-08T00:00:02.000Z",
      status: "completed",
    });
    write(input("starting"));
    const prepare = vi.spyOn(database.connection, "prepare");
    const started = performance.now();
    const cold = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50);
    const durationMs = performance.now() - started;
    const query = prepare.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("ORDER BY json_extract(message_json, '$.visibilityEpoch')"));
    const boundaryQueries = prepare.mock.calls.length;
    prepare.mockRestore();
    assert(query);
    const floor = cold.windowMembers?.visibilityFloor;
    assert(floor);
    const plan = database.connection
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(agent.threadId, floor, floor, floor, 100);
    expect(cold.windowMembers?.messages.map((message) => message.id)).toEqual(["input"]);
    const hot = vi.spyOn(database.connection, "prepare");
    write({ ...input("running"), text: "Updated" });
    expect(
      hot.mock.calls.some(([sql]) => sql.includes("ORDER BY json_extract(message_json, '$.visibilityEpoch')")),
    ).toBe(false);
    hot.mockRestore();
    const oversized = { ...input("starting"), id: "large", text: "x".repeat(CONVERSATION_CACHE_BYTES_LIMIT) };
    write(oversized);
    const bounded = database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50);
    expect(bounded.windowMembers?.messages.some((message) => message.id === "large")).toBe(false);
    const artifact = resolve(".openbot-build/visibility-upstream/query-cost.json");
    await mkdir(resolve(".openbot-build/visibility-upstream"), { recursive: true });
    await writeFile(
      artifact,
      JSON.stringify(
        {
          historyRows: 5000,
          durationMs,
          boundaryQueries,
          plan,
          supplementalIds: cold.windowMembers?.messages.map((message) => message.id),
          hotPathSupplementQueries: 0,
        },
        null,
        2,
      ),
    );
    database.close();
  });
});

async function createDatabase(): Promise<OpenBotDatabase> {
  const root = await mkdtemp(join(tmpdir(), "openbot-db-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return database;
}

function testAgent(): AgentSummary {
  return {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "openbot-thread-chief",
    workspacePath: "/tmp/openbot-chief",
    preview: "42",
    updatedAt: "2026-08-18T10:00:01.000Z",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Migration 28 removed the provider CHECK: an unknown provider must still write no event and no row. */
function expectUnknownProviderRejected(database: OpenBotDatabase, threadId: string): void {
  // A provider string from outside the type system, such as an old settings file.
  const provider: AgentProviderId = JSON.parse('"gemini"');
  const events = eventCount(database);
  const sessions = database.listProviderSessions(threadId);
  expect(() =>
    database.bindProviderSession({
      threadId,
      provider,
      externalSessionId: "bad-session",
      model: "model",
      effort: "medium",
    }),
  ).toThrow("Unknown provider for a provider session.");
  expect(eventCount(database)).toBe(events);
  expect(database.listProviderSessions(threadId)).toEqual(sessions);
}

function eventCount(database: OpenBotDatabase): number {
  const row = database.connection.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get();
  if (!isDynamicRecord(row) || !isNumber(row.count)) throw new Error("Invalid event count row.");
  return row.count;
}

function snapshotEventCount(database: OpenBotDatabase, threadId: string | null): number {
  if (!threadId) throw new Error("The test agent has no thread.");
  const row = database.connection
    .prepare(
      `SELECT COUNT(*) AS count FROM orchestration_events
       WHERE aggregate_type = 'thread' AND aggregate_id = ?
         AND json_type(payload_json, '$.snapshot') = 'object'`,
    )
    .get(threadId);
  if (!isDynamicRecord(row) || !isNumber(row.count)) throw new Error("Invalid snapshot count row.");
  return row.count;
}

function streamedMessageEventCount(database: OpenBotDatabase, threadId: string | null): number {
  if (!threadId) throw new Error("The test agent has no thread.");
  const row = database.connection
    .prepare(
      `SELECT COUNT(*) AS count FROM orchestration_events
       WHERE aggregate_type = 'thread' AND aggregate_id = ?
         AND json_type(payload_json, '$.streamedMessage') = 'object'`,
    )
    .get(threadId);
  if (!isDynamicRecord(row) || !isNumber(row.count)) throw new Error("Invalid streamed message count row.");
  return row.count;
}

/** The sequence each projected message was last written at, by message id. */
function messageSequences(database: OpenBotDatabase, threadId: string): Record<string, number> {
  const sequences: Record<string, number> = {};
  for (const row of database.connection
    .prepare("SELECT message_id, last_event_sequence FROM projection_thread_messages WHERE thread_id = ?")
    .all(threadId)) {
    if (!isDynamicRecord(row) || !isString(row.message_id) || !isNumber(row.last_event_sequence)) {
      throw new Error("Invalid message sequence row.");
    }
    sequences[row.message_id] = row.last_event_sequence;
  }
  return sequences;
}

/** A settled history with one message still streaming at the end of it. */
function streamingSnapshot(agent: AgentSummary, settled: number): ConversationSnapshot {
  const settledMessages: ConversationMessage[] = Array.from({ length: settled }, (_, index) => ({
    id: `settled-${index}`,
    turnId: "turn-0",
    author: index % 2 === 0 ? "user" : "assistant",
    text: `Settled message ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 20, 10, 0, index)).toISOString(),
    status: "completed",
  }));
  return {
    agentId: agent.id,
    threadId: agent.threadId,
    activeTurnId: "turn-1",
    revision: 0,
    messages: [
      ...settledMessages,
      {
        id: "assistant-live",
        turnId: "turn-1",
        author: "assistant",
        text: "",
        createdAt: "2026-08-20T11:00:00.000Z",
        status: "streaming",
      },
    ],
  };
}

function conversationSnapshot(agent: AgentSummary, text: string): ConversationSnapshot {
  return {
    agentId: agent.id,
    threadId: agent.threadId,
    activeTurnId: null,
    revision: 0,
    messages: [
      {
        id: "assistant-1",
        turnId: "turn-1",
        author: "assistant",
        text,
        createdAt: "2026-08-20T10:00:00.000Z",
        status: "completed",
      },
    ],
  };
}

function withoutAttachments(message: ConversationMessage): ConversationMessage {
  const result = { ...message };
  delete result.attachments;
  return result;
}

// These tests construct released schemas by stripping newer additions from a fresh fixture.
function removeSchemaAfterVersion14(db: DatabaseSync): void {
  // Channel migrations 18 and 19 stand on the provider migration 17, so a fixture below 17 must
  // drop all three. Every version from 15 up goes: a history that keeps a later version and drops an earlier one has a gap, which the
  // schema check rejects before any upgrade runs.
  for (const table of ["memories", "routines", "routine_triggers", "routine_runs"])
    db.exec(`DROP TABLE projection_channel_${table}`);
  for (const table of ["assignments", "tasks", "messages", "summaries", "reads", "contexts"])
    db.exec(`DROP TABLE projection_channel_${table}`);
  db.exec("DROP TABLE projection_channels");
  db.exec("DROP TABLE agent_usage_records; DROP TABLE agent_usage_checkpoints; DROP TABLE agent_usage_activity");
  removeProviderHistorySchema(db);
  db.exec("DELETE FROM schema_migrations WHERE version >= 15");
}

/** Migration 30's webhook tables, children first. */
const WEBHOOK_TABLES_DROP_SQL = `
  DROP TABLE projection_webhook_receipts;
  DROP TABLE projection_webhook_route_revocations;
  DROP TABLE projection_channel_routine_webhooks;
  DROP TABLE projection_routine_webhooks;
`;

/** Migration 29's provider history tables, children first. */
const PROVIDER_HISTORY_TABLES_DROP_SQL = `
  DROP TABLE provider_history_staging;
  DROP TABLE provider_history_turns;
  DROP TABLE provider_history_imports;
`;

function removeProviderHistorySchema(db: DatabaseSync): void {
  db.exec(
    "DROP TABLE IF EXISTS provider_history_staging; DROP TABLE IF EXISTS provider_history_turns; DROP TABLE IF EXISTS provider_history_imports",
  );
}
