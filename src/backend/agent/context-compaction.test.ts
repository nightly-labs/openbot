// @vitest-environment node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { Effect, Fiber } from "effect";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  createTestService,
  FakeAgentClient,
  fakeClaudeCli,
  fakeOpencodeCli,
  firstInputText,
  notification,
  protocolMessages,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "../agent-service-test-harness";
import { AppServerError } from "../app-server-client";
import { runCauseEffect } from "../effect-boundary";
import { getString } from "../protocol";
import { providerFailure } from "../provider-client-effects";
import { ContextCompaction } from "./context-compaction";
import { ConversationRuntime } from "./conversation-runtime";

let root: string;
let logPath: string;
let service: AgentService | null = null;
const controllers: ContextCompaction[] = [];

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  await stopAgentTestFixture(root, service);
  service = null;
});

async function ownedCompaction() {
  const { store, mailbox } = stores(root);
  const client = new FakeAgentClient("codex", "", false);
  service = createTestService({ store, mailbox, clientFactory: () => client });
  await runCauseEffect(service.initialize());
  await runCauseEffect(store.getOrCreate("chief"));
  const scheduleDrain = vi.fn();
  const emitError = vi.fn();
  const providers = {
    isReady: vi.fn(() => true),
    clientFor: () => client,
    clientForAgent: () => client,
    listModels: () => [],
  };
  const controller = new ContextCompaction({
    store,
    providers,
    scheduleDrain,
    emitError,
  });
  controllers.push(controller);
  controller.updateBudget("compact-thread", {
    tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
  });
  expect(controller.reserve("chief", "compact-thread")).toBe(true);
  return { controller, client, providers, scheduleDrain, emitError };
}

describe.sequential("ContextCompaction: owned hold", () => {
  it("keeps actual queued inputs past the deadline, does not revive cancellation, and wakes once on completion", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await fakeOpencodeCli();
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "", false);
    const other = new FakeAgentClient("opencode", "", false);
    service = createTestService({
      store,
      mailbox,
      clientFactory: (provider) => (provider === "opencode" ? other : client),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "First task" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const first = service.listQueue("chief").deliveries[0];
    assert(first?.turnId);
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    assert(threadId);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    client.emit(
      "notification",
      notification("thread/tokenUsage/updated", {
        threadId,
        tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: first.turnId, status: "completed" } }),
    );
    await vi.waitFor(() => expect(client.requests.some((item) => item.method === "thread/compact/start")).toBe(true));
    client.emit("notification", notification("turn/started", { threadId, turn: { id: "slow-compact" } }));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep original input" }));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Cancel this input" }));
    const cancelled = service.listQueue("chief").deliveries.find((item) => item.text === "Cancel this input");
    assert(cancelled);
    await runCauseEffect(service.cancelQueuedMessage("chief", cancelled.id));
    const queued = service.listQueue("chief").deliveries.find((item) => item.text === "Keep original input");
    assert(queued);
    other.emit("exit", new Error("Unrelated provider process ended"));
    vi.advanceTimersByTime(120_000);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "context_compaction_timeout" }));
    expect(service.listQueue("chief").deliveries.find((item) => item.id === queued.id)?.status).toBe("queued");
    vi.useRealTimers();
    expect(client.requests.filter((item) => item.method === "turn/start")).toHaveLength(1);
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: "slow-compact", status: "completed" } }),
    );
    await waitForQueue(
      service,
      "chief",
      (queue) => queue.deliveries.find((item) => item.id === queued.id)?.status === "running",
    );
    expect(client.requests.filter((item) => item.method === "turn/start")).toHaveLength(2);
    expect(service.listQueue("chief").deliveries.find((item) => item.id === cancelled.id)?.status).toBe("cancelled");
    expect(service.listQueue("chief").deliveries.find((item) => item.id === queued.id)?.text).toBe(
      "Keep original input",
    );
  });

  it("restores prepared input with zero start RPCs when owned compaction arrives", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "", false);
    let compaction: ContextCompaction | undefined;
    const mayDrain = ContextCompaction.prototype.mayDrain;
    vi.spyOn(ContextCompaction.prototype, "mayDrain").mockImplementation(function (this: ContextCompaction, agentId) {
      compaction = this;
      return mayDrain.call(this, agentId);
    });
    const ensureSnapshot = ConversationRuntime.prototype.ensureSnapshot;
    let arrived = false;
    vi.spyOn(ConversationRuntime.prototype, "ensureSnapshot").mockImplementation(function (
      this: ConversationRuntime,
      agentId,
      threadId,
    ) {
      const snapshot = ensureSnapshot.call(this, agentId, threadId);
      const external = store.activeProviderSession(agentId)?.externalSessionId;
      if (arrived || !external || !mailbox.startingDeliveryForAgent(agentId)) return snapshot;
      arrived = true;
      assert(compaction);
      compaction.updateBudget(external, { tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 } });
      assert(compaction.reserve(agentId, external));
      return snapshot;
    });
    const restored = vi.spyOn(mailbox, "restoreQueued");
    service = createTestService({ store, mailbox, clientFactory: () => client });
    await runCauseEffect(service.initialize());
    const sent = await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Preserve prepared input" }));
    await vi.waitFor(() => expect(restored).toHaveBeenCalledWith(sent.deliveries[0]?.id));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "queued");
    expect(client.requests.filter((item) => item.method === "turn/start")).toHaveLength(0);
    expect(service.listQueue("chief").deliveries[0]).toMatchObject({
      id: sent.deliveries[0]?.id,
      text: "Preserve prepared input",
      status: "queued",
    });
  });

  it("keeps a real regular turn that starts during resume separate from the prepared input", async () => {
    const { store, mailbox } = stores(root);
    let runtime: ConversationRuntime | undefined;
    const ensureSnapshot = ConversationRuntime.prototype.ensureSnapshot;
    vi.spyOn(ConversationRuntime.prototype, "ensureSnapshot").mockImplementation(function (
      this: ConversationRuntime,
      ...args
    ) {
      runtime = this;
      return ensureSnapshot.apply(this, args);
    });
    let prepare = false;
    let external = "";
    const events: AgentEvent[] = [];
    const client = new FakeAgentClient("codex", "", false, true, {}, async (method) => {
      if (method !== "thread/resume" || !prepare) return;
      prepare = false;
      client.emit(
        "notification",
        notification("turn/started", { threadId: external, turn: { id: "regular-during-resume" } }),
      );
      await waitFor(() =>
        events.some((event) => event.type === "turn-started" && event.turnId === "regular-during-resume"),
      );
    });
    service = createTestService({ store, mailbox, clientFactory: () => client });
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Previous completed input" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const first = service.listQueue("chief").deliveries[0];
    assert(first?.turnId);
    external = store.activeProviderSession("chief")?.externalSessionId ?? "";
    await waitFor(() => events.some((event) => event.type === "turn-started" && event.turnId === first.turnId));
    client.emit(
      "notification",
      notification("turn/completed", { threadId: external, turn: { id: first.turnId, status: "completed" } }),
    );
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
    assert(runtime);
    // Exercise the existing resume API after a local cache unload. No snapshot is modified.
    runtime.unloadThread(external);
    prepare = true;
    const restored = vi.spyOn(mailbox, "restoreQueued");
    const sent = await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Prepared original input" }));
    await vi.waitFor(() => expect(restored).toHaveBeenCalledWith(sent.deliveries[0]?.id));
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    expect(service.listQueue("chief").deliveries.find((entry) => entry.id === sent.deliveries[0]?.id)?.status).toBe(
      "queued",
    );
    expect((await runCauseEffect(service.readConversation("chief"))).activeTurnId).toBe("regular-during-resume");
    client.emit(
      "notification",
      notification("turn/completed", {
        threadId: external,
        turn: { id: "regular-during-resume", status: "completed" },
      }),
    );
    await waitForQueue(
      service,
      "chief",
      (queue) => queue.deliveries.find((entry) => entry.id === sent.deliveries[0]?.id)?.status === "running",
    );
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
  });

  it("does not publish a failed provider stop as confirmed termination", async () => {
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        if (provider === "codex") clients.push(client);
        return client;
      },
    });
    await runCauseEffect(service.initialize());
    const first = clients[0];
    assert(first);
    const stopped = vi
      .spyOn(first, "stop")
      .mockImplementationOnce(() => Effect.fail(providerFailure(new Error("Stop not confirmed"))));
    const ended = vi.spyOn(ContextCompaction.prototype, "clientEnded");
    await runCauseEffect(service.restartProvider("codex"));
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    expect(ended.mock.calls.some(([client]) => client === first)).toBe(false);
    expect(first.running).toBe(true);
    // The test owns this fake client; clean it up after the failed stop, without another lifecycle claim.
    await runCauseEffect(first.stop());
  });

  it("restores a definitely refused batch in order and submits its original data once after owned compaction", async () => {
    const { store, mailbox } = stores(root);
    let compaction: ContextCompaction | undefined;
    const mayDrain = ContextCompaction.prototype.mayDrain;
    vi.spyOn(ContextCompaction.prototype, "mayDrain").mockImplementation(function (this: ContextCompaction, agentId) {
      compaction = this;
      return mayDrain.call(this, agentId);
    });
    let threadId = "";
    let refused = false;
    const client = new FakeAgentClient("codex", "", false, true, {}, async (method) => {
      if (method !== "turn/start" || refused) return;
      refused = true;
      assert(compaction);
      threadId = getString(client.requests.at(-1)?.params, "threadId") ?? "";
      compaction.updateBudget(threadId, { tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 } });
      assert(compaction.reserve("chief", threadId));
      await runCauseEffect(compaction.request("chief", threadId));
      assert(compaction.claimTurn("chief", threadId, "owned-compact", client));
      throw new AppServerError("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }", -32603);
    });
    service = createTestService({ store, mailbox, clientFactory: () => client });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const request = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "chief" },
        recipientAgentIds: ["sales-outbound", "inbox-manager"],
        text: "Report",
        expectsReply: true,
      }),
    );
    const reply = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "sales-outbound" },
        recipientAgentIds: ["chief"],
        text: "Original reply",
        replyToMessageId: request.messageId,
        expectsReply: false,
      }),
    );
    assert(mailbox.nextQueued("chief") === null);
    const file = join(root, "original-input.txt");
    await writeFile(file, "Original attachment");
    const [draft] = await runCauseEffect(mailbox.prepareImportedAttachments([file], []));
    assert(draft);
    const sent = await runCauseEffect(
      service.sendMessage({ agentId: "chief", text: "Original user input", attachmentDraftIds: [draft.id] }),
    );
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "error" && ["delivery_start_failed", "delivery_compaction_waiting"].includes(event.code),
      ),
    );
    const original = service.listQueue("chief").deliveries;
    expect(original.map((item) => item.status)).toEqual(["queued", "queued"]);
    expect(original.map((item) => item.id)).toEqual([reply.deliveries[0]?.id, sent.deliveries[0]?.id]);
    expect(original.map((item) => item.text)).toEqual(["Original reply", "Original user input"]);
    expect(original[1]?.attachments).toHaveLength(1);
    expect(client.requests.filter((item) => item.method === "turn/start")).toHaveLength(1);
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: "owned-compact", status: "completed" } }),
    );
    await waitForQueue(service, "chief", (queue) => queue.deliveries.every((item) => item.status === "running"));
    const submissions = client.requests.filter((item) => item.method === "turn/start");
    expect(submissions).toHaveLength(2);
    expect(firstInputText(submissions[1]?.params)).toContain("Original reply");
    expect(firstInputText(submissions[1]?.params)).toContain("Original user input");
    expect(
      service
        .listQueue("chief")
        .deliveries.map((item) => ({ id: item.id, text: item.text, attachments: item.attachments })),
    ).toEqual(original.map((item) => ({ id: item.id, text: item.text, attachments: item.attachments })));
  });

  it.each(["before", "after"])(
    "restores the original batch when owned completion is %s the definite refusal",
    async (order) => {
      const { store, mailbox } = stores(root);
      let owner: ContextCompaction | undefined;
      const mayDrain = ContextCompaction.prototype.mayDrain;
      vi.spyOn(ContextCompaction.prototype, "mayDrain").mockImplementation(function (this: ContextCompaction, id) {
        owner = this;
        return mayDrain.call(this, id);
      });
      let threadId = "";
      let refused = false;
      const client = new FakeAgentClient("codex", "", false, true, {}, async (method) => {
        if (method !== "turn/start" || refused) return;
        refused = true;
        assert(owner);
        threadId = getString(client.requests.at(-1)?.params, "threadId") ?? "";
        owner.updateBudget(threadId, { tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 } });
        assert(owner.reserve("chief", threadId));
        await runCauseEffect(owner.request("chief", threadId));
        client.emit("notification", notification("turn/started", { threadId, turn: { id: "refusal-compact" } }));
        await waitFor(() => owner?.isCompactionTurn(threadId, "refusal-compact", client) === true);
        if (order === "before") {
          client.emit(
            "notification",
            notification("turn/completed", { threadId, turn: { id: "refusal-compact", status: "completed" } }),
          );
          await waitFor(() => owner?.mayDrain("chief") === true);
        }
        throw new AppServerError("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }", -32603);
      });
      service = createTestService({ store, mailbox, clientFactory: () => client });
      const events: AgentEvent[] = [];
      service.on("event", (event) => events.push(event));
      await runCauseEffect(service.initialize());
      const file = join(root, "refusal.txt");
      await writeFile(file, "Original refusal attachment");
      const [draft] = await runCauseEffect(mailbox.prepareImportedAttachments([file], []));
      assert(draft);
      const sent = await runCauseEffect(
        service.sendMessage({ agentId: "chief", text: "Refused original input", attachmentDraftIds: [draft.id] }),
      );
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "error" && ["delivery_start_failed", "delivery_compaction_waiting"].includes(event.code),
        ),
      );
      if (order === "after") {
        expect(service.listQueue("chief").deliveries[0]?.status).toBe("queued");
        client.emit(
          "notification",
          notification("turn/completed", { threadId, turn: { id: "refusal-compact", status: "completed" } }),
        );
      }
      await waitForQueue(
        service,
        "chief",
        (queue) => queue.deliveries[0]?.status !== "queued" && queue.deliveries[0]?.status !== "starting",
      );
      expect(service.listQueue("chief").deliveries[0]).toMatchObject({
        id: sent.deliveries[0]?.id,
        status: "running",
        text: "Refused original input",
        attachments: [expect.objectContaining({ name: "refusal.txt" })],
      });
      expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    },
  );

  it.each(["before", "after", "unknown"])(
    "keeps definite external Compact refusal queued with %s terminal evidence",
    async (order) => {
      process.env.OPENBOT_OPENCODE_PATH = await fakeOpencodeCli();
      const { store, mailbox } = stores(root);
      const other = new FakeAgentClient("opencode", "", false);
      let threadId = "";
      let refused = false;
      const client = new FakeAgentClient("codex", "", false, true, {}, async (method) => {
        if (method !== "turn/start" || refused) return;
        refused = true;
        threadId = getString(client.requests.at(-1)?.params, "threadId") ?? "";
        if (order !== "unknown") {
          client.emit(
            "notification",
            notification("thread/status/changed", { threadId, status: { type: "active", activeFlags: [] } }),
          );
          client.emit("notification", notification("turn/started", { threadId, turn: { id: "external-compact" } }));
          client.emit(
            "notification",
            notification("item/started", {
              threadId,
              turnId: "external-compact",
              item: { type: "contextCompaction", id: "compact-item" },
            }),
          );
        }
        if (order === "before") {
          client.emit("notification", notification("thread/status/changed", { threadId, status: { type: "idle" } }));
          client.emit(
            "notification",
            notification("turn/completed", { threadId, turn: { id: "external-compact", status: "completed" } }),
          );
        }
        throw new AppServerError("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }", -32603);
      });
      service = createTestService({
        store,
        mailbox,
        clientFactory: (provider) => (provider === "opencode" ? other : client),
      });
      const events: AgentEvent[] = [];
      service.on("event", (event) => events.push(event));
      await runCauseEffect(service.initialize());
      await runCauseEffect(store.getOrCreate("chief"));
      const request = await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "agent", agentId: "chief" },
          recipientAgentIds: ["sales-outbound", "inbox-manager"],
          text: "Report",
          expectsReply: true,
        }),
      );
      const reply = await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "agent", agentId: "sales-outbound" },
          recipientAgentIds: ["chief"],
          text: "External original reply",
          replyToMessageId: request.messageId,
          expectsReply: false,
        }),
      );
      const file = join(root, "external-original.txt");
      await writeFile(file, "Original external attachment");
      const [draft] = await runCauseEffect(mailbox.prepareImportedAttachments([file], []));
      assert(draft);
      const sent = await runCauseEffect(
        service.sendMessage({ agentId: "chief", text: "External refusal original", attachmentDraftIds: [draft.id] }),
      );
      const ids = [reply.deliveries[0]?.id, sent.deliveries[0]?.id];
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "error" && ["delivery_start_failed", "delivery_compaction_waiting"].includes(event.code),
        ),
      );
      expect(
        service
          .listQueue("chief")
          .deliveries.filter((entry) => ids.includes(entry.id))
          .some((entry) => entry.status === "failed"),
      ).toBe(false);
      const original = service
        .listQueue("chief")
        .deliveries.map(({ id, text, attachments }) => ({ id, text, attachments }));
      expect(original.map((entry) => entry.id)).toEqual(ids);
      if (order !== "before") {
        other.emit(
          "notification",
          notification("turn/completed", { threadId, turn: { id: "external-compact", status: "completed" } }),
        );
        other.emit("notification", notification("thread/status/changed", { threadId, status: { type: "idle" } }));
        expect(service.listQueue("chief").deliveries[0]?.status).toBe("queued");
        expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
        client.emit(
          "notification",
          notification("turn/completed", { threadId, turn: { id: "stale-turn", status: "completed" } }),
        );
        client.emit(
          "notification",
          notification("thread/status/changed", { threadId: "other-thread", status: { type: "idle" } }),
        );
        client.emit("notification", notification("thread/status/changed", { threadId, status: { type: "notLoaded" } }));
        if (order === "unknown") {
          client.emit(
            "notification",
            notification("thread/status/changed", { threadId, status: { type: "active", activeFlags: ["invalid"] } }),
          );
          client.emit("notification", notification("thread/status/changed", { threadId, status: { type: "idle" } }));
          expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
          const cancelled = await runCauseEffect(
            service.sendMessage({ agentId: "chief", text: "Cancel during unknown wait" }),
          );
          assert(cancelled.deliveries[0]);
          await runCauseEffect(service.cancelQueuedMessage("chief", cancelled.deliveries[0].id));
          client.emit(
            "notification",
            notification("thread/status/changed", { threadId, status: { type: "active", activeFlags: [] } }),
          );
        }
        client.emit("notification", notification("thread/status/changed", { threadId, status: { type: "idle" } }));
        if (order === "after")
          client.emit(
            "notification",
            notification("turn/completed", { threadId, turn: { id: "external-compact", status: "completed" } }),
          );
      }
      await waitForQueue(
        service,
        "chief",
        (queue) => queue.deliveries[0]?.status === "running" || queue.deliveries[0]?.status === "failed",
      );
      const submitted = service.listQueue("chief").deliveries.filter((entry) => ids.includes(entry.id));
      expect(submitted.map((entry) => entry.status)).toEqual(["running", "running"]);
      expect(submitted.map(({ id, text, attachments }) => ({ id, text, attachments }))).toEqual(original);
      const submissions = client.requests.filter((request) => request.method === "turn/start");
      expect(submissions).toHaveLength(2);
      expect(firstInputText(submissions[1]?.params)).toContain("External original reply");
      expect(firstInputText(submissions[1]?.params)).toContain("External refusal original");
      if (order === "unknown")
        expect(
          service.listQueue("chief").deliveries.find((entry) => entry.text === "Cancel during unknown wait")?.status,
        ).toBe("cancelled");
      await waitFor(() =>
        events.some((event) => event.type === "turn-started" && event.turnId === submitted[0]?.turnId),
      );
      client.emit(
        "notification",
        notification("turn/completed", { threadId, turn: { id: "external-compact", status: "completed" } }),
      );
      expect((await runCauseEffect(service.readConversation("chief"))).activeTurnId).toBe(submitted[0]?.turnId);
    },
  );

  it("does not turn compaction inside an accepted regular turn into a standalone owner", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "", false);
    service = createTestService({ store, mailbox, clientFactory: () => client });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Accepted regular input" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "running");
    const first = service.listQueue("chief").deliveries[0];
    assert(first?.turnId);
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    assert(threadId);
    await waitFor(() => events.some((event) => event.type === "turn-started" && event.turnId === first.turnId));
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId: first.turnId,
        item: { id: "internal-compact", type: "contextCompaction" },
      }),
    );
    const sent = await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Next regular input" }));
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId: first.turnId,
        item: { id: "internal-compact", type: "contextCompaction" },
      }),
    );
    expect(service.listQueue("chief").deliveries[0]?.status).toBe("running");
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    client.emit(
      "notification",
      notification("error", {
        threadId,
        turnId: first.turnId,
        error: { message: "Regular task failed after compaction" },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: first.turnId, status: "failed" } }),
    );
    await waitForQueue(
      service,
      "chief",
      (queue) => queue.deliveries.find((entry) => entry.id === sent.deliveries[0]?.id)?.status === "running",
    );
    expect(service.listQueue("chief").deliveries[0]).toMatchObject({
      id: first.id,
      status: "failed",
      error: "Regular task failed after compaction",
    });
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
  });

  it("keeps refusal evidence scoped to its client, thread and observed turn", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    const other = new FakeAgentClient("codex", "", false);
    const input = controller.beginInput("chief", "compact-thread", client);
    controller.observeStarted("chief", "compact-thread", "current-turn", client);
    controller.refuseInput(input);
    controller.observeCompleted("chief", "compact-thread", "old-turn", client);
    controller.observeCompleted("chief", "other-thread", "current-turn", client);
    controller.observeCompleted("chief", "compact-thread", "current-turn", other);
    controller.observeStatus("chief", "compact-thread", "idle", other);
    controller.observeStatus("chief", "other-thread", "idle", client);
    expect(scheduleDrain).not.toHaveBeenCalled();
    expect(controller.mayDrain("chief")).toBe(false);
    controller.observeCompleted("chief", "compact-thread", "current-turn", client);
    expect(scheduleDrain).toHaveBeenCalledExactlyOnceWith("chief");
    controller.observeCompleted("chief", "compact-thread", "current-turn", client);
    expect(scheduleDrain).toHaveBeenCalledTimes(1);
  });

  it("does not treat a rejected owned compact start as proof that external activity ended", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    const input = controller.beginInput("chief", "compact-thread", client);
    vi.spyOn(client, "request").mockImplementation(() =>
      Effect.fail(providerFailure(new AppServerError("Rejected compact method", -32601))),
    );
    await runCauseEffect(controller.request("chief", "compact-thread"));
    controller.refuseInput(input);
    expect(controller.mayDrain("chief")).toBe(false);
    const wakes = scheduleDrain.mock.calls.length;
    controller.observeStatus("chief", "compact-thread", "idle", client);
    expect(scheduleDrain).toHaveBeenCalledTimes(wakes);
    controller.clientEnded(client);
    expect(controller.mayDrain("chief")).toBe(true);
    expect(scheduleDrain).toHaveBeenCalledTimes(wakes + 1);
  });

  it("keeps queued work held after the deadline and wakes it only on completion", async () => {
    const { controller, client, scheduleDrain, emitError } = await ownedCompaction();
    vi.useFakeTimers();
    await runCauseEffect(controller.request("chief", "compact-thread"));
    expect(controller.claimTurn("chief", "compact-thread", "compact-turn", client)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(emitError).toHaveBeenCalledWith("context_compaction_timeout", expect.any(String), "chief");
    expect(controller.mayDrain("chief")).toBe(false);
    expect(controller.isCompactionTurn("compact-thread", "compact-turn", client)).toBe(true);
    expect(scheduleDrain).not.toHaveBeenCalled();
    controller.finish("chief", "compact-thread", "compact-turn", "completed", client);
    expect(controller.mayDrain("chief")).toBe(true);
    expect(scheduleDrain).toHaveBeenCalledExactlyOnceWith("chief");
  });

  it("keeps an unanswered compact start owned until a later lifecycle event", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    vi.spyOn(client, "request").mockImplementation(() =>
      Effect.fail(providerFailure(new RequestTimeoutError("Codex", "thread/compact/start"))),
    );
    await runCauseEffect(controller.request("chief", "compact-thread"));
    expect(controller.mayDrain("chief")).toBe(false);
    expect(scheduleDrain).not.toHaveBeenCalled();
    expect(controller.claimTurn("chief", "compact-thread", "late-compact-turn", client)).toBe(true);
  });

  it("does not release a different thread's hold on an unrelated completion", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    await runCauseEffect(controller.request("chief", "compact-thread"));
    controller.finish("chief", "old-thread", "old-turn", "completed", client);
    expect(controller.mayDrain("chief")).toBe(false);
    expect(scheduleDrain).not.toHaveBeenCalled();
  });

  it("does not treat local request interruption as provider completion", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    vi.spyOn(client, "request").mockImplementation(() => Effect.never);
    const fiber = Effect.runFork(controller.request("chief", "compact-thread"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(controller.mayDrain("chief")).toBe(false);
    expect(scheduleDrain).not.toHaveBeenCalled();
  });

  it("releases an unsubmitted reservation without issuing an RPC", async () => {
    const { controller, client, providers } = await ownedCompaction();
    providers.isReady.mockReturnValue(false);
    await runCauseEffect(controller.request("chief", "compact-thread"));
    expect(controller.mayDrain("chief")).toBe(true);
    expect(client.requests.some((item) => item.method === "thread/compact/start")).toBe(false);
  });

  it("keeps provider-managed compaction budget accounting without claiming an owned turn", async () => {
    const { controller, client } = await ownedCompaction();
    controller.forgetAgent("chief");
    controller.updateBudget("compact-thread", {
      tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
    });
    controller.markCompacted("compact-thread", "provider-managed-compact", client);
    expect(controller.mayDrain("chief")).toBe(true);
    expect(controller.reserve("chief", "compact-thread")).toBe(false);
  });

  it.each(["claude", "opencode", "acp"] as const)(
    "releases a reservation after capability changes to %s without issuing an RPC",
    async (provider) => {
      const { controller, providers, scheduleDrain } = await ownedCompaction();
      const client = new FakeAgentClient(provider, "", false);
      client.start();
      vi.spyOn(providers, "clientForAgent").mockReturnValue(client);
      await runCauseEffect(controller.request("chief", "compact-thread"));
      expect(controller.mayDrain("chief")).toBe(true);
      expect(scheduleDrain).not.toHaveBeenCalled();
      expect(client.requests.filter((item) => item.method === "thread/compact/start")).toHaveLength(0);
    },
  );

  it("keeps a retired thread's live hold and ignores another client's completion or exit", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    const other = new FakeAgentClient("codex", "", false);
    await runCauseEffect(controller.request("chief", "compact-thread"));
    expect(controller.claimTurn("chief", "compact-thread", "wrong-source", other)).toBe(false);
    expect(controller.claimTurn("chief", "compact-thread", "compact-turn", client)).toBe(true);
    controller.forgetThread("compact-thread");
    controller.finish("chief", "compact-thread", "compact-turn", "completed", other);
    controller.clientEnded(other);
    expect(controller.mayDrain("chief")).toBe(false);
    expect(scheduleDrain).not.toHaveBeenCalled();
    await runCauseEffect(client.stop());
    controller.clientEnded(client);
    expect(controller.mayDrain("chief")).toBe(true);
    expect(scheduleDrain).toHaveBeenCalledExactlyOnceWith("chief");
  });

  it("does not let an old request error or completion release a new operation on the same thread", async () => {
    const { controller, client, scheduleDrain } = await ownedCompaction();
    let failRequest: (() => void) | undefined;
    vi.spyOn(client, "request").mockImplementationOnce(() =>
      Effect.callback((resume) => {
        failRequest = () => resume(Effect.fail(providerFailure(new AppServerError("Unavailable", -32601))));
      }),
    );
    const first = Effect.runFork(controller.request("chief", "compact-thread"));
    assert(failRequest);
    expect(controller.claimTurn("chief", "compact-thread", "old-compact", client)).toBe(true);
    controller.finish("chief", "compact-thread", "old-compact", "completed", client);
    controller.updateBudget("compact-thread", {
      tokenUsage: { last: { totalTokens: 90_000 }, modelContextWindow: 100_000 },
    });
    expect(controller.reserve("chief", "compact-thread")).toBe(true);
    await runCauseEffect(controller.request("chief", "compact-thread"));
    expect(controller.claimTurn("chief", "compact-thread", "new-compact", client)).toBe(true);
    scheduleDrain.mockClear();
    failRequest();
    await Effect.runPromise(Fiber.join(first));
    controller.finish("chief", "compact-thread", "old-compact", "completed", client);
    expect(controller.mayDrain("chief")).toBe(false);
    expect(scheduleDrain).not.toHaveBeenCalled();
    controller.finish("chief", "compact-thread", "new-compact", "interrupted", client);
    expect(controller.mayDrain("chief")).toBe(true);
    expect(scheduleDrain).toHaveBeenCalledExactlyOnceWith("chief");
  });
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
