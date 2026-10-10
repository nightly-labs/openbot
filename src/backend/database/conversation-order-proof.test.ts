// @vitest-environment node
// Actual writer and read-only production query controls. No provider process.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { type AgentSummary, type ConversationMessage, compareConversationMessageOrder } from "@openbot/contracts/ipc";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { runCauseEffect } from "../effect-boundary";

import { OpenBotDatabase } from "../openbot-database";

let root: string, db: OpenBotDatabase;
const agent: AgentSummary = {
  id: "chief",
  provider: "codex",
  name: "Chief",
  title: "Coordinator",
  description: "",
  notifications: true,
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: "thread-chief",
  workspacePath: "/tmp/fixture-chief",
  preview: "",
  updatedAt: "2026-10-09T00:00:00.000Z",
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
};
function present<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}
const threadId = "thread-chief";
const at = (n: number) => new Date(Date.UTC(2026, 9, 9) + n * 1000).toISOString();
const row = (id: string, seconds = 2, fields: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  author: "assistant",
  text: id,
  createdAt: at(seconds),
  status: "completed",
  turnId: "turn",
  ...fields,
});
const write = (messages: ConversationMessage[]) =>
  db.persistConversation(
    { agentId: agent.id, threadId: agent.threadId, activeTurnId: "turn", revision: 0, messages },
    "prototype.full",
    {},
    undefined,
    "live",
  );
const keys = (ids: string[]) => {
  const page = db.readConversationOrderProof(agent.id, threadId, {
    expectedThreadId: threadId,
    expectedRevision: db.readConversationRevision(agent.id, threadId),
    messageIds: ids,
  });
  assert(page.orderProof);
  return page.orderProof;
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-order-proof-"));
  db = new OpenBotDatabase(root);
  await runCauseEffect(db.initialize());
  db.replaceAgents("prototype.seed", [agent], "agents.updated");
});
afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

it("refreshes all row ordinals after a full write and pairs keys with the new revision", () => {
  const first = row("first", 0, { author: "user" }),
    a = row("a-reply"),
    b = row("b-reply");
  const before = write([first, a, b]);
  const old = keys([a.id]);
  const input = row("z-input", 2, { author: "user" });
  const after = write([first, input, a, b]);
  const proof = keys([first.id, input.id, a.id, b.id]);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(proof.revision).toBe(after.revision);
  expect(present(old.entries[0]).order?.key[5]).toBe(1);
  expect(present(proof.entries.find((entry) => entry.id === a.id)).order?.key[5]).toBe(2);
  expect(
    proof.entries
      .map((entry) => present(entry.order))
      .sort(compareConversationMessageOrder)
      .map((entry) => entry.id),
  ).toEqual([first.id, input.id, a.id, b.id]);
});

it("proves the streaming owner can change exact row turn, role, time and ordinal", () => {
  const first = row("first", 0, { author: "user" }),
    a = row("a-reply"),
    b = row("b-reply");
  write([first, a, b]);
  const old = keys([a.id]);
  const changed = row(a.id, 1, { author: "user", turnId: "other-turn", status: "streaming" });
  db.persistStreamingMessage({
    snapshot: {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: "turn",
      revision: 0,
      messages: [first, b, changed],
    },
    messageId: a.id,
    eventType: "prototype.stream",
  });
  const fresh = keys([a.id]);
  expect(present(present(old.entries[0]).order).key).not.toEqual(present(present(fresh.entries[0]).order).key);
  expect(present(present(fresh.entries[0]).order).key[2]).toBe("turn:other-turn");
  expect(present(present(fresh.entries[0]).order).key[4]).toBe(at(1));
  expect(present(present(fresh.entries[0]).order).key[5]).toBe(2);
  expect(db.readConversation(agent.id, agent.threadId).messages.find((row) => row.id === a.id)).toMatchObject({
    author: "user",
    turnId: "other-turn",
    createdAt: at(1),
  });
});

it("uses exact SQLite equal-time peers, incoming teammate and independent null-turn order", () => {
  const rows = [
    row("first", 0, { author: "user" }),
    row("z-input", 2, { author: "user" }),
    row("a-peer", 2),
    row("independent", 1, { turnId: undefined }),
    row("incoming", 2, {
      author: "agent",
      exchange: {
        direction: "incoming",
        messageId: "incoming",
        senderAgentId: "peer",
        recipientAgentIds: [agent.id],
        replyToMessageId: null,
        deliveries: [],
      },
    }),
  ];
  write(rows);
  // Streaming can create equal created_at+ordinal RANGE peers without direct table edits.
  const peer = present(rows.find((row) => row.id === "a-peer"));
  const currentRevision = db.persistStreamingMessage({
    snapshot: {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: "turn",
      revision: 0,
      messages: [present(rows[0]), peer, ...rows.filter((row) => row.id !== "first" && row.id !== peer.id)],
    },
    messageId: peer.id,
    eventType: "prototype.peer",
  });
  const pair = keys(["z-input", "a-peer"]);
  expect(pair.entries.map((entry) => present(entry.order).key.slice(3, 6))).toEqual([
    [4, at(2), 1],
    [4, at(2), 1],
  ]);
  const expected = db
    .readConversationPage(agent.id, agent.threadId, { type: "latest" }, 50)
    .messages.map((row) => row.id);
  const ordered = keys(rows.map((row) => row.id))
    .entries.map((entry) => present(entry.order))
    .sort(compareConversationMessageOrder);
  expect(ordered.map((entry) => entry.id)).toEqual(expected);
  expect(keys(rows.map((row) => row.id)).revision).toBe(currentRevision);
  const independent = present(present(keys(["independent"]).entries[0]).order);
  expect(independent.key[2]).toBe("message:independent");
  const raw = db.connection
    .prepare(
      "SELECT author,json_extract(message_json,'$.exchange.direction') AS direction FROM projection_thread_messages WHERE message_id = ?",
    )
    .get("incoming");
  expect(raw).toMatchObject({ author: "agent", direction: "incoming" });
});

it("measures production read-only exact keys over five thousand writer rows without canonical body queries", async () => {
  const rows = [
    row("first", 0, { author: "user" }),
    ...Array.from({ length: 4999 }, (_, i) => row(`reply-${i}`, i + 1)),
  ];
  write(rows);
  const ids = rows.slice(-601).map((row) => row.id);
  const prepares = vi.spyOn(db.connection, "prepare");
  const start = performance.now();
  let bytes = 0;
  for (let offset = 0; offset < ids.length; offset += 200)
    bytes += Buffer.byteLength(JSON.stringify(keys(ids.slice(offset, offset + 200))));
  const elapsedMs = performance.now() - start;
  // keys() asks for revision only to construct its request; the owner proof itself is one statement.
  const queries = prepares.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes("requested(request_id)"));
  expect(queries).toHaveLength(4);
  const sql = present(queries[0]);
  expect(sql.split("SELECT t.last_event_sequence")[1]).not.toContain("message_json");
  const part = ids.slice(0, 200);
  const explain = db.connection.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(threadId, ...part, threadId, agent.id);
  await writeFile(
    ".openbot-build/visibility-upstream/order-proof-query-cost.json",
    JSON.stringify(
      {
        rows: 5000,
        identities: 601,
        batches: 4,
        elapsedMs,
        bytes,
        explain,
        sql,
        limitation:
          "Production SQLite owner in a Node fixture. Not a device or provider benchmark. Each batch evaluates the upstream ordering CTE; only keys leave SQLite.",
      },
      null,
      2,
    ),
  );
});
