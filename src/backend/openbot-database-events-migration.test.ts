// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRoutineStore } from "./agent-routine-store";
import { ChannelRoutineStore } from "./channel-routine-store";
import { ChannelStore } from "./channel-store";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenBot webhook routine migration", () => {
  it("preserves scheduled routines and runs while upgrading a version 29 database", async () => {
    const { database, routineStore } = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("migration-event-agent", [agent], "agents.imported");
    const routine = routineStore.create(
      {
        agentId: "chief",
        name: "Keep this schedule",
        instruction: "Keep this instruction.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      },
      new Date("2026-10-01T08:00:00.000Z"),
    );
    const run = routineStore.createRun(routine, routine.trigger.id, "scheduled", "2026-10-01T09:00:00.000Z");
    const channels = new ChannelStore(database);
    const channel = channels.create("migration-channel", {
      name: "Migration channel",
      title: "Preserve this channel",
      instructions: "Keep this channel data.",
      members: [{ agentId: agent.id }],
      leadAgentId: agent.id,
    });
    channels.commit("migration-event-channel", { channel, messages: [], tasks: [], assignments: [] });
    const channelRoutineStore = new ChannelRoutineStore(database);
    const channelRoutine = channelRoutineStore.create(
      {
        channelId: channel.id,
        name: "Keep this channel schedule",
        instruction: "Keep this channel instruction.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "10:00" },
      },
      new Date("2026-10-01T08:00:00.000Z"),
    );
    const channelRun = channelRoutineStore.createRun(
      channelRoutine,
      channelRoutine.trigger.id,
      "scheduled",
      "2026-10-01T10:00:00.000Z",
    );
    const path = database.path;
    const root = database.userDataPath;
    database.close();

    const legacy = new DatabaseSync(path);
    removeWebhookSchema(legacy);
    legacy.close();

    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    const migratedRoutines = new AgentRoutineStore(migrated);
    expect(migratedRoutines.get("chief", routine.id)).toMatchObject({
      id: routine.id,
      name: routine.name,
      instruction: routine.instruction,
      trigger: { id: routine.trigger.id, schedule: routine.trigger.schedule },
    });
    expect(migratedRoutines.listRuns("chief", routine.id, 10)).toEqual([
      expect.objectContaining({
        id: run.id,
        routineName: routine.name,
        instruction: routine.instruction,
        scheduledFor: "2026-10-01T09:00:00.000Z",
      }),
    ]);
    const migratedChannelRoutines = new ChannelRoutineStore(migrated);
    expect(migratedChannelRoutines.get(channel.id, channelRoutine.id)).toMatchObject({
      id: channelRoutine.id,
      name: channelRoutine.name,
      instruction: channelRoutine.instruction,
      trigger: { id: channelRoutine.trigger.id, schedule: channelRoutine.trigger.schedule },
    });
    expect(migratedChannelRoutines.listRuns(channel.id, channelRoutine.id, 10)).toEqual([
      expect.objectContaining({
        id: channelRun.id,
        routineName: channelRoutine.name,
        instruction: channelRoutine.instruction,
        scheduledFor: "2026-10-01T10:00:00.000Z",
      }),
    ]);
    // A routine from the old schema can switch to a webhook trigger and keep its runs.
    migratedRoutines.saveRecord("chief", routine.id, {
      name: routine.name,
      instruction: routine.instruction,
      active: true,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: null, filters: [], secretCiphertext: "ciphertext" },
    });
    expect(migratedRoutines.get("chief", routine.id)).toBeNull();
    expect(migratedRoutines.getRecord("chief", routine.id)?.trigger).toMatchObject({ kind: "webhook", url: null });
    expect(migratedRoutines.listRuns("chief", routine.id, 10)).toEqual([expect.objectContaining({ id: run.id })]);
    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 32,
    });
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    migrated.close();
  });

  it("rolls back the webhook migration and retries without losing scheduled data", async () => {
    const { database, routineStore } = await createDatabase();
    database.replaceAgents("migration-event-rollback", [testAgent()], "agents.imported");
    const routine = routineStore.create({
      agentId: "chief",
      name: "Retry this schedule",
      instruction: "Keep this run.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 15 },
    });
    const path = database.path;
    const root = database.userDataPath;
    database.close();

    const legacy = new DatabaseSync(path);
    removeWebhookSchema(legacy);
    // Migration 30 creates this index after creating its first tables. A table with the same name
    // makes the migration fail after its first DDL statement, which exercises transaction rollback.
    legacy.exec("CREATE TABLE webhook_receipts_recent (conflict TEXT)");
    legacy.close();

    const failed = new OpenBotDatabase(root);
    await expect(runCauseEffect(failed.initialize())).rejects.toThrow("migration to version 30 failed");
    failed.close();

    const rolledBack = new DatabaseSync(path);
    expect(rolledBack.prepare("SELECT version FROM schema_migrations WHERE version = 30").get()).toBeUndefined();
    expect(
      rolledBack
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("projection_routine_webhooks"),
    ).toBeUndefined();
    rolledBack.exec("DROP TABLE webhook_receipts_recent");
    rolledBack.close();

    const retried = new OpenBotDatabase(root);
    await runCauseEffect(retried.initialize());
    expect(new AgentRoutineStore(retried).get("chief", routine.id)).toMatchObject({
      name: routine.name,
      instruction: routine.instruction,
    });
    expect(retried.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 32,
    });
    expect(retried.connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(retried.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(retried.connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    retried.close();
  });
});

async function createDatabase(): Promise<{ database: OpenBotDatabase; routineStore: AgentRoutineStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-db-events-migration-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return { database, routineStore: new AgentRoutineStore(database) };
}

function removeWebhookSchema(database: DatabaseSync): void {
  database.exec(`
    DROP TABLE projection_routine_webhooks;
    DROP TABLE projection_channel_routine_webhooks;
    DROP TABLE projection_webhook_route_revocations;
    DROP TABLE projection_webhook_receipts;
    DROP TRIGGER agent_memory_insert;
    DROP TRIGGER agent_memory_update;
    DROP TRIGGER agent_memory_delete;
    DROP TABLE agent_memory_search;
    DROP TABLE agent_memory_selections;
    DELETE FROM schema_migrations WHERE version IN (30, 31, 32);
  `);
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
