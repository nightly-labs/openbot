// @vitest-environment node
import { type ConversationMessage, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { MailboxSync } from "../../backend/agent/mailbox-sync";
import {
  type StartedService,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
} from "../../backend/agent-service-test-harness";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeConversationPageFromMain } from "../../preload/conversation-decoding";

const { bound } = vi.hoisted(() => ({
  bound: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => bound.set(name, handler),
  },
}));
const { conversationPageIpcHandler } = await import("./agent-handlers");
const { parseReadConversationPage } = await import("./agent-inputs");
const trusted = { senderFrame: { url: "openbot-app://app/index.html" } };
let root: string;
let started: StartedService;
let threadId: string;
const remote = vi.fn(() => Effect.die(new Error("Unexpected remote proof")));
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  started = await startService(root, { provider: "codex" });
  const agent = await runCauseEffect(started.store.getOrCreate("proof-agent"));
  // This is a durable fixture thread, not a provider session or a user workspace.
  threadId = started.store.ensureThreadIdNow(agent.id);
  const rows: ConversationMessage[] = [
    {
      id: "first",
      author: "user",
      text: "Input",
      createdAt: "2026-10-09T00:00:00Z",
      status: "completed",
      turnId: "turn",
    },
    {
      id: "reply",
      author: "assistant",
      text: "Answer",
      createdAt: "2026-10-09T00:00:01Z",
      status: "completed",
      turnId: "turn",
    },
  ];
  started.store.database.persistConversation(
    { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages: rows },
    "fixture",
    {},
    "proof-fixture",
    "live",
  );
  bound.clear();
  remote.mockClear();
  conversationPageIpcHandler(
    {
      readAgentConversationPage: (id, anchor, limit, proof) =>
        started.service.readConversationPageFor(id, "local-reader", anchor, limit, undefined, proof),
    },
    { readAgentConversationPage: remote },
  )(IPC_ENDPOINTS.agent.readConversationPage.channel);
});
afterEach(async () => {
  await stopAgentTestFixture(root, started.service);
  started.store.database.close();
});
function request(ids = ["reply", "first"]) {
  const agent = started.store.list()[0];
  assert(agent);
  return {
    agentId: agent.id,
    orderProof: {
      expectedThreadId: threadId,
      expectedRevision: started.store.database.readConversationRevision(agent.id, threadId),
      messageIds: ids,
    },
  };
}
async function invoke(payload: unknown, serverId = "local", event: unknown = trusted) {
  const handler = bound.get(IPC_ENDPOINTS.agent.readConversationPage.channel);
  assert(handler);
  return decodeConversationPageFromMain(await handler(event, { serverId, payload }));
}
it("passes parser, trusted handler, actual service read-only owner and preload without mailbox, cache or read-state writes", async () => {
  const database = started.store.database;
  const before = JSON.stringify(started.service.getRuntimeSnapshot());
  const reconcile = vi.spyOn(MailboxSync.prototype, "reconcilePersistedMailboxMessages");
  const existing = vi.spyOn(started.store, "existing");
  const input = request();
  const prepares = vi.spyOn(database.connection, "prepare");
  const result = await invoke(input);
  expect(result.orderProof?.revision).toBe(input.orderProof.expectedRevision);
  expect(result.orderProof?.entries.map((entry) => entry.id)).toEqual(["reply", "first"]);
  expect(result.messages).toEqual([]);
  expect(result.readState).toBeUndefined();
  expect(existing).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(prepares.mock.calls).toHaveLength(1);
  expect(prepares.mock.calls[0]?.[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|BEGIN)\b/);
  expect(JSON.stringify(started.service.getRuntimeSnapshot())).toBe(before);
});
it("keeps missing keys nullable and selects the thread from the owner, not the assertion", async () => {
  const page = await invoke(request(["missing", "first"]));
  expect(page.orderProof?.entries[0]).toEqual({ id: "missing", order: null });
  await expect(
    invoke({ ...request(), orderProof: { ...request().orderProof, expectedThreadId: "foreign" } }),
  ).rejects.toThrow();
});
it("rejects remote proofs and untrusted senders before any service/query or remote forwarding", async () => {
  const read = vi.spyOn(started.service, "readConversationPageFor");
  await expect(invoke(request(), "other-server")).rejects.toThrow("cannot verify");
  await expect(invoke(request(), "local", { senderFrame: { url: "https://foreign.example/" } })).rejects.toThrow();
  expect(remote).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it("rejects unbounded, duplicate, malformed and unsafe requests and malformed response ownership", async () => {
  for (const proof of [
    { ...request().orderProof, messageIds: [] },
    { ...request().orderProof, messageIds: ["first", "first"] },
    { ...request().orderProof, messageIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) },
    { ...request().orderProof, expectedRevision: 2 ** 53 },
    { ...request().orderProof, messageIds: ["x".repeat(129)] },
  ])
    expect(() => parseReadConversationPage({ ...request(), orderProof: proof })).toThrow();
  const good = await invoke(request());
  assert(good.orderProof);
  for (const value of [
    { ...good, threadId: "foreign" },
    { ...good, revision: good.revision + 1 },
    { ...good, messages: [{ id: "body" }] },
    { ...good, messageOrder: [] },
    { ...good, orderProof: { ...good.orderProof, entries: [...good.orderProof.entries, good.orderProof.entries[0]] } },
    {
      ...good,
      orderProof: {
        ...good.orderProof,
        entries: [{ id: "reply", order: { id: "first", key: ["", 0, "turn", 0, "", 0, "first"] } }],
      },
    },
  ])
    expect(() => decodeConversationPageFromMain(value)).toThrow();
});
