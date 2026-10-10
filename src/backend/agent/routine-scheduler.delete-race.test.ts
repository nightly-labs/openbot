// @vitest-environment node
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "../agent-service";
import { createTestService, startAgentTestFixture, stopAgentTestFixture, stores } from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("RoutineScheduler: delete during an in-flight enqueue", () => {
  it("does not leave a live delivery for a routine deleted while its run was being enqueued", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Racing routine",
      instruction: "Do the work of the routine.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const enqueue = mailbox.enqueue.bind(mailbox);
    vi.spyOn(mailbox, "enqueue").mockImplementation((input) =>
      Effect.gen(function* () {
        if (input.sender.kind === "routine" && input.sender.routineId === routine.id) {
          entered = true;
          yield* Effect.promise(() => gate);
        }
        return yield* enqueue(input);
      }),
    );

    // The run row exists (status queued, no delivery yet) and the enqueue is suspended at an await.
    const fired = runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id })).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.waitFor(() => expect(entered).toBe(true));

    // The user deletes the routine while the enqueue is suspended.
    await runCauseEffect(service.deleteRoutine({ agentId: agent.id, routineId: routine.id }));
    expect(service.listRoutines(agent.id)).toEqual([]);

    release();
    const outcome = await fired;
    // The run left with its routine: the caller hears that, not a failure to mark the run.
    expect(outcome.ok ? "resolved" : String(outcome.error)).toContain("This routine no longer exists.");
    const conversation = await runCauseEffect(service.readConversation(agent.id));
    expect(conversation.messages.filter((message) => message.itemType?.includes("failed:"))).toEqual([]);

    const routineDeliveries = service
      .listQueue(agent.id)
      .deliveries.filter((delivery) => delivery.sender.kind === "routine" && delivery.sender.routineId === routine.id);
    // A deleted routine must not keep live work in the agent's queue.
    expect(
      routineDeliveries.filter((delivery) => ["queued", "starting", "running", "completed"].includes(delivery.status)),
    ).toEqual([]);
  });
});
