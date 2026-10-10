// @vitest-environment node
import { type AgentEvent, routineRunConversationEvent } from "@openbot/contracts/ipc";
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
import { getString } from "./protocol";

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
const PREVIEW_BEFORE = "Deploy finished.";

interface RoutineRunResult {
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
 * resumes, so the test needs no clock. `webhook` and `webhook-test` use a webhook routine: one
 * verified request, or a Test run of the same routine.
 */
async function runRoutine(options: {
  output: string;
  kind: "scheduled" | "manual" | "webhook" | "webhook-test";
  /** Restarts the service after the run, and the provider history then has the run's turn. */
  importHistory?: boolean;
}): Promise<RoutineRunResult> {
  const clients: FakeAgentClient[] = [];
  let history: unknown[] = [];
  const { store, mailbox } = stores(root);
  const build = () =>
    createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, options.output);
        client.threadRead = (params) => ({ thread: { id: getString(params, "threadId"), turns: history } });
        clients.push(client);
        return client;
      },
    });
  service = build();
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("watch"));
  const owner = { kind: "agent", id: agent.id } as const;
  const fields = {
    name: "Alert queue",
    instruction: `Check the alert queue and report new alerts. If there is nothing new, answer ${ROUTINE_NO_UPDATE_MARKER}.`,
    active: true,
    timezone: "UTC",
  };
  const webhook = options.kind === "webhook" || options.kind === "webhook-test";
  const scheduled = webhook
    ? null
    : service.createRoutine({ agentId: agent.id, ...fields, schedule: { kind: "daily", time: "09:00" } });
  const routineId =
    scheduled?.id ??
    service.routineRecords.save(owner, undefined, {
      ...fields,
      trigger: { kind: "webhook", eventType: null, filters: [], secretCiphertext: "sealed-secret" },
    }).id;
  // The last real message the sidebar shows before the run.
  await runCauseEffect(store.updatePreview(agent.id, PREVIEW_BEFORE));
  // Sets the read cursor of the member, so a later answer counts as unread.
  expect((await runCauseEffect(service.readConversationPageFor(agent.id, MEMBER))).readState?.unreadCount).toBe(0);

  const events: AgentEvent[] = [];
  if (options.kind === "scheduled") {
    await runCauseEffect(service.stop());
    if (!scheduled) throw new Error("A scheduled run needs a scheduled routine.");
    new AgentRoutineStore(store.database).createRun(
      scheduled,
      scheduled.trigger.id,
      "scheduled",
      "2026-10-08T09:00:00.000Z",
    );
    service = build();
    service.on("event", (event: AgentEvent) => events.push(event));
    await runCauseEffect(service.initialize());
  } else {
    service.on("event", (event: AgentEvent) => events.push(event));
    if (options.kind === "webhook") {
      const received = await runCauseEffect(
        service.routineRecords.receiveWebhook(owner, routineId, {
          deliveryId: "linear-delivery-1",
          eventType: "Issue.create",
          data: { title: "Typo in the footer" },
          occurredAt: "2026-10-08T09:00:00.000Z",
          receivedAt: new Date().toISOString(),
        }),
      );
      expect(received.kind).toBe("started");
    } else if (options.kind === "webhook-test") {
      await runCauseEffect(service.routineRecords.test(owner, routineId));
    } else {
      await runCauseEffect(service.testRoutine({ agentId: agent.id, routineId }));
    }
  }
  await waitFor(() => events.some((event) => event.type === "turn-completed" && event.agentId === agent.id));
  const completed = events.find(
    (event): event is Extract<AgentEvent, { type: "turn-completed" }> =>
      event.type === "turn-completed" && event.agentId === agent.id,
  );
  if (!completed) throw new Error("The routine turn did not complete.");
  const running = service;
  await waitFor(() =>
    running.listRoutineRuns({ agentId: agent.id, routineId }).some((run) => run.status === "succeeded"),
  );
  if (options.importHistory) {
    const deliveryId = running.listRoutineRuns({ agentId: agent.id, routineId })[0]?.deliveryId;
    history = [
      {
        id: completed.turnId,
        status: "completed",
        items: [
          {
            id: "provider-prompt",
            type: "userMessage",
            clientId: deliveryId,
            content: [{ type: "text", text: "Run." }],
          },
          { id: "provider-answer", type: "agentMessage", text: options.output },
        ],
      },
    ];
    await runCauseEffect(running.stop());
    service = build();
    await runCauseEffect(service.initialize());
    const imported = store.database.connection.prepare(
      "SELECT 1 FROM provider_history_turns WHERE turn_id = ? AND imported = 1",
    );
    await waitFor(() => imported.get(completed.turnId) !== undefined);
  }

  const conversation = await runCauseEffect(service.readConversation(agent.id));
  const prompt = clients
    .flatMap((client) => client.requests)
    .filter((request) => request.method === "turn/start")
    .map((request) => firstInputText(request.params))
    .at(-1);
  return {
    prompt: prompt ?? null,
    completed,
    assistantTexts: conversation.messages
      .filter((message) => message.author === "assistant")
      .map((message) => message.text),
    runStatuses: conversation.messages.flatMap((message) => routineRunConversationEvent(message)?.status ?? []),
    unreadCount: (await runCauseEffect(service.readConversationPageFor(agent.id, MEMBER))).readState?.unreadCount,
    preview: service.listAgents().find((candidate) => candidate.id === agent.id)?.preview,
    runs: service.listRoutineRuns({ agentId: agent.id, routineId }),
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
    // The run start shows the routine task in the preview; the quiet turn puts the earlier one back.
    expect(result.preview).toBe(PREVIEW_BEFORE);
  });

  it("posts a scheduled run's report as usual, also when the report mentions the marker", async () => {
    const report = `Two new alerts: disk full on db-1. ${ROUTINE_NO_UPDATE_MARKER}`;
    const result = await runRoutine({ output: report, kind: "scheduled" });

    expect(result.assistantTexts).toEqual([report]);
    expect(result.runStatuses).toContain("succeeded");
    expect(result.unreadCount).toBe(1);
    expect(result.completed.quiet).toBeUndefined();
    expect(result.preview).toBe(report);
  });

  it("shows the result of a Test run, which someone waits for", async () => {
    const result = await runRoutine({ output: ROUTINE_NO_UPDATE_MARKER, kind: "manual" });

    expect(result.prompt).not.toContain("answer with exactly");
    expect(result.assistantTexts).toEqual([ROUTINE_NO_UPDATE_MARKER]);
    expect(result.unreadCount).toBe(1);
    expect(result.completed.quiet).toBeUndefined();
    // The chat shows the marker, but the preview does not: it goes back to the one before the run.
    expect(result.preview).toBe(PREVIEW_BEFORE);
  });

  it("posts nothing for a webhook run that answers only the marker", async () => {
    const result = await runRoutine({ output: ROUTINE_NO_UPDATE_MARKER, kind: "webhook" });

    // The webhook sender is a program, so no person waits for this answer in the chat.
    expect(result.assistantTexts).toEqual([]);
    expect(result.runs).toEqual([expect.objectContaining({ kind: "manual", status: "succeeded" })]);
    expect(result.unreadCount).toBe(0);
    expect(result.completed).toMatchObject({ status: "completed", origin: "routine", quiet: true });
    expect(result.preview).toBe(PREVIEW_BEFORE);
  });

  it("shows the result of a Test run of a webhook routine", async () => {
    const result = await runRoutine({ output: ROUTINE_NO_UPDATE_MARKER, kind: "webhook-test" });

    expect(result.assistantTexts).toEqual([ROUTINE_NO_UPDATE_MARKER]);
    expect(result.unreadCount).toBe(1);
    expect(result.completed.quiet).toBeUndefined();
  });

  it("keeps a quiet webhook run quiet when a restart imports the provider history", async () => {
    const result = await runRoutine({ output: ROUTINE_NO_UPDATE_MARKER, kind: "webhook", importHistory: true });

    expect(result.assistantTexts).toEqual([]);
    expect(result.unreadCount).toBe(0);
  });
});
