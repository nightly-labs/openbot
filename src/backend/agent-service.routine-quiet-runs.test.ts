// @vitest-environment node
import { type AgentEvent, type Routine, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROUTINE_NO_UPDATE_MARKER } from "./agent/routine-quiet-runs";
import { AgentRoutineStore } from "./agent-routine-store";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  firstInputText,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { runCauseEffect } from "./effect-boundary";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

const MEMBER = "member-1";

interface RoutineRunResult {
  routine: Routine;
  prompt: string | null;
  completed: Extract<AgentEvent, { type: "turn-completed" }>;
  assistantTexts: string[];
  runStatuses: string[];
  unreadCount: number | undefined;
  preview: string | undefined;
  runs: ReturnType<AgentService["listRoutineRuns"]>;
}

/**
 * Runs one routine through the whole service: a provider turn that answers `output`, the turn
 * completion and the run marker. A scheduled run is left pending before a restart, which the start
 * resumes, so the test needs no clock.
 */
async function runRoutine(options: { output: string; kind: "scheduled" | "manual" }): Promise<RoutineRunResult> {
  const clients: FakeAgentClient[] = [];
  const { store, mailbox } = stores(root);
  const build = () =>
    createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, options.output);
        clients.push(client);
        return client;
      },
    });
  service = build();
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("watch"));
  const routine = service.createRoutine({
    agentId: agent.id,
    name: "Alert queue",
    instruction: `Check the alert queue and report new alerts. If there is nothing new, answer ${ROUTINE_NO_UPDATE_MARKER}.`,
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  // Sets the read cursor of the member, so a later answer counts as unread.
  expect((await runCauseEffect(service.readConversationPageFor(agent.id, MEMBER))).readState?.unreadCount).toBe(0);

  const events: AgentEvent[] = [];
  if (options.kind === "scheduled") {
    await runCauseEffect(service.stop());
    new AgentRoutineStore(store.database).createRun(
      routine,
      routine.trigger.id,
      "scheduled",
      "2026-10-08T09:00:00.000Z",
    );
    service = build();
    service.on("event", (event: AgentEvent) => events.push(event));
    await runCauseEffect(service.initialize());
  } else {
    service.on("event", (event: AgentEvent) => events.push(event));
    await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }));
  }
  await waitFor(() => events.some((event) => event.type === "turn-completed" && event.agentId === agent.id));
  const completed = events.find(
    (event): event is Extract<AgentEvent, { type: "turn-completed" }> =>
      event.type === "turn-completed" && event.agentId === agent.id,
  );
  if (!completed) throw new Error("The routine turn did not complete.");
  const running = service;
  await waitFor(() =>
    running.listRoutineRuns({ agentId: agent.id, routineId: routine.id }).some((run) => run.status === "succeeded"),
  );

  const conversation = await runCauseEffect(service.readConversation(agent.id));
  const prompt = clients
    .flatMap((client) => client.requests)
    .filter((request) => request.method === "turn/start")
    .map((request) => firstInputText(request.params))
    .at(-1);
  return {
    routine,
    prompt: prompt ?? null,
    completed,
    assistantTexts: conversation.messages
      .filter((message) => message.author === "assistant")
      .map((message) => message.text),
    runStatuses: conversation.messages.flatMap((message) => routineRunConversationEvent(message)?.status ?? []),
    unreadCount: (await runCauseEffect(service.readConversationPageFor(agent.id, MEMBER))).readState?.unreadCount,
    preview: service.listAgents().find((candidate) => candidate.id === agent.id)?.preview,
    runs: service.listRoutineRuns({ agentId: agent.id, routineId: routine.id }),
  };
}

describe.sequential("AgentService: routine runs that answer only the no-update marker", () => {
  it("posts nothing for a scheduled run that answers only the marker", async () => {
    const result = await runRoutine({ output: `  ${ROUTINE_NO_UPDATE_MARKER}\n`, kind: "scheduled" });

    // OpenBot adds no marker instruction of its own: the user writes it in the routine task.
    expect(result.prompt).not.toContain("answer with exactly");
    expect(result.assistantTexts).toEqual([]);
    // The run keeps its compact marker and its history entry.
    expect(result.runStatuses).toContain("succeeded");
    expect(result.runs).toEqual([expect.objectContaining({ kind: "scheduled", status: "succeeded" })]);
    expect(result.unreadCount).toBe(0);
    expect(result.completed).toMatchObject({ status: "completed", origin: "routine", quiet: true });
    // The run start shows the routine task in the preview, as for every run; the quiet turn does not
    // replace it with its answer.
    expect(result.preview).toBe(result.routine.instruction);
  });

  it("posts a scheduled run's report as usual, also when the report mentions the marker", async () => {
    const report = `Two new alerts: disk full on db-1. ${ROUTINE_NO_UPDATE_MARKER}`;
    const result = await runRoutine({ output: report, kind: "scheduled" });

    expect(result.assistantTexts).toEqual([report]);
    expect(result.runStatuses).toContain("succeeded");
    expect(result.unreadCount).toBe(1);
    expect(result.completed.quiet).toBeUndefined();
    expect(result.preview).toContain("disk full on db-1");
  });

  it("shows the result of a Test run, which someone waits for", async () => {
    const result = await runRoutine({ output: ROUTINE_NO_UPDATE_MARKER, kind: "manual" });

    expect(result.prompt).not.toContain("answer with exactly");
    expect(result.assistantTexts).toEqual([ROUTINE_NO_UPDATE_MARKER]);
    expect(result.unreadCount).toBe(1);
    expect(result.completed.quiet).toBeUndefined();
  });
});
