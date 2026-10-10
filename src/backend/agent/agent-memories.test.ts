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
  it.each(["edit", "delete"])("does not recreate a user-controlled duplicate after a concurrent %s", async (action) => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "DONE", false);
    const active = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
    service = active;
    const events: AgentEvent[] = [];
    active.on("event", (event) => events.push(event));
    await runCauseEffect(active.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const original = active.createMemory({ agentId: "chief", text: "The launch code is amber." });
    active.setMemoryInclusion({
      agentId: "chief",
      changes: [{ memoryId: original.id, inclusion: "essential", expectedRevision: 0 }],
    });
    await runCauseEffect(active.sendMessage({ agentId: "chief", text: "Remember the launch code." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!threadId || !turnId) throw new Error("The user-controlled duplicate turn did not start.");
    const duplicate = await callOpenBotTool(
      client,
      threadId,
      "remember",
      { text: original.text, inclusion: "essential" },
      turnId,
    );
    expect(duplicate.result).toMatchObject({ success: true });
    if (action === "edit")
      active.updateMemory({ agentId: "chief", memoryId: original.id, text: "The launch code is violet." });
    else active.deleteMemory({ agentId: "chief", memoryId: original.id });
    const saved = active.listMemories("chief");
    const selection = active.getMemorySelection("chief");
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
    expect(active.listMemories("chief")).toEqual(saved);
    expect(active.getMemorySelection("chief")).toEqual(selection);
  });

  it.each(["completed", "failed", "interrupted", "edited", "pinned"])(
    "applies duplicate selection without changing saved data or overriding newer choices: %s",
    async (outcome) => {
      const { store, mailbox } = stores(root);
      const client = new FakeAgentClient("codex", "DONE", false);
      const active = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
      service = active;
      const events: AgentEvent[] = [];
      active.on("event", (event) => events.push(event));
      await runCauseEffect(active.initialize());
      await runCauseEffect(store.getOrCreate("chief"));
      const original = active.createMemory({ agentId: "chief", text: `Fact 0 ${"界".repeat(470)}` });
      for (let index = 1; index < 5; index++)
        active.createMemory({ agentId: "chief", text: `Fact ${index} ${"界".repeat(470)}` });
      active.initializeMemorySelection("chief");
      expect(active.getMemorySelection("chief").selections.every((entry) => entry.inclusion === "essential")).toBe(
        true,
      );
      await runCauseEffect(active.sendMessage({ agentId: "chief", text: "Replace one essential fact." }));
      await waitFor(() => events.some((event) => event.type === "turn-started"));
      const threadId = store.activeProviderSession("chief")?.externalSessionId;
      const turnId = events.find((event) => event.type === "turn-started")?.turnId;
      if (!threadId || !turnId) throw new Error("The duplicate selection turn did not start.");
      const duplicate = await callOpenBotTool(
        client,
        threadId,
        "remember",
        { text: original.text, inclusion: "searchable" },
        turnId,
      );
      expect(openBotToolPayload(duplicate.result)).toMatchObject({ status: "staged", inclusion: "searchable" });
      const replacementText = `Replacement ${"界".repeat(470)}`;
      const replacement = await callOpenBotTool(
        client,
        threadId,
        "remember",
        { text: replacementText, inclusion: "essential" },
        turnId,
      );
      expect(openBotToolPayload(replacement.result)).toMatchObject({ status: "staged", inclusion: "essential" });
      expect(active.listMemories("chief")).toHaveLength(5);
      expect(active.getMemorySelection("chief").selections.every((entry) => entry.inclusion === "essential")).toBe(
        true,
      );
      if (outcome === "edited")
        active.updateMemory({ agentId: "chief", memoryId: original.id, text: `${original.text} new` });
      if (outcome === "pinned") {
        const selection = active.getMemorySelection("chief").selections.find((entry) => entry.memoryId === original.id);
        if (!selection) throw new Error("The duplicate selection is missing.");
        active.setMemoryInclusion({
          agentId: "chief",
          changes: [{ memoryId: original.id, inclusion: "essential", expectedRevision: selection.revision }],
        });
      }
      const beforeCommit = active.listMemories("chief");
      const status = outcome === "failed" || outcome === "interrupted" ? outcome : "completed";
      client.emit("notification", notification("turn/completed", { threadId, turn: { id: turnId, status } }));
      await waitFor(() => events.some((event) => event.type === "turn-completed"));
      const memories = active.listMemories("chief");
      expect(memories.filter((entry) => entry.text !== replacementText)).toEqual(beforeCommit);
      const selection = active.getMemorySelection("chief");
      expect(selection.selections.find((entry) => entry.memoryId === original.id)).toMatchObject({
        inclusion: outcome === "completed" ? "searchable" : "essential",
        userControlled: outcome === "pinned",
      });
      if (status === "completed") {
        const saved = memories.find((entry) => entry.text === replacementText);
        expect(memories).toHaveLength(6);
        expect(selection.selections.find((entry) => entry.memoryId === saved?.id)?.inclusion).toBe(
          outcome === "completed" ? "essential" : "searchable",
        );
      } else expect(memories).toHaveLength(5);
      expect(selection.usedBytes).toBeLessThanOrEqual(selection.budgetBytes);
    },
  );

  it("recalls committed facts without exposing another agent or uncommitted changes", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "DONE", false);
    const active = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
    service = active;
    const events: AgentEvent[] = [];
    active.on("event", (event) => events.push(event));
    await runCauseEffect(active.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("research"));
    const own = active.createMemory({ agentId: "chief", text: "The telescope project uses amber labels." });
    active.createMemory({ agentId: "research", text: "The telescope project uses private violet labels." });
    await runCauseEffect(active.sendMessage({ agentId: "chief", text: "Find the telescope label color." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!threadId || !turnId) throw new Error("The recall turn did not start.");
    expect(JSON.stringify(client.requests.find((request) => request.method === "thread/start")?.params)).not.toContain(
      own.text,
    );
    const recalled = await callOpenBotTool(client, threadId, "search_memories", { query: "telescope" }, turnId);
    expect(openBotToolPayload(recalled.result).memories).toEqual([
      expect.objectContaining({ id: own.id, text: own.text, inclusion: "searchable" }),
    ]);
    await callOpenBotTool(client, threadId, "remember", { text: "The lighthouse project uses green labels." }, turnId);
    const pending = await callOpenBotTool(client, threadId, "search_memories", { query: "lighthouse" }, turnId);
    expect(openBotToolPayload(pending.result).memories).toEqual([]);
    const revision = active.getMemorySelection("chief").selections[0]?.revision;
    if (revision === undefined) throw new Error("The selection is missing.");
    await callOpenBotTool(
      client,
      threadId,
      "set_memory_inclusion",
      { changes: [{ memoryId: own.id, inclusion: "essential", expectedRevision: revision }] },
      turnId,
    );
    const corrected = "The telescope project uses orange labels.";
    await callOpenBotTool(client, threadId, "remember", { memoryId: own.id, text: corrected }, turnId);
    expect(active.getMemorySelection("chief").selections[0]?.inclusion).toBe("searchable");
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
    expect(active.getMemorySelection("chief").selections.find((entry) => entry.memoryId === own.id)?.inclusion).toBe(
      "essential",
    );
    await runCauseEffect(active.sendMessage({ agentId: "chief", text: "Continue." }));
    await waitFor(() => client.requests.some((request) => request.method === "thread/resume"));
    const resumed = JSON.stringify(client.requests.findLast((request) => request.method === "thread/resume")?.params);
    expect(resumed).toContain(corrected);
    expect(resumed).not.toContain("The lighthouse project uses green labels.");
  });

  it.each(["failed", "completed"])(
    "preserves user choices and applies no partial selection after a %s turn",
    async (status) => {
      const { store, mailbox } = stores(root);
      const client = new FakeAgentClient("codex", "DONE", false);
      const active = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
      service = active;
      const events: AgentEvent[] = [];
      active.on("event", (event) => events.push(event));
      await runCauseEffect(active.initialize());
      await runCauseEffect(store.getOrCreate("chief"));
      const first = active.createMemory({ agentId: "chief", text: "First saved fact." });
      const second = active.createMemory({ agentId: "chief", text: "Second saved fact." });
      await runCauseEffect(active.sendMessage({ agentId: "chief", text: "Review memory selection." }));
      await waitFor(() => events.some((event) => event.type === "turn-started"));
      const threadId = store.activeProviderSession("chief")?.externalSessionId;
      const turnId = events.find((event) => event.type === "turn-started")?.turnId;
      if (!threadId || !turnId) throw new Error("The selection turn did not start.");
      const selections = active.getMemorySelection("chief").selections;
      const changes = selections.map((selection) => ({
        memoryId: selection.memoryId,
        inclusion: "essential",
        expectedRevision: selection.revision,
      }));
      const staged = await callOpenBotTool(client, threadId, "set_memory_inclusion", { changes }, turnId);
      expect(openBotToolPayload(staged.result).status).toBe("staged");
      const stagedForget = await callOpenBotTool(client, threadId, "forget_memory", { memoryId: second.id }, turnId);
      expect(openBotToolPayload(stagedForget.result).status).toBe("staged");
      const secondRevision = selections.find((selection) => selection.memoryId === second.id)?.revision;
      if (secondRevision === undefined) throw new Error("The second selection is missing.");
      active.setMemoryInclusion({
        agentId: "chief",
        changes: [{ memoryId: second.id, inclusion: "searchable", expectedRevision: secondRevision }],
      });
      const refusedForget = await callOpenBotTool(client, threadId, "forget_memory", { memoryId: second.id }, turnId);
      expect(refusedForget.result).toMatchObject({ success: false });
      client.emit("notification", notification("turn/completed", { threadId, turn: { id: turnId, status } }));
      await waitFor(() => events.some((event) => event.type === "turn-completed"));
      expect(active.getMemorySelection("chief").selections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ memoryId: first.id, inclusion: "searchable", userControlled: false }),
          expect.objectContaining({ memoryId: second.id, inclusion: "searchable", userControlled: true }),
        ]),
      );
      expect(
        active
          .listMemories("chief")
          .map((memory) => memory.text)
          .sort(),
      ).toEqual([first.text, second.text].sort());
    },
  );

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
        arguments: { text: "The user prefers concise status updates.", inclusion: "essential" },
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
      agentMemoryLimit: () => 3,
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
    const kept = service.createMemory({ agentId: "chief", text: "Use Bun for scripts." });
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "The release moved to Monday." }));
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    const turnId = events.find((event) => event.type === "turn-started")?.turnId;
    if (!client || !threadId || !turnId) throw new Error("The memory cap turn did not start.");
    const startRequest = client.requests.find((request) => request.method === "thread/start");
    expect(JSON.stringify(startRequest?.params)).toContain(
      "You have 2 saved memories; 2 additional entries are available through search. The storage limit is 3.",
    );
    const owner = await callOpenBotTool(client, threadId, "remember", { text: "Builder owns the rollback." }, turnId);
    expect(openBotToolPayload(owner.result).status).toBe("staged");

    // Another turn of the same agent, such as a channel turn, commits apart. Its memory counts too.
    const otherTurn = await callOpenBotTool(
      client,
      threadId,
      "remember",
      { text: "Use metric units." },
      "channel-turn",
    );
    expect(paramsRecord(otherTurn.result)?.success).toBe(false);
    // Its forget can commit after this turn, or never, so it frees no place here.
    await callOpenBotTool(client, threadId, "forget_memory", { memoryId: kept.id }, "channel-turn");
    const refused = await callOpenBotTool(client, threadId, "remember", { text: "The release is on Monday." }, turnId);
    expect(paramsRecord(refused.result)?.success).toBe(false);
    expect(openBotToolPayload(refused.result).error).toBe(
      "You have 3 of 3 memories. To make room, update one memory by memoryId with the combined text of two related memories, then forget the other one, or forget a memory that is no longer true. Then try again.",
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
    ).toEqual(["Builder owns the rollback.", "The release is on Monday.", "Use Bun for scripts."]);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });
});
