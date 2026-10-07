// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routine } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRoutineStore } from "../agent-routine-store";
import { AgentStore } from "../agent-store";
import { runCauseEffect } from "../effect-boundary";
import { RoutineFlowStore } from "./routine-flow-store";
import { createRoutineFlows, type RoutineFlowDelivery, type RoutineFlowsHandle } from "./routine-flows";

const roots: string[] = [];
const handles: RoutineFlowsHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => Effect.runPromise(handle.close())));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Links are made "before" every run: the runtime only applies a link to runs that started after it. */
const BEFORE_RUNS = new Date("2026-01-01T00:00:00.000Z");

interface Sent {
  agentId: string;
  text: string;
  idempotencyKey: string;
  runId: string;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-flows-"));
  roots.push(root);
  const agents = new AgentStore(join(root, "data"), join(root, "home"));
  await runCauseEffect(agents.initialize());
  for (const id of ["research", "sales", "writer", "chief"]) await runCauseEffect(agents.getOrCreate(id));
  const database = agents.database;
  const routines = new AgentRoutineStore(database);
  const store = new RoutineFlowStore({ database });
  const deliveries = new Map<string, RoutineFlowDelivery>();
  const answers = new Map<string, string>();
  const sent: Sent[] = [];
  const changed: string[][] = [];
  const state = { failSend: false, clock: BEFORE_RUNS };
  const start = () =>
    Effect.runPromise(
      createRoutineFlows({
        store,
        routines,
        delivery: (id) => deliveries.get(id) ?? null,
        turnAnswer: (agentId, turnId) => answers.get(`${agentId}:${turnId}`) ?? null,
        agentName: (agentId) => agentId,
        sendHandoff: (input) =>
          state.failSend
            ? Effect.fail({ cause: new Error("The mailbox refused the handoff.") })
            : Effect.sync(() => {
                sent.push({
                  agentId: input.agentId,
                  text: input.text,
                  idempotencyKey: input.idempotencyKey,
                  runId: input.run.id,
                });
                const deliveryId = `handoff-${sent.length}`;
                deliveries.set(deliveryId, { status: "queued", turnId: null, error: null });
                return deliveryId;
              }),
        changed: (agentIds) => changed.push(agentIds),
        now: () => state.clock,
      }),
    ).then((handle) => {
      handles.push(handle);
      return handle;
    });
  const flows = await start();
  const routine = routines.create({
    agentId: "research",
    name: "Morning brief",
    instruction: "Collect the news.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "07:00" },
  });

  /** A run of the routine that its own agent answered, or that failed. */
  const finishRun = (outcome: { answer: string } | { error: string }, of: Routine = routine) => {
    const run = routines.createRun(of, null, "manual", new Date().toISOString());
    const deliveryId = `owner-${run.id}`;
    routines.attachDelivery(run.id, deliveryId);
    if ("answer" in outcome) {
      deliveries.set(deliveryId, { status: "completed", turnId: `turn-${run.id}`, error: null });
      answers.set(`${of.agentId}:turn-${run.id}`, outcome.answer);
      routines.updateRunStatus(run.id, "succeeded");
    } else {
      deliveries.set(deliveryId, { status: "failed", turnId: null, error: outcome.error });
      routines.updateRunStatus(run.id, "failed", outcome.error);
    }
    return run;
  };
  /** The agent answers the handoff it was sent. */
  const answer = (deliveryId: string, agentId: string, text: string) => {
    deliveries.set(deliveryId, { status: "completed", turnId: `turn-${deliveryId}`, error: null });
    answers.set(`${agentId}:turn-${deliveryId}`, text);
  };
  const connect = (fromAgentId: string, toAgentId: string, instruction = "") =>
    runCauseEffect(flows.connect({ routineId: routine.id, fromAgentId, toAgentId, instruction }));
  const stepsOf = (runId: string) =>
    Object.fromEntries(
      store
        .steps(runId)
        .map((step) => [
          step.agentId,
          { status: step.status, output: step.output, error: step.error, delivery: step.deliveryId },
        ]),
    );
  return {
    agents,
    database,
    routines,
    store,
    flows,
    routine,
    deliveries,
    sent,
    changed,
    state,
    start,
    finishRun,
    answer,
    connect,
    stepsOf,
  };
}

describe("routine flows", () => {
  it("hands the routine's answer to the next agent, and records the next answer", async () => {
    const { flows, finishRun, answer, connect, sent, stepsOf, changed } = await setup();
    await connect("research", "writer", "Write the brief.");
    const run = finishRun({ answer: "Three headlines." });

    await Effect.runPromise(flows.sweep());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ agentId: "writer", runId: run.id });
    expect(sent[0]?.text).toContain("Three headlines.");
    expect(sent[0]?.text).toContain("Write the brief.");
    expect(sent[0]?.idempotencyKey).not.toContain(":");
    expect(stepsOf(run.id)).toEqual({
      research: { status: "succeeded", output: "Three headlines.", error: null, delivery: null },
      writer: { status: "running", output: null, error: null, delivery: "handoff-1" },
    });

    answer("handoff-1", "writer", "The brief.");
    await Effect.runPromise(flows.sweep());
    expect(stepsOf(run.id).writer).toMatchObject({ status: "succeeded", output: "The brief." });
    expect(changed.flat()).toEqual(expect.arrayContaining(["research", "writer"]));
  });

  it("sends each handoff once, however many sweeps see the answer", async () => {
    const { flows, finishRun, connect, sent } = await setup();
    await connect("research", "writer");
    finishRun({ answer: "Three headlines." });

    await Promise.all([Effect.runPromise(flows.sweep()), Effect.runPromise(flows.sweep())]);
    await Effect.runPromise(flows.sweep());
    expect(sent.map((item) => item.agentId)).toEqual(["writer"]);
  });

  it("waits for every input, then sends them in one message", async () => {
    const { flows, finishRun, answer, connect, sent, stepsOf } = await setup();
    await connect("research", "sales");
    await connect("research", "writer");
    await connect("sales", "writer");
    const run = finishRun({ answer: "Three headlines." });

    await Effect.runPromise(flows.sweep());
    expect(sent.map((item) => item.agentId)).toEqual(["sales"]);
    expect(stepsOf(run.id).writer).toBeUndefined();

    answer("handoff-1", "sales", "Two deals moved.");
    await Effect.runPromise(flows.sweep());
    expect(sent.map((item) => item.agentId)).toEqual(["sales", "writer"]);
    expect(sent[1]?.text).toContain("Three headlines.");
    expect(sent[1]?.text).toContain("Two deals moved.");
  });

  it("skips an agent whose inputs failed, so the flow never waits", async () => {
    const { flows, finishRun, connect, sent, stepsOf } = await setup();
    await connect("research", "writer");
    await connect("writer", "chief");
    const run = finishRun({ error: "The provider is signed out." });

    await Effect.runPromise(flows.sweep());
    expect(sent).toEqual([]);
    expect(stepsOf(run.id)).toEqual({
      research: { status: "failed", output: null, error: "The provider is signed out.", delivery: null },
      writer: { status: "skipped", output: null, error: null, delivery: null },
      chief: { status: "skipped", output: null, error: null, delivery: null },
    });
  });

  it("fails a step it cannot send, and skips what comes after it", async () => {
    const { flows, finishRun, connect, stepsOf, state } = await setup();
    await connect("research", "writer");
    await connect("writer", "chief");
    const run = finishRun({ answer: "Three headlines." });
    state.failSend = true;

    await Effect.runPromise(flows.sweep());
    expect(stepsOf(run.id).writer).toMatchObject({
      status: "failed",
      error: "The routine could not pass the work on to this agent.",
    });
    expect(stepsOf(run.id).chief).toMatchObject({ status: "skipped" });
  });

  it("settles a step from its delivery when no turn ended, such as a failed start", async () => {
    const { flows, finishRun, connect, deliveries, stepsOf } = await setup();
    await connect("research", "writer");
    const run = finishRun({ answer: "Three headlines." });
    await Effect.runPromise(flows.sweep());

    deliveries.set("handoff-1", { status: "failed", turnId: null, error: "The provider refused the turn." });
    await Effect.runPromise(flows.sweep());
    expect(stepsOf(run.id).writer).toMatchObject({ status: "failed", error: "The provider refused the turn." });
  });

  it("resumes a flow after a restart between an answer and its handoff", async () => {
    const { store, finishRun, connect, sent, start } = await setup();
    await connect("research", "writer");
    const run = finishRun({ answer: "Three headlines." });
    // The answer was recorded, and the app stopped before the handoff went out.
    store.addStep({
      runId: run.id,
      agentId: "research",
      input: "Collect the news.",
      status: "succeeded",
      output: "Three headlines.",
    });

    const restarted = await start();
    await Effect.runPromise(restarted.sweep());
    expect(sent.map((item) => item.agentId)).toEqual(["writer"]);
  });

  it("does not hand an earlier run to a link made after it", async () => {
    const { flows, finishRun, connect, sent, stepsOf, state } = await setup();
    const run = finishRun({ answer: "Three headlines." });
    state.clock = new Date(Date.now() + 60_000);
    await connect("research", "writer");

    await Effect.runPromise(flows.sweep());
    expect(sent).toEqual([]);
    expect(stepsOf(run.id).research).toMatchObject({ status: "succeeded", output: "Three headlines." });
  });

  it("removes the links the flow no longer reaches with the link that reached them", async () => {
    const { flows, store, routine, connect } = await setup();
    const first = await connect("research", "writer");
    await connect("writer", "chief");
    await connect("research", "sales");

    await runCauseEffect(flows.disconnect({ linkId: first.id }));
    expect(store.linksForRoutines([routine.id]).map((link) => `${link.fromAgentId}>${link.toAgentId}`)).toEqual([
      "research>sales",
    ]);
  });

  it("refuses a link that would loop, with a sentence the user reads", async () => {
    const { connect } = await setup();
    await connect("research", "writer");
    await connect("writer", "chief");
    await expect(connect("chief", "writer")).rejects.toThrow("This connection would make a loop.");
  });

  it("drops a deleted agent's links, positions and steps", async () => {
    const { agents, flows, store, routine, finishRun, connect, stepsOf } = await setup();
    await connect("research", "writer");
    await runCauseEffect(flows.savePosition({ agentId: "writer", nodeKey: "agent:writer", x: 10, y: 20 }));
    await runCauseEffect(flows.savePosition({ agentId: "research", nodeKey: "agent:writer", x: 30, y: 40 }));
    const run = finishRun({ answer: "Three headlines." });
    await Effect.runPromise(flows.sweep());

    await runCauseEffect(agents.deleteAgent("writer"));
    expect(store.linksForRoutines([routine.id])).toEqual([]);
    expect(store.positions("writer")).toEqual([]);
    expect(store.positions("research")).toEqual([]);
    expect(Object.keys(stepsOf(run.id))).toEqual(["research"]);
  });

  it("shows an agent the routines that start it and the ones that pass work through it", async () => {
    const { flows, routines, connect } = await setup();
    await connect("research", "writer");
    const weekly = routines.create({
      agentId: "writer",
      name: "Weekly review",
      instruction: "Review the week.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    });

    const canvas = await runCauseEffect(flows.canvas("writer"));
    expect(canvas.routines.map((entry) => entry.routine.name).sort()).toEqual(["Morning brief", weekly.name]);
    expect(canvas.links.map((link) => `${link.fromAgentId}>${link.toAgentId}`)).toEqual(["research>writer"]);
    const morning = canvas.routines.find((entry) => entry.routine.name === "Morning brief");
    expect(morning?.upcomingRuns.length).toBeGreaterThan(0);
    expect(canvas.routines.find((entry) => entry.routine.id === weekly.id)?.upcomingRuns).toEqual([]);
  });
});
