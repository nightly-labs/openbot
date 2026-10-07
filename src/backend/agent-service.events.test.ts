// @vitest-environment node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventEnvelope, EventRoutine, SaveEventRoutineInput } from "@openbot/contracts/ipc-events";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { ChannelStore } from "./channel-store";
import { databaseRows } from "./database/database-rows";
import { runCauseEffect } from "./effect-boundary";
import { eventRoutineRunId } from "./event-routine-scheduler";
import { EventStore } from "./event-store";

let root: string;
let service: AgentService | null = null;
const reportScenarios: Array<{ name: string; status: "passed" }> = [];

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

afterAll(async () => {
  await mkdir(join(process.cwd(), ".openbot-build"), { recursive: true });
  await writeFile(
    join(process.cwd(), ".openbot-build", "webhook-flow-report.json"),
    `${JSON.stringify({ version: 1, scenarios: reportScenarios }, null, 2)}\n`,
    "utf8",
  );
});

describe.sequential("AgentService: event routines", () => {
  it("receives one event, queues one agent run, and creates a stable notification", async () => {
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("event-agent"));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());

    const events = new EventStore(store.database);
    const source = events.saveSource({
      name: "Generic source",
      active: true,
      url: null,
      secretCiphertext: "source-ciphertext",
    });
    const routine = await saveEventRoutine(service, {
      owner: { kind: "agent", id: agent.id },
      name: "Build event",
      instruction: "Review the build event.",
      active: true,
      timezone: "UTC",
      trigger: {
        kind: "event",
        sourceId: source.id,
        eventType: "generic.received",
        filters: [{ pointer: "/kind", value: "build" }],
      },
    });
    const destination = events.saveDestination({
      name: "Activity receiver",
      active: true,
      url: "https://example.test/openbot-events",
      method: "POST",
      eventTypes: ["routine.run.started"],
      routineIds: [routine.id],
      payloadTemplate: null,
      secretCiphertext: "destination-ciphertext",
      headersCiphertext: null,
      headerNames: [],
    });
    const envelope: EventEnvelope = {
      version: 1,
      id: "event-agent-1",
      sourceId: source.id,
      type: "generic.received",
      occurredAt: "2026-10-07T10:00:00.000Z",
      receivedAt: "2026-10-07T10:00:01.000Z",
      data: { kind: "build", number: 42 },
    };

    expect(events.receive({ deliveryId: "delivery-agent-1", envelope }).dispatchIds).toHaveLength(1);
    expect(events.receive({ deliveryId: "delivery-agent-1", envelope })).toMatchObject({
      accepted: true,
      duplicate: true,
      dispatchIds: [],
    });
    await runCauseEffect(service.eventRoutines.dispatch());

    await waitFor(() => service?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 }).length === 1);
    await waitFor(
      () => service?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })[0]?.status === "running",
    );
    expect(service.listQueue(agent.id).deliveries).toEqual([
      expect.objectContaining({
        sender: expect.objectContaining({ kind: "routine", routineId: routine.id }),
      }),
    ]);
    const run = service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })[0];
    if (!run) throw new Error("The event routine run was not persisted.");
    expect(run.id).toBe(eventRoutineRunId(source.id, envelope.id, routine.id));
    expect(run.id).toMatch(/^[0-9a-f]{32}$/u);
    const deliveries = databaseRows(
      store.database.connection
        .prepare(
          `SELECT delivery_id, event_id, event_type, payload_json, status
           FROM projection_webhook_deliveries WHERE destination_id = ?`,
        )
        .all(destination.id),
    );
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0];
    if (!delivery) throw new Error("The routine notification was not persisted.");
    expect(delivery).toMatchObject({ event_type: "routine.run.started", status: "queued" });
    expect(JSON.parse(String(delivery.payload_json))).toMatchObject({
      eventType: "routine.run.started",
      runId: run.id,
      routineId: routine.id,
      routineName: "Build event",
      status: "started",
    });
    expect(events.listActivity(50)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "received", status: "accepted", eventId: envelope.id }),
        expect.objectContaining({ kind: "received", status: "duplicate", eventId: envelope.id }),
        expect.objectContaining({ kind: "routine-run", runId: run.id, eventId: envelope.id }),
        expect.objectContaining({
          kind: "delivery",
          runId: run.id,
          eventId: expect.any(String),
          destinationId: destination.id,
        }),
      ]),
    );
    const claimedDelivery = events.claimDeliveries();
    expect(claimedDelivery).toHaveLength(1);
    const claimed = claimedDelivery[0];
    if (!claimed) throw new Error("The webhook delivery was not claimed.");
    expect(claimed.attempt).toBe(0);
    expect(events.resumeSendingDeliveries()).toBe(1);
    expect(
      store.database.connection
        .prepare("SELECT status, attempt FROM projection_webhook_deliveries WHERE delivery_id = ?")
        .get(claimed.id),
    ).toMatchObject({ status: "queued", attempt: 1 });
    reportScenarios.push({ name: "receipt-to-agent-run-and-notification", status: "passed" });
  });

  it("recovers a claimed receipt after a lost acknowledgement without duplicating the run", async () => {
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("recovery-agent"));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    const events = new EventStore(store.database);
    const source = events.saveSource({ name: "Recovery source", active: true, url: null });
    const routine = await saveEventRoutine(service, {
      owner: { kind: "agent", id: agent.id },
      name: "Recovery event",
      instruction: "Handle recovery.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "event", sourceId: source.id, eventType: "generic.recovery", filters: [] },
    });
    const envelope = eventEnvelope(source.id, "event-recovery-1", "generic.recovery", { retry: true });
    expect(events.receive({ deliveryId: "delivery-recovery-1", envelope }).dispatchIds).toHaveLength(1);
    const claimed = events.claimDispatches();
    expect(claimed).toHaveLength(1);
    const claim = claimed[0];
    if (!claim) throw new Error("The event dispatch claim was not persisted.");
    events.assignDispatchRun(claim.id, eventRoutineRunId(source.id, envelope.id, routine.id));
    await runCauseEffect(service.stop());
    service = null;
    store.database.close();
    const reopened = stores(root);
    await runCauseEffect(reopened.store.initialize());
    await runCauseEffect(reopened.mailbox.initialize());
    const reopenedEvents = new EventStore(reopened.store.database);
    service = createTestService({
      store: reopened.store,
      mailbox: reopened.mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    expect(reopenedEvents.resumeClaimedDispatches()).toBe(1);
    await runCauseEffect(service.eventRoutines.dispatch());
    await waitFor(() => service?.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 }).length === 1);
    await runCauseEffect(service.eventRoutines.dispatch());
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
    const dispatchRow = reopened.store.database.connection
      .prepare("SELECT dispatch_id, run_id FROM projection_event_dispatches WHERE event_id = ?")
      .get(envelope.id);
    if (
      !isDynamicRecord(dispatchRow) ||
      typeof dispatchRow.dispatch_id !== "string" ||
      typeof dispatchRow.run_id !== "string"
    ) {
      throw new Error("The event dispatch completion was not persisted.");
    }
    reopened.store.database.connection
      .prepare("UPDATE projection_event_dispatches SET status = 'claimed' WHERE dispatch_id = ?")
      .run(dispatchRow.dispatch_id);
    expect(reopenedEvents.resumeClaimedDispatches()).toBe(1);
    await runCauseEffect(service.eventRoutines.dispatch());
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
    expect(
      reopened.store.database.connection
        .prepare("SELECT status FROM projection_event_dispatches WHERE event_id = ?")
        .get(envelope.id),
    ).toMatchObject({ status: "completed" });
    reportScenarios.push({ name: "lost-acknowledgement-recovery", status: "passed" });
  });

  it("preserves event routine definitions when its source is deleted", async () => {
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("source-delete-agent"));
    service = createTestService({ store, mailbox, preferredProvider: "codex" });
    await runCauseEffect(service.initialize());
    const events = new EventStore(store.database);
    const source = events.saveSource({ name: "Disposable source", active: true, url: null });
    const routine = await saveEventRoutine(service, {
      owner: { kind: "agent", id: agent.id },
      name: "Keep this definition",
      instruction: "Keep the routine history.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "event", sourceId: source.id, eventType: "generic.deleted", filters: [] },
    });
    events.deleteSource(source.id);
    expect(events.listSources().some((item) => item.id === source.id)).toBe(false);
    expect(events.getEventRoutine(routine.id)).toMatchObject({ id: routine.id, active: false });
    expect(events.listEventRoutines({ kind: "agent", id: agent.id })).toEqual([
      expect.objectContaining({ id: routine.id, name: "Keep this definition" }),
    ]);
    reportScenarios.push({ name: "source-delete-preserves-routine-definition", status: "passed" });
  });

  it("keeps one routine id across event and schedule conversions before and after a run", async () => {
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("conversion-agent"));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    const events = new EventStore(store.database);
    const source = events.saveSource({ name: "Conversion source", active: true, url: null });
    const input: SaveEventRoutineInput = {
      owner: { kind: "agent", id: agent.id },
      name: "Convertible routine",
      instruction: "Convert this routine.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "event", sourceId: source.id, eventType: "generic.convert", filters: [] },
    };
    const eventRoutine = await saveEventRoutine(service, input);
    const scheduledBefore = await saveEventRoutine(service, {
      ...eventRoutine,
      trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
    });
    expect(scheduledBefore.id).toBe(eventRoutine.id);
    expect(events.getEventRoutine(eventRoutine.id)).toBeNull();
    expect(service.listRoutines(agent.id).some((item) => item.id === eventRoutine.id)).toBe(true);

    const eventAgain = await saveEventRoutine(service, {
      ...scheduledBefore,
      trigger: { kind: "event", sourceId: source.id, eventType: "generic.convert", filters: [] },
    });
    expect(eventAgain.id).toBe(eventRoutine.id);
    expect(service.listRoutines(agent.id).some((item) => item.id === eventRoutine.id)).toBe(false);
    expect(events.getEventRoutine(eventRoutine.id)).toMatchObject({ id: eventRoutine.id });

    const envelope = eventEnvelope(source.id, "event-conversion-1", "generic.convert", { converted: true });
    expect(events.receive({ deliveryId: "delivery-conversion-1", envelope }).dispatchIds).toHaveLength(1);
    await runCauseEffect(service.eventRoutines.dispatch());
    await waitFor(
      () => service?.listRoutineRuns({ agentId: agent.id, routineId: eventRoutine.id, limit: 10 }).length === 1,
    );
    const scheduledAfter = await saveEventRoutine(service, {
      ...eventAgain,
      trigger: { kind: "schedule", schedule: { kind: "weekdays", time: "10:00" } },
    });
    expect(scheduledAfter.id).toBe(eventRoutine.id);
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: eventRoutine.id, limit: 10 })).toHaveLength(1);

    const eventAfter = await saveEventRoutine(service, {
      ...scheduledAfter,
      trigger: { kind: "event", sourceId: source.id, eventType: "generic.convert", filters: [] },
    });
    expect(eventAfter.id).toBe(eventRoutine.id);
    await runCauseEffect(service.eventRoutines.delete({ id: eventRoutine.id, owner: { kind: "agent", id: agent.id } }));
    expect(service.listRoutines(agent.id).some((item) => item.id === eventRoutine.id)).toBe(false);
    expect(events.getEventRoutine(eventRoutine.id)).toBeNull();
    expect(
      store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_routine_runs WHERE agent_id = ? AND routine_id = ?")
        .get(agent.id, eventRoutine.id),
    ).toMatchObject({ count: 0 });
    reportScenarios.push({ name: "conversion-before-and-after-run", status: "passed" });
  });

  it("dispatches an event routine owned by a group through the channel queue", async () => {
    const { store, mailbox } = stores(root);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(store.getOrCreate("group-agent"));
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await runCauseEffect(service.initialize());
    const channels = new ChannelStore(store.database);
    const channel = channels.create("event-group", {
      name: "Event group",
      title: "Event group",
      instructions: "Handle group events.",
      members: [{ agentId: agent.id }],
      leadAgentId: agent.id,
    });
    channels.commit("test.event-group", { channel, messages: [], tasks: [], assignments: [] });
    const events = new EventStore(store.database);
    const source = events.saveSource({ name: "Group source", active: true, url: null });
    const routine = await saveEventRoutine(service, {
      owner: { kind: "channel", id: channel.id },
      name: "Group event",
      instruction: "Handle the group event.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "event", sourceId: source.id, eventType: "group.received", filters: [] },
    });
    const envelope = eventEnvelope(source.id, "event-group-1", "group.received", { group: true });
    expect(events.receive({ deliveryId: "delivery-group-1", envelope }).dispatchIds).toHaveLength(1);
    await runCauseEffect(service.eventRoutines.dispatch());
    await waitFor(
      () => service?.listChannelRoutineRuns({ channelId: channel.id, routineId: routine.id, limit: 10 }).length === 1,
    );
    expect(
      service.listChannelRoutineRuns({ channelId: channel.id, routineId: routine.id, limit: 10 })[0],
    ).toMatchObject({
      id: eventRoutineRunId(source.id, envelope.id, routine.id),
      kind: "manual",
    });
    expect(service.channels.store.tasks(channel.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ requestMessageId: expect.any(String) })]),
    );
    reportScenarios.push({ name: "group-event-dispatch", status: "passed" });
  });
});

async function saveEventRoutine(service: AgentService, input: SaveEventRoutineInput): Promise<EventRoutine> {
  return runCauseEffect(service.eventRoutines.save(input));
}

function eventEnvelope(sourceId: string, id: string, type: string, data: EventEnvelope["data"]): EventEnvelope {
  return {
    version: 1,
    id,
    sourceId,
    type,
    occurredAt: "2026-10-07T10:00:00.000Z",
    receivedAt: "2026-10-07T10:00:01.000Z",
    data,
  };
}
