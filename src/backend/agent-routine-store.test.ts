// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRoutineStore } from "./agent-routine-store";
import { AgentStore } from "./agent-store";
import { ChannelRoutineStore } from "./channel-routine-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentRoutineStore", () => {
  it("persists a routine, its trigger, and immutable run snapshots", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the daily brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule: { kind: "weekdays", time: "07:00" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    expect(routine.trigger.schedule).toEqual({ kind: "weekdays", time: "07:00" });

    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T05:00:00.000Z");
    routines.update({ agentId: "chief", routineId: routine.id, name: "Changed name", instruction: "New text" });
    expect(routines.listRuns("chief", routine.id, 10)[0]).toMatchObject({
      id: run.id,
      routineName: "Morning brief",
      instruction: "Prepare the daily brief.",
    });
    database.close();

    const reopened = new OpenBotDatabase(database.userDataPath);
    await reopened.initialize();
    expect(new AgentRoutineStore(reopened).list("chief")).toHaveLength(1);
    reopened.close();
  });

  it("does not create a duplicate scheduled run", async () => {
    const { database, routines } = await setup();
    const routine = routines.create({
      agentId: "chief",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const triggerId = routine.trigger.id;
    const first = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    const second = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(second.id).toBe(first.id);
    expect(routines.listRuns("chief", routine.id, 10)).toHaveLength(1);
    database.close();
  });

  it("skips missed times after a cold start", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T12:07:00.000Z"));
    expect(routines.get("chief", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T12:15:00.000Z");
    expect(routines.listRuns("chief", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("excludes pending agents from due and next-due routine queries", async () => {
    const { database, routines } = await setup();
    const now = new Date("2026-08-25T10:00:00.000Z");
    routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run every quarter hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    routines.create(
      {
        agentId: "research",
        name: "Half hour",
        instruction: "Run every half hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 30, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    const excluded = new Set(["chief"]);

    expect(routines.nextDueAt(excluded)).toBe("2026-08-25T10:30:00.000Z");
    expect(routines.due(new Date("2026-08-25T10:31:00.000Z"), excluded).map((due) => due.routine.agentId)).toEqual([
      "research",
    ]);
    database.close();
  });

  it("reschedules a paused routine from the activation time without creating a run", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    routines.update({ agentId: "chief", routineId: routine.id, active: false }, new Date("2026-08-25T08:30:00.000Z"));

    const resumed = routines.update(
      { agentId: "chief", routineId: routine.id, active: true },
      new Date("2026-08-27T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).toBe(routine.trigger.id);
    expect(resumed.trigger.nextRunAt).toBe("2026-08-28T09:00:00.000Z");
    expect(routines.listRuns("chief", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("creates one future trigger when a paused routine is resumed with a new schedule", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: false,
        timezone: "Europe/Warsaw",
        schedule: { kind: "daily", time: "07:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );

    const resumed = routines.update(
      {
        agentId: "chief",
        routineId: routine.id,
        active: true,
        schedule: { kind: "weekdays", time: "08:15" },
      },
      new Date("2026-08-28T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).not.toBe(routine.trigger.id);
    expect(resumed.trigger.schedule).toEqual({ kind: "weekdays", time: "08:15" });
    expect(resumed.trigger.nextRunAt).toBe("2026-08-31T06:15:00.000Z");
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_routine_triggers WHERE routine_id = ?")
        .get(routine.id),
    ).toMatchObject({ count: 1 });
    expect(routines.listRuns("chief", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("removes routines when the agent is deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-routine-agent-delete-"));
    roots.push(root);
    const agents = new AgentStore(join(root, "data"), join(root, "home"));
    await agents.initialize();
    const agent = await agents.getOrCreate("chief");
    const routines = new AgentRoutineStore(agents.database);
    routines.create({
      agentId: agent.id,
      name: "Temporary",
      instruction: "Remove this routine.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    await agents.deleteAgent(agent.id);
    expect(routines.list(agent.id)).toEqual([]);
    agents.database.close();
  });
});

/**
 * The same seven cases against the channel owner. Both classes are thin name mappers over one
 * `RoutineStore`, so this block is what proves the shared SQL is owner-agnostic rather than
 * agent-shaped with a channel alias.
 */
describe("ChannelRoutineStore", () => {
  it("persists a routine, its trigger, and immutable run snapshots", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the daily brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule: { kind: "weekdays", time: "07:00" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    expect(routine.trigger.schedule).toEqual({ kind: "weekdays", time: "07:00" });

    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T05:00:00.000Z");
    routines.update({ channelId: "channel-1", routineId: routine.id, name: "Changed name", instruction: "New text" });
    expect(routines.listRuns("channel-1", routine.id, 10)[0]).toMatchObject({
      id: run.id,
      routineName: "Morning brief",
      instruction: "Prepare the daily brief.",
      requestMessageId: null,
    });
    database.close();

    const reopened = new OpenBotDatabase(database.userDataPath);
    await reopened.initialize();
    expect(new ChannelRoutineStore(reopened).list("channel-1")).toHaveLength(1);
    reopened.close();
  });

  it("does not create a duplicate scheduled run", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const triggerId = routine.trigger.id;
    const first = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    const second = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(second.id).toBe(first.id);
    expect(routines.listRuns("channel-1", routine.id, 10)).toHaveLength(1);
    database.close();
  });

  it("finds a run by the request message the fire posted", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(routines.pendingRuns().map((pending) => pending.id)).toEqual([run.id]);
    routines.attachRequest(run.id, "request-1");
    expect(routines.runForRequest("request-1")?.id).toBe(run.id);
    expect(routines.pendingRuns()).toEqual([]);
    expect(routines.channelsWithOpenRuns()).toEqual(["channel-1"]);
    database.close();
  });

  it("skips missed times after a cold start", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T12:07:00.000Z"));
    expect(routines.get("channel-1", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T12:15:00.000Z");
    expect(routines.listRuns("channel-1", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("excludes archived channels from due and next-due routine queries", async () => {
    const { database, routines } = await channelSetup(["channel-1", "channel-2"]);
    const now = new Date("2026-08-25T10:00:00.000Z");
    routines.create(
      {
        channelId: "channel-1",
        name: "Quarter hour",
        instruction: "Run every quarter hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    routines.create(
      {
        channelId: "channel-2",
        name: "Half hour",
        instruction: "Run every half hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 30, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    const archived = new Set(["channel-1"]);

    expect(routines.nextDueAt(archived)).toBe("2026-08-25T10:30:00.000Z");
    expect(routines.due(new Date("2026-08-25T10:31:00.000Z"), archived).map((due) => due.routine.channelId)).toEqual([
      "channel-2",
    ]);
    database.close();
  });

  it("reschedules a paused routine from the activation time without creating a run", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    routines.update(
      { channelId: "channel-1", routineId: routine.id, active: false },
      new Date("2026-08-25T08:30:00.000Z"),
    );

    const resumed = routines.update(
      { channelId: "channel-1", routineId: routine.id, active: true },
      new Date("2026-08-27T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).toBe(routine.trigger.id);
    expect(resumed.trigger.nextRunAt).toBe("2026-08-28T09:00:00.000Z");
    expect(routines.listRuns("channel-1", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("creates one future trigger when a paused routine is resumed with a new schedule", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: false,
        timezone: "Europe/Warsaw",
        schedule: { kind: "daily", time: "07:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );

    const resumed = routines.update(
      {
        channelId: "channel-1",
        routineId: routine.id,
        active: true,
        schedule: { kind: "weekdays", time: "08:15" },
      },
      new Date("2026-08-28T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).not.toBe(routine.trigger.id);
    expect(resumed.trigger.schedule).toEqual({ kind: "weekdays", time: "08:15" });
    expect(resumed.trigger.nextRunAt).toBe("2026-08-31T06:15:00.000Z");
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_channel_routine_triggers WHERE routine_id = ?")
        .get(routine.id),
    ).toMatchObject({ count: 1 });
    expect(routines.listRuns("channel-1", routine.id, 10)).toEqual([]);
    database.close();
  });

  it("removes routines when the channel row goes", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Temporary",
      instruction: "Remove this routine.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T07:00:00.000Z");
    database.connection.prepare("DELETE FROM projection_channels WHERE channel_id = ?").run("channel-1");
    expect(routines.list("channel-1")).toEqual([]);
    expect(routines.listRuns("channel-1", routine.id, 10)).toEqual([]);
    database.close();
  });
});

async function setup(): Promise<{ database: OpenBotDatabase; routines: AgentRoutineStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  return { database, routines: new AgentRoutineStore(database) };
}

/** A routine needs its channel row: the owner column is a cascading foreign key. */
async function channelSetup(
  channelIds: string[] = ["channel-1"],
): Promise<{ database: OpenBotDatabase; routines: ChannelRoutineStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-channel-routine-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  const insert = database.connection.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)");
  for (const channelId of channelIds) insert.run(channelId, JSON.stringify({ id: channelId }));
  return { database, routines: new ChannelRoutineStore(database) };
}
