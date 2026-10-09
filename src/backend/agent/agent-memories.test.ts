// @vitest-environment node
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  notification,
  openBotToolPayload,
  paramsRecord,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
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

describe.sequential("AgentMemories: staging, epochs and turn commitment", () => {
  it("commits an automatic memory only after a successful turn and refreshes the next turn context", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "I prefer concise status updates." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The memory test turn did not start.");
    const startRequest = client.requests.find((request) => request.method === "thread/start");
    expect(JSON.stringify(startRequest?.params)).toContain('"name":"remember"');
    expect(JSON.stringify(startRequest?.params)).toContain('"name":"forget_memory"');

    client.emit("request", {
      method: "item/tool/call",
      id: "remember-request",
      params: {
        threadId,
        turnId,
        callId: "remember-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { text: "The user prefers concise status updates." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "remember-request"));
    expect(service.listMemories("chief")).toEqual([]);

    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => service?.listMemories("chief").length === 1);
    expect(events).toContainEqual({ type: "memories-changed", agentId: "chief" });

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Prepare an update." }));
    await waitFor(() => client.requests.filter((request) => request.method === "thread/resume").length > 0);
    const resume = client.requests.findLast((request) => request.method === "thread/resume");
    expect(JSON.stringify(resume?.params)).toContain("The user prefers concise status updates.");
  });

  it("discards staged memories after a failed turn and preserves a concurrent manual edit", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const manual = service.createMemory({ agentId: "chief", text: "Use Bun for scripts." });
    await runCauseEffect(store.getOrCreate("research"));
    const otherMemory = service.createMemory({ agentId: "research", text: "Research-only memory." });
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Change my package manager preference." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The memory conflict turn did not start.");

    client.emit("request", {
      method: "item/tool/call",
      id: "foreign-memory-request",
      params: {
        threadId,
        turnId,
        callId: "foreign-memory-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { memoryId: otherMemory.id, text: "Changed by another agent." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "foreign-memory-request"));
    // The agent reads the refusal as the tool's result; the user gets no error toast (#1524).
    expect(client.responses.find((response) => response.id === "foreign-memory-request")?.result).toEqual({
      success: false,
      contentItems: [
        { type: "inputText", text: JSON.stringify({ error: "This memory does not belong to the current agent." }) },
      ],
    });
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(service.listMemories("research").map((memory) => memory.text)).toEqual(["Research-only memory."]);

    client.emit("request", {
      method: "item/tool/call",
      id: "update-memory-request",
      params: {
        threadId,
        turnId,
        callId: "update-memory-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { memoryId: manual.id, text: "Use npm for scripts." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "update-memory-request"));
    service.updateMemory({ agentId: "chief", memoryId: manual.id, text: "Use Bun 1.3 for scripts." });
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
    expect(service.listMemories("chief").map((memory) => memory.text)).toEqual(["Use Bun 1.3 for scripts."]);

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember one temporary value." }));
    await waitFor(() => events.filter((event) => event.type === "turn-started").length === 2);
    const failedTurnId = events.filter((event) => event.type === "turn-started")[1]?.turnId;
    if (!failedTurnId) throw new Error("The failed memory turn did not start.");
    client.emit("request", {
      method: "item/tool/call",
      id: "failed-memory-request",
      params: {
        threadId,
        turnId: failedTurnId,
        callId: "failed-memory-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { text: "This must not persist." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "failed-memory-request"));
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: failedTurnId, status: "failed" } }),
    );
    await waitFor(() => events.filter((event) => event.type === "turn-completed").length === 2);
    expect(service.listMemories("chief").map((memory) => memory.text)).toEqual(["Use Bun 1.3 for scripts."]);

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember a value, then stop." }));
    await waitFor(() => events.filter((event) => event.type === "turn-started").length === 3);
    const interruptedTurnId = events.filter((event) => event.type === "turn-started")[2]?.turnId;
    if (!interruptedTurnId) throw new Error("The interrupted memory turn did not start.");
    client.emit("request", {
      method: "item/tool/call",
      id: "interrupted-memory-request",
      params: {
        threadId,
        turnId: interruptedTurnId,
        callId: "interrupted-memory-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { text: "This interrupted value must not persist." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "interrupted-memory-request"));
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: interruptedTurnId, status: "interrupted" } }),
    );
    await waitFor(() => events.filter((event) => event.type === "turn-completed").length === 3);
    expect(service.listMemories("chief").map((memory) => memory.text)).toEqual(["Use Bun 1.3 for scripts."]);

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember a value while I clear memory." }));
    await waitFor(() => events.filter((event) => event.type === "turn-started").length === 4);
    const clearedTurnId = events.filter((event) => event.type === "turn-started")[3]?.turnId;
    if (!clearedTurnId) throw new Error("The clear-memory turn did not start.");
    client.emit("request", {
      method: "item/tool/call",
      id: "cleared-memory-request",
      params: {
        threadId,
        turnId: clearedTurnId,
        callId: "cleared-memory-call",
        namespace: "openbot",
        tool: "remember",
        arguments: { text: "This staged value must not return after clear." },
      },
    });
    await waitFor(() => client.responses.some((response) => response.id === "cleared-memory-request"));
    const memoryEventCount = events.filter((event) => event.type === "memories-changed").length;
    service.clearMemories("chief");
    expect(service.listMemories("chief")).toEqual([]);
    expect(events.filter((event) => event.type === "memories-changed")).toHaveLength(memoryEventCount + 1);
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: clearedTurnId, status: "completed" } }),
    );
    await waitFor(() => events.filter((event) => event.type === "turn-completed").length === 4);
    expect(service.listMemories("chief")).toEqual([]);
    expect(events.filter((event) => event.type === "memories-changed")).toHaveLength(memoryEventCount + 1);
  });

  it("refuses a new memory at the cap while the turn runs, and keeps one added after a forget", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      agentMemoryLimit: () => 2,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "DONE", false);
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const stale = service.createMemory({ agentId: "chief", text: "The release is on Friday." });
    service.createMemory({ agentId: "chief", text: "Use Bun for scripts." });
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "The release moved to Monday." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The memory cap turn did not start.");
    const startRequest = client.requests.find((request) => request.method === "thread/start");
    expect(JSON.stringify(startRequest?.params)).toContain('<agent_memories count=\\"2\\" limit=\\"2\\">');

    const refused = await callOpenBotTool(client, threadId, "remember", { text: "The release is on Monday." }, turnId);
    expect(paramsRecord(refused.result)?.success).toBe(false);
    expect(openBotToolPayload(refused.result).error).toBe(
      "You have 2 of 2 memories. Merge a memory into another with remember and its memoryId, or forget a stale one, then try again.",
    );

    await callOpenBotTool(client, threadId, "forget_memory", { memoryId: stale.id }, turnId);
    const staged = await callOpenBotTool(client, threadId, "remember", { text: "The release is on Monday." }, turnId);
    expect(openBotToolPayload(staged.result).status).toBe("staged");

    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
    expect(
      service
        .listMemories("chief")
        .map((memory) => memory.text)
        .sort(),
    ).toEqual(["The release is on Monday.", "Use Bun for scripts."]);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });
});
