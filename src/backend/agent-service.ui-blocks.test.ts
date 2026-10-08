import type { AgentEvent, ConversationMessage } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  type UiBlockingBlockSpec,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
} from "@openbot/contracts/ui-blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  notification,
  openBotToolPayload,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import { runCauseEffect } from "./effect-boundary";

const LETTER: UiBlockingBlockSpec = {
  type: "confirm",
  title: "Send the letter to Ann?",
  danger: true,
  fields: [
    { label: "To", value: "ann@example.com" },
    { label: "From", select: "from", options: ["me@example.com", "team@example.com"] },
  ],
  preview: "Hi Ann, the report is ready.",
  actions: [
    { id: "send", label: "Send", style: "primary" },
    { id: "cancel", label: "Cancel" },
  ],
};

const REPLIES: UiBlockingBlockSpec = {
  type: "quick_replies",
  title: "Which report?",
  options: [
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
  ],
};

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

interface Turn {
  service: AgentService;
  client: FakeAgentClient;
  events: AgentEvent[];
  threadId: string;
  turnId: string;
}

async function startTurn(): Promise<Turn> {
  const { store, mailbox } = stores(root);
  let client: FakeAgentClient | null = null;
  const started = createTestService({
    store,
    mailbox,
    preferredProvider: "codex",
    clientFactory: (provider) => {
      client = new FakeAgentClient(provider, "DONE", false);
      return client;
    },
  });
  service = started;
  const events: AgentEvent[] = [];
  started.on("event", (event) => events.push(event));
  await runCauseEffect(started.initialize());
  await runCauseEffect(started.sendMessage({ agentId: "chief", text: "Ask with a block" }));
  await waitFor(() => events.some((event) => event.type === "turn-started"));
  const threadId = store.activeProviderSession("chief")?.externalSessionId;
  const turnId = events.find((event) => event.type === "turn-started")?.turnId;
  if (!client || !threadId || !turnId) throw new Error("The turn did not start.");
  return { service: started, client, events, threadId, turnId };
}

function askUi(turn: Turn, id: string, args: unknown): void {
  turn.client.emit("request", {
    method: "item/tool/call",
    id,
    params: {
      threadId: turn.threadId,
      turnId: turn.turnId,
      callId: id,
      namespace: "openbot",
      tool: "ask_ui",
      arguments: args,
    },
  });
}

async function blockMessage(turn: Turn, requestId: string): Promise<ConversationMessage | undefined> {
  return (await runCauseEffect(turn.service.readConversation("chief"))).messages.find(
    (message) => message.questionPrompt?.requestId === requestId,
  );
}

function providerResult(turn: Turn, requestId: string): { success: unknown; payload: DynamicRecord } {
  const result = turn.client.responses.find((response) => response.id === requestId)?.result;
  if (!isDynamicRecord(result)) throw new Error(`No result for ${requestId}.`);
  return { success: result.success, payload: openBotToolPayload(result) };
}

describe.sequential("AgentService: ask_ui blocks", () => {
  it("shows a block as a question prompt and returns the structured answer of a new client", async () => {
    const turn = await startTurn();
    askUi(turn, "letter", { blockId: "letter-1", block: LETTER });
    await waitFor(() => turn.events.some((event) => event.type === "prompt"));

    expect(turn.client.responses).toHaveLength(0);
    const questions = uiBlockFallbackQuestions(LETTER);
    expect(turn.events).toContainEqual(expect.objectContaining({ type: "prompt", requestId: "letter", questions }));
    expect(await blockMessage(turn, "letter")).toMatchObject({
      itemType: "question_prompt",
      questionPrompt: { questions, resolution: null },
      uiBlock: { version: 1, blockId: "letter-1", spec: LETTER, state: { status: "pending" } },
    });

    // The owner at this computer answers with the answers a client that knows the block sends.
    const answers = uiBlockAnswersFromResponse(LETTER, { actionId: "send", values: { from: "team@example.com" } });
    await runCauseEffect(turn.service.respondToPrompt({ requestId: "letter", answers }));

    expect(providerResult(turn, "letter")).toEqual({
      success: true,
      payload: { status: "answered", blockId: "letter-1", actionId: "send", values: { from: "team@example.com" } },
    });
    const answered = await blockMessage(turn, "letter");
    expect(answered?.questionPrompt?.resolution).toMatchObject({ status: "answered" });
    expect(answered?.uiBlock?.state).toEqual({
      status: "answered",
      response: { actionId: "send", values: { from: "team@example.com" } },
      outcome: "Send · team@example.com",
      respondedAt: expect.any(String),
    });
    await expect(runCauseEffect(turn.service.respondToPrompt({ requestId: "letter", answers }))).rejects.toThrow(
      "This prompt is no longer active.",
    );
  });

  it("reads the answer of a client that only shows the fallback question", async () => {
    const turn = await startTurn();
    askUi(turn, "by-label", { blockId: "report", block: REPLIES });
    askUi(turn, "in-words", { block: REPLIES });
    await waitFor(() => turn.events.filter((event) => event.type === "prompt").length === 2);

    await runCauseEffect(turn.service.respondToPrompt({ requestId: "by-label", answers: { reply: ["Monthly"] } }));
    expect(providerResult(turn, "by-label").payload).toEqual({
      status: "answered",
      blockId: "report",
      actionId: "monthly",
    });
    expect((await blockMessage(turn, "by-label"))?.uiBlock?.state).toMatchObject({
      status: "answered",
      outcome: "Monthly",
    });

    await runCauseEffect(turn.service.respondToPrompt({ requestId: "in-words", answers: { reply: ["Both, please"] } }));
    expect(providerResult(turn, "in-words").payload).toEqual({
      status: "answered",
      blockId: expect.any(String),
      actionId: "_text",
      text: "Both, please",
    });
  });

  it("takes a privileged action only from the owner or an admin", async () => {
    const turn = await startTurn();
    askUi(turn, "danger", { block: LETTER });
    await waitFor(() => turn.events.some((event) => event.type === "prompt"));
    const member = { id: "member-1", name: "Member" };

    await expect(
      runCauseEffect(
        turn.service.respondToPrompt(
          { requestId: "danger", answers: { action: ["Send"] } },
          { sender: member, privileged: false },
        ),
      ),
    ).rejects.toThrow("Only the server owner or an admin can choose this action.");
    expect(turn.client.responses).toHaveLength(0);
    expect((await blockMessage(turn, "danger"))?.uiBlock?.state).toEqual({ status: "pending" });

    // A member may still take an action that is not privileged.
    await runCauseEffect(
      turn.service.respondToPrompt(
        { requestId: "danger", answers: { action: ["Cancel"] } },
        { sender: member, privileged: false },
      ),
    );
    expect(providerResult(turn, "danger").payload).toMatchObject({ status: "answered", actionId: "cancel" });
    expect((await blockMessage(turn, "danger"))?.uiBlock?.state).toMatchObject({
      status: "answered",
      respondedBy: member,
    });

    askUi(turn, "admin", { block: LETTER });
    await waitFor(() => turn.events.filter((event) => event.type === "prompt").length === 2);
    await runCauseEffect(
      turn.service.respondToPrompt(
        { requestId: "admin", answers: { action: ["Send"] } },
        { sender: { id: "admin-1", name: "Admin" }, privileged: true },
      ),
    );
    expect(providerResult(turn, "admin").payload).toMatchObject({ status: "answered", actionId: "send" });
  });

  it("refuses an answer in words from a member when the block has a privileged action", async () => {
    const turn = await startTurn();
    askUi(turn, "words", { block: LETTER });
    await waitFor(() => turn.events.some((event) => event.type === "prompt"));
    const member = { id: "member-1", name: "Member" };

    await expect(
      runCauseEffect(
        turn.service.respondToPrompt(
          { requestId: "words", answers: { action: ["Yes, go ahead"] } },
          { sender: member, privileged: false },
        ),
      ),
    ).rejects.toThrow("Only the server owner or an admin can choose this action.");
    expect(turn.client.responses).toHaveLength(0);
    expect((await blockMessage(turn, "words"))?.uiBlock?.state).toEqual({ status: "pending" });

    // A member may still skip the block.
    await runCauseEffect(
      turn.service.respondToPrompt(
        { requestId: "words", answers: { action: [] } },
        { sender: member, privileged: false },
      ),
    );
    expect(providerResult(turn, "words").payload).toMatchObject({ status: "skipped" });
    expect((await blockMessage(turn, "words"))?.uiBlock?.state).toMatchObject({ status: "closed" });

    // On a block with no privileged action a member may answer in words.
    askUi(turn, "replies", { block: REPLIES });
    await waitFor(() => turn.events.filter((event) => event.type === "prompt").length === 2);
    await runCauseEffect(
      turn.service.respondToPrompt(
        { requestId: "replies", answers: { reply: ["Both, please"] } },
        { sender: member, privileged: false },
      ),
    );
    expect(providerResult(turn, "replies").payload).toMatchObject({ status: "answered", actionId: "_text" });

    // The owner may answer in words on a privileged block.
    askUi(turn, "owner", { block: LETTER });
    await waitFor(() => turn.events.filter((event) => event.type === "prompt").length === 3);
    await runCauseEffect(
      turn.service.respondToPrompt(
        { requestId: "owner", answers: { action: ["Yes, go ahead"] } },
        { sender: { id: "admin-1", name: "Admin" }, privileged: true },
      ),
    );
    expect(providerResult(turn, "owner").payload).toMatchObject({ status: "answered", actionId: "_text" });
  });

  it("expires an open block when the turn ends", async () => {
    const turn = await startTurn();
    askUi(turn, "late", { blockId: "late-block", block: REPLIES });
    await waitFor(() => turn.events.some((event) => event.type === "prompt"));

    turn.client.emit(
      "notification",
      notification("turn/completed", { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } }),
    );
    await waitFor(() => turn.client.responses.some((response) => response.id === "late"));

    expect(providerResult(turn, "late")).toMatchObject({
      success: false,
      payload: { status: "expired", blockId: "late-block" },
    });
    const expired = await blockMessage(turn, "late");
    expect(expired?.questionPrompt?.resolution).toEqual({ status: "expired" });
    expect(expired?.uiBlock?.state).toEqual({ status: "expired" });
  });

  it("refuses a block that breaks a rule and shows nothing", async () => {
    const turn = await startTurn();
    const duplicateLabels = {
      block: {
        type: "quick_replies",
        options: [
          { id: "a", label: "Same" },
          { id: "b", label: "same" },
        ],
      },
    };
    askUi(turn, "duplicate", duplicateLabels);
    askUi(turn, "display", { block: { type: "alert", severity: "info", title: "Not a blocking block" } });
    await waitFor(() => turn.client.responses.length === 2);

    expect(providerResult(turn, "duplicate")).toMatchObject({
      success: false,
      payload: { error: expect.stringContaining("option labels must be unique") },
    });
    expect(providerResult(turn, "display")).toMatchObject({
      success: false,
      payload: { error: expect.stringContaining("Correct the arguments and retry.") },
    });
    expect(turn.events.some((event) => event.type === "prompt")).toBe(false);
  });

  it("expires a persisted open block after restart", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Start a recoverable turn" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const agent = await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(service.stop());
    const snapshot = store.database.readConversation("chief", agent.threadId);
    snapshot.activeTurnId = "turn-with-block";
    snapshot.messages.push({
      id: "question-prompt:turn-with-block:request-1",
      turnId: "turn-with-block",
      author: "assistant",
      source: "assistant",
      text: "",
      createdAt: "2026-10-08T12:00:00.000Z",
      status: "completed",
      itemType: "question_prompt",
      questionPrompt: { requestId: "request-1", questions: uiBlockFallbackQuestions(REPLIES), resolution: null },
      uiBlock: { version: 1, blockId: "report", spec: REPLIES, state: { status: "pending" } },
    });
    store.database.persistConversation(snapshot, "test.ui-block-pending");

    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());

    const recovered = (await runCauseEffect(service.readConversation("chief"))).messages.find(
      (message) => message.uiBlock,
    );
    expect(recovered?.questionPrompt?.resolution).toEqual({ status: "expired" });
    expect(recovered?.uiBlock?.state).toEqual({ status: "expired" });
  });
});
