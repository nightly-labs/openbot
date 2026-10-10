import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelAudienceInput, ChannelAudienceReceipt } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterAll, afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  fakeClaudeCli,
  firstInputText,
  notification,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import { AppServerError } from "./app-server-client";
import { runCauseEffect } from "./effect-boundary";
import { getRecord, getString } from "./protocol";
import { StoredStateFailure } from "./stored-state-effects";

let root: string;
let service: AgentService | null = null;
const actor = { id: "member", name: "Alex" };
const room = "integration-room";
const reports: Array<{
  scenario: string;
  targets: Array<{
    agentId: string;
    deliveryId: string;
    text: string;
    status: string;
    taskState: string;
    attachmentNames: string[];
    inputRpcCount: number;
  }>;
}> = [];
afterAll(async () => {
  await mkdir(".openbot-build/channel-queue-integration", { recursive: true });
  await writeFile(".openbot-build/channel-queue-integration/target-results.json", JSON.stringify(reports, null, 2));
});
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
  vi.restoreAllMocks();
});

async function setup(hook?: (method: string) => Promise<void>, withForeignClient = false) {
  const data = stores(root);
  const foreign = new FakeAgentClient("claude", "", false);
  if (withForeignClient) process.env.OPENBOT_CLAUDE_PATH = await fakeClaudeCli();
  const client = new FakeAgentClient("codex", "", false, true, {}, hook);
  const started = new Set<string>();
  client.on("notification", (event) => {
    if (event.method === "turn/started") {
      const id = getString(getRecord(event.params, "turn"), "id");
      if (id) started.add(id);
    }
  });
  const current = createTestService({
    ...data,
    clientFactory: (provider) => (provider === "claude" ? foreign : client),
  });
  service = current;
  await runCauseEffect(current.initialize());
  for (const id of ["a", "b"]) await runCauseEffect(data.store.getOrCreate(id));
  await runCauseEffect(
    current.channels.command(
      {
        type: "save",
        channelId: room,
        operationId: "create-room",
        draft: {
          name: "Integration",
          title: "",
          instructions: "Review the input",
          members: [{ agentId: "a" }, { agentId: "b" }],
          leadAgentId: "a",
        },
      },
      actor,
    ),
  );
  return { ...data, service: current, client, foreign, started };
}
type Fixture = Omit<Awaited<ReturnType<typeof setup>>, "foreign"> & { foreign?: FakeAgentClient };
async function send(f: Fixture) {
  const path = join(root, "brief.txt");
  await writeFile(path, "Retain this file");
  const [draft] = await runCauseEffect(f.mailbox.prepareAttachments([path]));
  assert(draft);
  const input: ChannelAudienceInput = {
    channelId: room,
    operationId: "audience-once",
    text: "Review the original brief",
    audience: { kind: "members", agentIds: ["b", "a"] },
    replyToMessageId: null,
    attachmentDraftIds: [draft.id],
  };
  const receipt = await runCauseEffect(f.service.channels.audiences.send(input, actor));
  assert(!("status" in receipt));
  return { input, receipt };
}
function assignment(f: Fixture, id: string) {
  const value = f.service.channels.store.assignments(room).find((item) => item.agentId === id);
  assert(value?.deliveryId);
  return value;
}
function context(f: Fixture, id: string) {
  const entry = assignment(f, id);
  const value = f.mailbox.getDelivery(entry.deliveryId ?? "");
  assert(value);
  return value;
}
function inputCalls(f: Fixture, id: string) {
  const thread = f.service.channels.store.context(room, id).threadId;
  const external = f.store.database.activeProviderSession(thread, "codex")?.externalSessionId;
  return f.client.requests.filter(
    (item) =>
      (item.method === "turn/start" || item.method === "turn/steer") && getString(item.params, "threadId") === external,
  );
}
async function finish(f: Fixture, id: string) {
  const entry = assignment(f, id);
  assert(entry.turnId);
  await waitFor(() => f.started.has(entry.turnId ?? ""));
  const threadId = f.service.channels.store.context(room, id).threadId;
  const external = f.store.database.activeProviderSession(threadId, "codex")?.externalSessionId;
  assert(external);
  await runCauseEffect(
    f.service.channels.tool(room, id, entry.turnId, "result", "channel_result", { text: "Normal peer finished" }),
  );
  f.client.emit(
    "notification",
    notification("turn/completed", { threadId: external, turn: { id: entry.turnId, status: "completed" } }),
  );
  await waitFor(
    () => f.service.channels.store.tasks(room).find((task) => task.id === entry.taskId)?.state === "completed",
  );
}
async function checkFiles(f: Fixture, id: string) {
  const value = context(f, id);
  expect(value.delivery.attachments).toHaveLength(1);
  const file = await runCauseEffect(f.mailbox.resolveAttachment(value.delivery.attachments?.[0]?.id ?? ""));
  assert(file);
  expect(await readFile(file.path, "utf8")).toBe("Retain this file");
}
function report(f: Fixture, scenario: string) {
  reports.push({
    scenario,
    targets: ["b", "a"].map((agentId) => {
      const entry = assignment(f, agentId);
      const delivery = context(f, agentId).delivery;
      return {
        agentId,
        deliveryId: delivery.id,
        text: delivery.text,
        status: delivery.status,
        taskState: f.service.channels.store.tasks(room).find((task) => task.id === entry.taskId)?.state ?? "missing",
        attachmentNames: (delivery.attachments ?? []).map((file) => file.name),
        inputRpcCount: inputCalls(f, agentId).length,
      };
    }),
  });
}
function original(f: Fixture, id: string) {
  const value = context(f, id);
  return {
    id: value.delivery.id,
    messageId: value.delivery.messageId,
    text: value.delivery.text,
    attachments: value.delivery.attachments,
    createdAt: value.delivery.createdAt,
  };
}

it("an accepted channel input with a local write failure reconciles without a second provider RPC", async () => {
  const f = await setup();
  const { input, receipt } = await send(f);
  await waitFor(() =>
    f.service.channels.store.assignments(room).some((item) => item.agentId === "b" && item.state === "running"),
  );
  const markRunning = f.mailbox.markRunning.bind(f.mailbox);
  let failed = false;
  vi.spyOn(f.mailbox, "markRunning").mockImplementation((id, turnId) => {
    if (!failed && f.mailbox.getDelivery(id)?.delivery.recipientAgentId === "a") {
      failed = true;
      return Effect.fail(new StoredStateFailure({ cause: new Error("Injected accepted input write failure") }));
    }
    return markRunning(id, turnId);
  });
  await finish(f, "b");
  await waitFor(() =>
    f.service.channels.store.assignments(room).some((item) => item.agentId === "a" && item.state === "running"),
  );
  expect(failed).toBe(true);
  expect(inputCalls(f, "a")).toHaveLength(1);
  expect(context(f, "a").delivery.status).toBe("running");
  await checkFiles(f, "a");
  await finish(f, "a");
  await receiptOnce(f, input, receipt);
  expect(inputCalls(f, "a")).toHaveLength(1);
  expect(inputCalls(f, "b")).toHaveLength(1);
  report(f, "accepted local write repair");
});
async function receiptOnce(f: Fixture, input: ChannelAudienceInput, receipt: ChannelAudienceReceipt) {
  expect(await runCauseEffect(f.service.channels.audiences.send(input, actor))).toEqual(receipt);
  expect(f.service.channels.audiences.receipt(input, actor.id)).toEqual(receipt);
  expect(f.service.channels.store.page(room).messages.filter((item) => item.author.kind === "member")).toHaveLength(1);
  expect(f.service.channels.store.tasks(room)).toHaveLength(2);
  expect(f.service.channels.store.assignments(room)).toHaveLength(2);
}

it("an owned Compact hold preserves the audience input while its normal peer completes once", async () => {
  const f = await setup();
  await runCauseEffect(f.service.sendMessage({ agentId: "a", text: "Warm the original session" }));
  await waitForQueue(f.service, "a", (queue) => queue.deliveries[0]?.status === "running");
  const warm = f.service.listQueue("a").deliveries[0];
  const external = f.store.activeProviderSession("a")?.externalSessionId;
  assert(warm?.turnId && external);
  await waitFor(() => f.started.has(warm.turnId ?? ""));
  f.client.emit(
    "notification",
    notification("thread/tokenUsage/updated", {
      threadId: external,
      tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
    }),
  );
  f.client.emit(
    "notification",
    notification("turn/completed", { threadId: external, turn: { id: warm.turnId, status: "completed" } }),
  );
  await waitFor(() => f.client.requests.some((item) => item.method === "thread/compact/start"));
  f.client.emit("notification", notification("turn/started", { threadId: external, turn: { id: "held-compact" } }));
  const { input, receipt } = await send(f);
  await waitFor(() =>
    f.service.channels.store.assignments(room).some((item) => item.agentId === "b" && item.state === "running"),
  );
  expect(inputCalls(f, "b")).toHaveLength(1);
  await finish(f, "b");
  await waitFor(() =>
    f.service.channels.store.assignments(room).some((item) => item.agentId === "a" && item.deliveryId),
  );
  const before = original(f, "a");
  expect(context(f, "a").delivery.status).toBe("queued");
  expect(inputCalls(f, "a")).toHaveLength(0);
  await checkFiles(f, "a");
  await receiptOnce(f, input, receipt);
  expect(original(f, "a")).toEqual(before);
  f.client.emit(
    "notification",
    notification("turn/completed", { threadId: external, turn: { id: "old-compact", status: "completed" } }),
  );
  await runCauseEffect(f.service.channels.wake(room));
  expect(inputCalls(f, "a")).toHaveLength(0);
  f.client.emit(
    "notification",
    notification("turn/completed", { threadId: external, turn: { id: "held-compact", status: "completed" } }),
  );
  await waitFor(() => context(f, "a").delivery.status === "running");
  expect(inputCalls(f, "a")).toHaveLength(1);
  expect(firstInputText(inputCalls(f, "a")[0]?.params)).toContain(input.text);
  expect(original(f, "a")).toEqual(before);
  expect(inputCalls(f, "b")).toHaveLength(1);
  await checkFiles(f, "a");
  report(f, "owned hold released");
});

it.each(["settle", "stop"])(
  "exact cold input evidence alone settles an unknown audience target without replaying its peer: %s",
  async (action) => {
    let f: Fixture;
    let external = "";
    let refused = false;
    f = await setup(async (method) => {
      if (method !== "turn/start" || refused) return;
      const request = f.client.requests.at(-1);
      const thread = f.service.channels.store.context(room, "a").threadId;
      if (
        f.store.database.activeProviderSession(thread, "codex")?.externalSessionId !==
        getString(request?.params, "threadId")
      )
        return;
      refused = true;
      external = getString(request?.params, "threadId") ?? "";
      throw new RequestTimeoutError("Codex", "turn/start");
    });
    const { input, receipt } = await send(f);
    await waitFor(() =>
      f.service.channels.store.assignments(room).some((item) => item.agentId === "b" && item.state === "running"),
    );
    await finish(f, "b");
    await waitFor(
      () => f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "a")?.state === "paused",
    );
    const before = original(f, "a");
    expect(context(f, "a").delivery.status).toBe("starting");
    f.client.emit("notification", notification("turn/started", { threadId: external, turn: { id: "unknown-turn" } }));
    f.client.emit(
      "notification",
      notification("turn/completed", { threadId: external, turn: { id: "unknown-turn", status: "completed" } }),
    );
    await receiptOnce(f, input, receipt);
    expect(f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "a")?.state).toBe("paused");
    expect(context(f, "a").delivery.status).toBe("starting");
    expect(inputCalls(f, "a")).toHaveLength(1);
    expect(inputCalls(f, "b")).toHaveLength(1);
    report(f, `unknown original: ${action}`);
    const target = receipt.targets.find((item) => item.agentId === "a");
    assert(target);
    if (action === "stop") {
      await runCauseEffect(
        f.service.channels.command(
          { type: "stop", channelId: room, operationId: "stop-unknown", taskId: target.taskId, recipientAgentId: null },
          actor,
        ),
      );
      f.client.emit(
        "notification",
        notification("turn/started", { threadId: external, turn: { id: "late-unknown-turn" } }),
      );
      f.client.emit(
        "notification",
        notification("turn/completed", { threadId: external, turn: { id: "late-unknown-turn", status: "completed" } }),
      );
      await receiptOnce(f, input, receipt);
      expect(context(f, "a").delivery.status).toBe("starting");
      expect(f.service.channels.store.tasks(room).find((task) => task.id === target.taskId)?.state).toBe("paused");
      expect(inputCalls(f, "a")).toHaveLength(1);
    }
    await runCauseEffect(f.service.stop());
    const restored = stores(root);
    const cold = new FakeAgentClient("codex", "", false);
    cold.threadRead = (params) => ({ thread: { id: getString(params, "threadId"), turns: [] } });
    const restarted = createTestService({ ...restored, clientFactory: () => cold });
    service = restarted;
    await runCauseEffect(restarted.initialize());
    const missing = { ...restored, service: restarted, client: cold, started: new Set<string>() };
    expect(original(missing, "a")).toEqual(before);
    expect(context(missing, "a").delivery.status).toBe("starting");
    await receiptOnce(missing, input, receipt);
    expect(cold.requests.filter((item) => item.method === "turn/start" || item.method === "turn/steer")).toHaveLength(
      0,
    );
    await checkFiles(missing, "a");
    await runCauseEffect(restarted.stop());
    const recovered = stores(root);
    const exact = new FakeAgentClient("codex", "", false);
    exact.threadRead = (params) => ({
      thread: {
        id: getString(params, "threadId"),
        turns:
          getString(params, "threadId") === external
            ? [
                {
                  id: "unknown-turn",
                  status: "completed",
                  items: [
                    {
                      type: "userMessage",
                      id: "provider-input",
                      clientId: before.id,
                      content: [{ type: "text", text: input.text }],
                    },
                  ],
                },
              ]
            : [],
      },
    });
    const accepted = createTestService({ ...recovered, clientFactory: () => exact });
    service = accepted;
    await runCauseEffect(accepted.initialize());
    const confirmed = { ...recovered, service: accepted, client: exact, started: new Set<string>() };
    expect(context(confirmed, "a").delivery.status).toBe("completed");
    expect(original(confirmed, "a")).toEqual(before);
    expect(accepted.channels.store.tasks(room).find((task) => task.ownerAgentId === "a")?.state).toBe(
      action === "stop" ? "paused" : "completed",
    );
    expect(exact.requests.filter((item) => item.method === "turn/start" || item.method === "turn/steer")).toHaveLength(
      0,
    );
    await checkFiles(confirmed, "a");
    report(confirmed, `exact evidence cold: ${action}`);
  },
);

it.each(["complete", "stop"])(
  "a definite external Compact refusal preserves original input through %s",
  async (action) => {
    let f: Fixture;
    let external = "";
    let refused = false;
    f = await setup(async (method) => {
      if (method !== "turn/start" || refused) return;
      const request = f.client.requests.at(-1);
      const thread = f.service.channels.store.context(room, "a").threadId;
      if (
        f.store.database.activeProviderSession(thread, "codex")?.externalSessionId !==
        getString(request?.params, "threadId")
      )
        return;
      refused = true;
      external = getString(request?.params, "threadId") ?? "";
      f.client.emit(
        "notification",
        notification("turn/started", { threadId: external, turn: { id: "external-compact" } }),
      );
      f.client.emit(
        "notification",
        notification("item/started", {
          threadId: external,
          turnId: "external-compact",
          item: { type: "contextCompaction", id: "compact-item" },
        }),
      );
      throw new AppServerError("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }", -32603);
    });
    const { input, receipt } = await send(f);
    await waitFor(() =>
      f.service.channels.store.assignments(room).some((item) => item.agentId === "b" && item.state === "running"),
    );
    await finish(f, "b");
    await waitFor(() => refused && context(f, "a").delivery.status === "queued");
    const before = original(f, "a");
    expect(f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "a")?.state).toBe("queued");
    await receiptOnce(f, input, receipt);
    expect(inputCalls(f, "a")).toHaveLength(1);
    await runCauseEffect(f.service.channels.wake(room));
    expect(inputCalls(f, "a")).toHaveLength(1);
    const target = receipt.targets.find((item) => item.agentId === "a");
    assert(target);
    if (action === "stop") {
      await runCauseEffect(
        f.service.channels.command(
          { type: "stop", channelId: room, operationId: "stop-a-once", taskId: target.taskId, recipientAgentId: null },
          actor,
        ),
      );
      expect(context(f, "a").delivery.status).toBe("cancelled");
    }
    f.client.emit(
      "notification",
      notification("turn/completed", { threadId: external, turn: { id: "external-compact", status: "completed" } }),
    );
    await receiptOnce(f, input, receipt);
    if (action === "complete") await waitFor(() => context(f, "a").delivery.status === "running");
    expect(context(f, "a").delivery.status).toBe(action === "stop" ? "cancelled" : "running");
    expect(original(f, "a")).toEqual(before);
    expect(inputCalls(f, "a")).toHaveLength(action === "stop" ? 1 : 2);
    if (action === "complete") expect(firstInputText(inputCalls(f, "a")[1]?.params)).toContain(input.text);
    expect(inputCalls(f, "b")).toHaveLength(1);
    expect(f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "b")?.state).toBe("completed");
    await checkFiles(f, "a");
    report(f, `external refusal: ${action}`);
  },
);

it.each(["finish", "stop", "completed-before-proof", "completion-during-proof"])(
  "exact live channel input confirms only its current owner without replay: %s",
  async (action) => {
    let f: Fixture;
    let external = "";
    let timedOut = false;
    f = await setup(async (method) => {
      if (method !== "turn/start" || timedOut) return;
      const request = f.client.requests.at(-1);
      const thread = f.service.channels.store.context(room, "a").threadId;
      if (
        f.store.database.activeProviderSession(thread, "codex")?.externalSessionId !==
        getString(request?.params, "threadId")
      )
        return;
      timedOut = true;
      external = getString(request?.params, "threadId") ?? "";
      throw new RequestTimeoutError("Codex", "turn/start");
    }, true);
    let mainExternal = "";
    if (action === "finish") {
      await runCauseEffect(f.service.sendMessage({ agentId: "a", text: "Load the main session control" }));
      await waitForQueue(f.service, "a", (queue) => queue.deliveries[0]?.status === "running");
      const warm = f.service.listQueue("a").deliveries[0];
      mainExternal = f.store.activeProviderSession("a")?.externalSessionId ?? "";
      assert(warm?.turnId && mainExternal);
      await waitFor(() => f.started.has(warm.turnId ?? ""));
      f.client.emit(
        "notification",
        notification("turn/completed", { threadId: mainExternal, turn: { id: warm.turnId, status: "completed" } }),
      );
      await waitForQueue(f.service, "a", (queue) => queue.deliveries[0]?.status === "completed");
    }
    const { input, receipt } = await send(f);
    await waitFor(() =>
      f.service.channels.store.assignments(room).some((item) => item.agentId === "b" && item.state === "running"),
    );
    await finish(f, "b");
    await waitFor(
      () => f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "a")?.state === "paused",
    );
    const before = original(f, "a");
    const target = assignment(f, "a");
    const thread = f.service.channels.store.context(room, "a").threadId;
    const turnId = "live-exact-turn";
    const proof = (threadId: string, id: string, proofTurn = turnId) =>
      f.client.emit(
        "notification",
        notification("item/started", {
          threadId,
          turnId: proofTurn,
          item: {
            id: `input-${id}-${proofTurn}`,
            type: "userMessage",
            clientId: id,
            content: [{ type: "text", text: input.text }],
          },
        }),
      );
    const barrier = async (id: string) => {
      f.client.emit(
        "notification",
        notification("item/started", {
          threadId: external,
          turnId,
          item: { id, type: "agentMessage", phase: "commentary", text: "Receipt boundary" },
        }),
      );
      await waitFor(() => f.store.database.readConversation("a", thread).messages.some((item) => item.id === id));
    };
    f.client.emit("notification", notification("turn/started", { threadId: external, turn: { id: turnId } }));
    proof(external, "another-input");
    proof(external, before.id, "another-turn");
    const peerThread = f.service.channels.store.context(room, "b").threadId;
    const peerExternal = f.store.database.activeProviderSession(peerThread, "codex")?.externalSessionId;
    assert(peerExternal);
    proof(peerExternal, before.id);
    if (mainExternal) {
      f.client.emit(
        "notification",
        notification("turn/started", { threadId: mainExternal, turn: { id: "wrong-main-turn" } }),
      );
      proof(mainExternal, before.id, "wrong-main-turn");
      f.client.emit(
        "notification",
        notification("item/started", {
          threadId: mainExternal,
          turnId: "wrong-main-turn",
          item: {
            id: "main-after-wrong-proof",
            type: "agentMessage",
            phase: "commentary",
            text: "Main thread boundary",
          },
        }),
      );
      const mainThread = f.store.list().find((agent) => agent.id === "a")?.threadId;
      assert(mainThread);
      await waitFor(() =>
        f.store.database
          .readConversation("a", mainThread)
          .messages.some((item) => item.id === "main-after-wrong-proof"),
      );
      f.client.emit(
        "notification",
        notification("turn/completed", {
          threadId: mainExternal,
          turn: { id: "wrong-main-turn", status: "completed" },
        }),
      );
      await waitFor(() => f.store.database.readConversation("a", mainThread).activeTurnId === null);
    }
    assert(f.foreign?.running);
    f.foreign.emit(
      "notification",
      notification("item/started", {
        threadId: external,
        turnId,
        item: { id: "foreign-input", type: "userMessage", clientId: before.id, content: [] },
      }),
    );
    await barrier("after-unmatched-proof");
    expect(context(f, "a").delivery.status).toBe("starting");
    expect(f.service.channels.store.tasks(room).find((task) => task.id === target.taskId)?.state).toBe("paused");
    if (action === "stop")
      await runCauseEffect(
        f.service.channels.command(
          { type: "stop", channelId: room, operationId: "stop-live", taskId: target.taskId, recipientAgentId: null },
          actor,
        ),
      );
    if (action === "completed-before-proof") {
      f.client.emit(
        "notification",
        notification("turn/completed", { threadId: external, turn: { id: turnId, status: "completed" } }),
      );
      await waitFor(() => f.store.database.readConversation("a", thread).activeTurnId === null);
    }
    let releaseReceipt = () => {};
    let receiptEntered = false;
    if (action === "completion-during-proof") {
      const waiting = new Promise<void>((resolve) => {
        releaseReceipt = resolve;
      });
      const markRunning = f.mailbox.markRunning.bind(f.mailbox);
      vi.spyOn(f.mailbox, "markRunning").mockImplementation((id, turn) => {
        if (id !== before.id) return markRunning(id, turn);
        receiptEntered = true;
        return Effect.promise(() => waiting).pipe(Effect.andThen(markRunning(id, turn)));
      });
    }
    proof(external, before.id);
    if (action === "completion-during-proof") {
      await waitFor(() => receiptEntered);
      f.client.emit(
        "notification",
        notification("turn/completed", { threadId: external, turn: { id: turnId, status: "completed" } }),
      );
      expect(context(f, "a").delivery.status).toBe("starting");
      releaseReceipt();
    }
    await barrier("after-exact-proof");
    if (action === "completed-before-proof") {
      expect(context(f, "a").delivery.status).toBe("starting");
      expect(f.service.channels.store.tasks(room).find((task) => task.id === target.taskId)?.state).toBe("paused");
    } else {
      await waitFor(
        () => context(f, "a").delivery.status === (action === "completion-during-proof" ? "completed" : "running"),
      );
      expect(assignment(f, "a").turnId).toBe(turnId);
      await waitFor(
        () =>
          f.service.channels.store.tasks(room).find((task) => task.id === target.taskId)?.state ===
          (action === "stop" ? "paused" : action === "completion-during-proof" ? "completed" : "running"),
      );
      if (action === "finish") {
        await finish(f, "a");
        await waitFor(() => context(f, "a").delivery.status === "completed");
      }
      if (action === "stop") {
        await waitFor(() =>
          f.client.requests.some(
            (request) => request.method === "turn/interrupt" && getString(request.params, "turnId") === turnId,
          ),
        );
        f.client.emit(
          "notification",
          notification("turn/completed", { threadId: external, turn: { id: turnId, status: "interrupted" } }),
        );
        await waitFor(() => context(f, "a").delivery.status === "interrupted");
        expect(f.service.channels.store.tasks(room).find((task) => task.id === target.taskId)?.state).toBe("paused");
      }
    }
    expect(original(f, "a")).toEqual(before);
    expect(inputCalls(f, "a")).toHaveLength(1);
    expect(inputCalls(f, "b")).toHaveLength(1);
    expect(f.service.channels.store.tasks(room).find((task) => task.ownerAgentId === "b")?.state).toBe("completed");
    await checkFiles(f, "a");
    await receiptOnce(f, input, receipt);
    report(f, `live receipt: ${action}`);
  },
);
