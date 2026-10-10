// @vitest-environment node
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "../agent-service";
import {
  createTestService,
  fakeClaudeCli,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";

let root: string;
let logPath: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ContextCompaction: pressure, threshold and failure", () => {
  it.each(["request", "native", "unsupported"] as const)("drains the queue with %s compaction", async (mode) => {
    const fixture = await startService(root, { output: "DONE" });
    service = fixture.service;
    vi.spyOn(fixture.client, "contextCompaction", "get").mockReturnValue(mode);
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const session = fixture.store.activeProviderSession("chief");
    if (!session) throw new Error("Missing test session");
    fixture.client.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: session.externalSessionId,
        tokenUsage: { last: { totalTokens: 82000 }, modelContextWindow: 100000 },
      },
    });
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Next task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[1]?.status === "completed");
    expect(fixture.client.requests.filter((request) => request.method === "thread/compact/start")).toHaveLength(
      mode === "request" ? 1 : 0,
    );
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "No repeat compaction" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[2]?.status === "completed");
    expect(fixture.client.requests.filter((request) => request.method === "thread/compact/start")).toHaveLength(
      mode === "request" ? 1 : 0,
    );
  });

  it("compacts a pressured agent context before draining its next queued message", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First large task" }));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run after compaction" }));
    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });

    const lifecycle = (await protocolMessages(logPath))
      .filter((message) => ["turn/start", "thread/compact/start"].includes(String(message.method)))
      .map((message) => message.method);
    expect(lifecycle.slice(0, 3)).toEqual(["turn/start", "thread/compact/start", "turn/start"]);
    expect(lifecycle.filter((method) => method === "thread/compact/start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn-started")).toHaveLength(2);
    expect(
      events.some(
        (event) =>
          event.type === "runtime-snapshot" &&
          event.snapshot.contextStates?.some((state) => state.compaction?.status === "running"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "runtime-snapshot" &&
          event.snapshot.contextStates?.some((state) => state.compaction?.status === "completed"),
      ),
    ).toBe(true);
  });

  it("ends the native compaction indication when its turn is interrupted", async () => {
    const fixture = await startService(root, { autoComplete: false });
    service = fixture.service;
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Synthetic task" }));
    await waitFor(() => service?.getRuntimeSnapshot().activeTurns.length === 1);
    const active = service.getRuntimeSnapshot().activeTurns[0];
    const session = fixture.store.activeProviderSession("chief");
    if (!active || !session) throw new Error("Missing active test turn");
    fixture.client.emit("notification", {
      method: "item/started",
      params: {
        threadId: session.externalSessionId,
        turnId: active.turnId,
        item: { id: "native-compact", type: "contextCompaction" },
      },
    });
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.compaction?.status === "running");
    fixture.client.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: session.externalSessionId,
        turn: { id: active.turnId, status: "interrupted" },
      },
    });
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.compaction?.status === "failed");
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "interrupted");
  });

  it("clears context indication after reset and rejects invalid usage", async () => {
    const fixture = await startService(root, { output: "DONE" });
    service = fixture.service;
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Synthetic task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const session = fixture.store.activeProviderSession("chief");
    if (!session) throw new Error("Missing test session");
    const report = (used: number) =>
      fixture.client.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: session.externalSessionId,
          tokenUsage: { last: { totalTokens: used }, modelContextWindow: 100000 },
        },
      });
    report(42000);
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.usage?.usedTokens === 42000);
    report(Number.NaN);
    expect(service.getRuntimeSnapshot().contextStates?.[0]?.usage?.usedTokens).toBe(42000);
    await runCauseEffect(service.clearAgentContext("chief"));
    expect(service.getRuntimeSnapshot().contextStates).toEqual([]);
    report(50000);
    expect(service.getRuntimeSnapshot().contextStates).toEqual([]);
  });

  it("publishes empty context immediately when the provider changes", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await fakeClaudeCli();
    const fixture = await startService(root, { output: "DONE" });
    service = fixture.service;
    const snapshots: AgentEvent[] = [];
    service.on("event", (event) => {
      if (event.type === "runtime-snapshot") snapshots.push(event);
    });
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Synthetic task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const session = fixture.store.activeProviderSession("chief");
    if (!session) throw new Error("Missing test session");
    fixture.client.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: session.externalSessionId,
        tokenUsage: { last: { totalTokens: 42000 }, modelContextWindow: 100000 },
      },
    });
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.usage?.usedTokens === 42000);
    snapshots.length = 0;
    await runCauseEffect(service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" }));
    expect(snapshots).toContainEqual(
      expect.objectContaining({ type: "runtime-snapshot", snapshot: expect.objectContaining({ contextStates: [] }) }),
    );
  });

  it("keeps native compaction counts absent after a later usage estimate", async () => {
    const fixture = await startService(root, { output: "DONE" });
    service = fixture.service;
    vi.spyOn(fixture.client, "contextCompaction", "get").mockReturnValue("native");
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Synthetic task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    const session = fixture.store.activeProviderSession("chief");
    if (!session) throw new Error("Missing test session");
    const report = (usedTokens: number) =>
      fixture.client.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: session.externalSessionId,
          tokenUsage: { last: { totalTokens: usedTokens }, modelContextWindow: 200000, estimated: true },
        },
      });
    report(29826);
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.usage?.usedTokens === 29826);
    for (const status of ["running", "completed"] as const) {
      fixture.client.emit("notification", {
        method: "openbot/context-compaction",
        params: { threadId: session.externalSessionId, status, tokens: { before: 29839, after: 3750 } },
      });
      await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.compaction?.status === status);
    }
    report(31636);
    await waitFor(() => service?.getRuntimeSnapshot().contextStates?.[0]?.usage?.usedTokens === 31636);
    const context = service.getRuntimeSnapshot().contextStates?.[0];
    expect(context?.usage?.estimated).toBe(true);
    expect(context?.compaction?.beforeTokens).toBeUndefined();
    expect(context?.compaction?.afterTokens).toBeUndefined();
  });

  it("does not compact context below the safety threshold", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "79000";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Normal task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");

    expect((await protocolMessages(logPath)).some((message) => message.method === "thread/compact/start")).toBe(false);
  });

  it("continues queued work when an MCP server changes while the context is compacting", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    // Long enough to save a server inside the compaction, which is the window the deadlock needs.
    process.env.OPENBOT_FAKE_COMPACTION_DELAY = "400";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First large task" }));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run after compaction" }));
    await waitFor(async () =>
      (await protocolMessages(logPath)).some((message) => message.method === "thread/compact/start"),
    );

    // A compaction keeps no conversation turn id, so a refresh reads its thread as idle. Dropping
    // the routing here would lose the compaction's own completion, and the agent would hold its
    // queue for good.
    await runCauseEffect(
      service.saveMcpServer({
        config: {
          id: "",
          name: "Filesystem",
          transport: "stdio",
          enabled: true,
          command: "/bin/echo",
          args: [],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      }),
    );

    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });
  });

  it("continues queued work when context compaction is unavailable", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    process.env.OPENBOT_FAKE_COMPACTION_ERROR = "1";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());

    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First task" }));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Must still run" }));
    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });

    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "error", code: "context_compaction_failed" })]),
    );
  });
});
