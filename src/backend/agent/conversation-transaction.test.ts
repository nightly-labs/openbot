// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { AgentStore } from "../agent-store";
import { runCauseEffect } from "../effect-boundary";
import {
  CONVERSATION_CACHE_BYTES_LIMIT,
  CONVERSATION_CACHE_MESSAGE_LIMIT,
  CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
  CONVERSATION_SNAPSHOT_IDLE_MS,
  ConversationRuntime,
  withDatabaseTransaction,
} from "./conversation-runtime";

let root: string;
let store: AgentStore;
let runtime: ConversationRuntime;

const AGENT_ID = "design";

function systemMessage(text: string): ConversationMessage {
  return {
    id: `message-${text}`,
    author: "system",
    source: "system",
    text,
    createdAt: new Date().toISOString(),
    status: "completed",
  };
}

function threadRowCount(): number {
  return store.database.connection.prepare("SELECT thread_id FROM projection_threads").all().length;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-conversation-transaction-"));
  store = new AgentStore(join(root, "user-data"), join(root, "home"));
  await runCauseEffect(store.initialize());
  await runCauseEffect(store.getOrCreate(AGENT_ID, "Design Studio", "Product design"));
  runtime = new ConversationRuntime(
    store,
    () => undefined,
    () => store.list(),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("conversation transactions", () => {
  it("lets an outer rollback discard a nested call's rows and its in-memory state together", () => {
    const message = systemMessage("nested");
    const published: string[] = [];
    runtime = new ConversationRuntime(
      store,
      (event) => {
        if (event.type === "conversation") published.push(event.snapshot.agentId);
      },
      () => store.list(),
    );
    const threadRowsBefore = threadRowCount();

    expect(() =>
      withDatabaseTransaction(store.database, () => {
        runtime.withConversationTransaction(AGENT_ID, ({ threadId, snapshot }) => {
          snapshot.messages.push(message);
          snapshot.revision = store.database.appendConversationMessage({
            agentId: AGENT_ID,
            threadId,
            activeTurnId: snapshot.activeTurnId,
            message,
            eventType: "test.nested-append",
          });
          return { result: undefined, snapshot };
        });
        // The inner call must not have committed: the outer rollback below has to reach its rows.
        throw new Error("the outer transaction failed");
      }),
    ).toThrow("the outer transaction failed");

    // The rows are gone, so nothing may still claim them: not the thread the nested call created,
    // not the projection the renderer reads, and not a conversation event already on the wire.
    expect(threadRowCount()).toBe(threadRowsBefore);
    expect(store.list().find((candidate) => candidate.id === AGENT_ID)?.threadId).toBeNull();
    expect(runtime.ensureSnapshot(AGENT_ID, null).messages).toEqual([]);
    expect(published).toEqual([]);
  });

  it("keeps memory agreeing with SQLite when publishing throws after the commit", () => {
    const message = systemMessage("committed");
    const threadRowsBefore = threadRowCount();
    runtime = new ConversationRuntime(
      store,
      (event) => {
        if (event.type === "conversation") throw new Error("a conversation listener failed");
      },
      () => store.list(),
    );

    expect(() =>
      runtime.withConversationTransaction(AGENT_ID, ({ threadId, snapshot }) => {
        snapshot.messages.push(message);
        snapshot.revision = store.database.appendConversationMessage({
          agentId: AGENT_ID,
          threadId,
          activeTurnId: snapshot.activeTurnId,
          message,
          eventType: "test.committed-append",
        });
        return { result: undefined, snapshot };
      }),
    ).toThrow("a conversation listener failed");

    // COMMIT already ran, so these rows are durable and nothing in memory may claim otherwise: a
    // restored snapshot or a cleared thread id would leave the renderer reading a conversation
    // SQLite no longer agrees with, and the caller retrying a mutation that already applied.
    expect(threadRowCount()).toBe(threadRowsBefore + 1);
    expect(store.list().find((candidate) => candidate.id === AGENT_ID)?.threadId).toBeTruthy();
    expect(runtime.snapshot(AGENT_ID)?.messages).toEqual([{ ...message, visibilityEpoch: expect.any(Number) }]);
    const threadId = store.list().find((candidate) => candidate.id === AGENT_ID)?.threadId;
    expect(runtime.snapshot(AGENT_ID)?.messages).toEqual(
      store.database.readConversation(AGENT_ID, threadId ?? null).messages,
    );
  });

  it("runs every post-commit effect after one of them throws", () => {
    const ran: string[] = [];
    const queueEffect =
      (name: string, fail = false) =>
      () => {
        ran.push(name);
        if (fail) throw new Error(`${name} failed`);
      };

    expect(() =>
      withDatabaseTransaction(
        store.database,
        () => {
          withDatabaseTransaction(store.database, () => undefined, undefined, queueEffect("first", true));
          withDatabaseTransaction(store.database, () => undefined, undefined, queueEffect("second"));
          return undefined;
        },
        undefined,
        queueEffect("owner"),
      ),
    ).toThrow("first failed");

    // The rows are durable, so a failure in one effect must not skip the effects queued after it.
    expect(ran).toEqual(["first", "second", "owner"]);
  });

  it("reports every post-commit failure when more than one effect throws", () => {
    const queueEffect = (message: string) => () => {
      throw new Error(message);
    };

    let thrown: unknown;
    try {
      withDatabaseTransaction(
        store.database,
        () => {
          withDatabaseTransaction(store.database, () => undefined, undefined, queueEffect("first failed"));
          withDatabaseTransaction(store.database, () => undefined, undefined, queueEffect("second failed"));
          return undefined;
        },
        undefined,
        queueEffect("owner failed"),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = thrown instanceof AggregateError ? thrown.errors : [];
    expect(errors.map((error) => (error instanceof Error ? error.message : String(error)))).toEqual([
      "first failed",
      "second failed",
      "owner failed",
    ]);
  });

  it("restores the snapshot and the thread identity when the body throws", () => {
    const before = structuredClone(runtime.ensureSnapshot(AGENT_ID, null));
    expect(before.threadId).toBeNull();
    const threadRowsBefore = threadRowCount();

    expect(() =>
      runtime.withConversationTransaction(AGENT_ID, ({ threadId, snapshot }) => {
        const message = systemMessage("discarded");
        snapshot.messages.push(message);
        snapshot.revision = store.database.appendConversationMessage({
          agentId: AGENT_ID,
          threadId,
          activeTurnId: snapshot.activeTurnId,
          message,
          eventType: "test.discarded-append",
        });
        throw new Error("the conversation work failed");
      }),
    ).toThrow("the conversation work failed");

    expect(runtime.snapshot(AGENT_ID)).toEqual(before);
    expect(store.list().find((candidate) => candidate.id === AGENT_ID)?.threadId).toBeNull();
    expect(threadRowCount()).toBe(threadRowsBefore);
  });

  it("rebuilds an evicted snapshot equal to SQLite, and keeps a snapshot that SQLite does not hold", () => {
    runtime.withConversationTransaction(AGENT_ID, ({ threadId, snapshot }) => {
      const message = systemMessage("persisted");
      snapshot.messages.push(message);
      snapshot.revision = store.database.appendConversationMessage({
        agentId: AGENT_ID,
        threadId,
        activeTurnId: snapshot.activeTurnId,
        message,
        eventType: "test.persisted-append",
      });
      return { result: undefined, snapshot };
    });
    const original = structuredClone(runtime.snapshot(AGENT_ID));
    const idle = Date.now() + 2 * CONVERSATION_SNAPSHOT_IDLE_MS;

    runtime.evictIdleSnapshots(idle);

    expect(runtime.loadedSnapshot(AGENT_ID)).toBeUndefined();
    // When no caller holds the evicted object any more, `snapshot` rebuilds it with this read.
    expect(store.database.readConversation(AGENT_ID, original?.threadId ?? null)).toEqual(original);
    expect(runtime.snapshot(AGENT_ID)).toEqual(original);

    // Streamed text before its flush is in memory only: evicting it would lose that text.
    runtime.snapshot(AGENT_ID)?.messages.push(systemMessage("not flushed"));
    runtime.evictIdleSnapshots(idle);

    expect(runtime.loadedSnapshot(AGENT_ID)?.messages.map((message) => message.text)).toEqual([
      "persisted",
      "not flushed",
    ]);
  });

  it("keeps only recent completed messages without deleting older durable rows", () => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const messages = Array.from({ length: CONVERSATION_CACHE_MESSAGE_LIMIT + 25 }, (_, index) =>
      systemMessage(`cached-${index}`),
    );
    const persisted = store.database.persistConversation(
      {
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        revision: 0,
        messages,
      },
      "test.cache-bounded",
    );

    runtime.setSnapshot(AGENT_ID, persisted);

    expect(runtime.snapshot(AGENT_ID)?.messages).toHaveLength(CONVERSATION_CACHE_MESSAGE_LIMIT);
    expect(runtime.snapshot(AGENT_ID)?.messages[0]?.text).toBe("cached-25");
    const recent = runtime.snapshot(AGENT_ID);
    if (!recent) throw new Error("The bounded snapshot was not retained.");
    const firstRecent = recent.messages[0];
    if (!firstRecent) throw new Error("The bounded snapshot has no recent messages.");
    firstRecent.text = "changed in cache";
    runtime.emitConversation(recent, "test.cache-update");
    expect(store.database.readConversation(AGENT_ID, threadId).messages).toHaveLength(messages.length);
    expect(store.database.readConversation(AGENT_ID, threadId).messages.at(-100)?.text).toBe("changed in cache");
    const bounded = runtime.ensureSnapshot(AGENT_ID, threadId);
    expect(bounded.messages).toHaveLength(CONVERSATION_CACHE_MESSAGE_LIMIT);
    expect(store.database.readConversation(AGENT_ID, threadId).messages[0]?.text).toBe("cached-0");
  });

  it("restores a late-visible input in a cold bounded runtime without returning old prefix history", () => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const write = (messages: ConversationMessage[]) =>
      store.database.persistConversationChanges({
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        changedMessages: messages,
        eventType: "test.cold-members",
      });
    const input: ConversationMessage = {
      ...systemMessage("early-input"),
      id: "early-input",
      author: "user",
      turnId: "turn-current",
      createdAt: "2026-10-08T00:00:00.000Z",
      delivery: { id: "early-input", status: "queued", position: 1 },
    };
    write([{ ...input, id: "old-prefix", delivery: undefined }, input]);
    write(
      Array.from({ length: 100 }, (_, index) => ({
        ...systemMessage(`reply-${index}`),
        author: "assistant",
        turnId: "turn-current",
        createdAt: "2026-10-08T00:00:02.000Z",
      })),
    );
    write([{ ...input, delivery: { id: "early-input", status: "completed", position: null } }]);
    const restored = runtime.ensureSnapshot(AGENT_ID, threadId);
    expect(restored.messages).toHaveLength(CONVERSATION_CACHE_MESSAGE_LIMIT);
    expect(restored.messages.some((message) => message.id === "early-input")).toBe(true);
    expect(restored.messages.some((message) => message.id === "old-prefix")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(restored))).toBeLessThan(CONVERSATION_CACHE_BYTES_LIMIT);
    const early = restored.messages.find((message) => message.id === "early-input");
    expect(early?.visibilityEpoch).toBeGreaterThan(0);
    runtime.emitConversation(restored, "test.cold-published");
    expect(runtime.snapshot(AGENT_ID)?.messages.find((message) => message.id === "early-input")).toBe(early);
    expect(store.database.readConversation(AGENT_ID, threadId).messages).toHaveLength(102);
  });

  it("does not publish cache omissions as deletions after a committed transaction", () => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const initial = Array.from({ length: 100 }, (_, index) => systemMessage(`old-${index}`));
    const persisted = store.database.persistConversation(
      {
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        revision: 0,
        messages: initial,
      },
      "test.seed-cache",
    );
    const removed: string[][] = [];
    runtime = new ConversationRuntime(
      store,
      (event) => {
        if (event.type === "conversation") removed.push(event.snapshot.window?.removedMessageIds ?? []);
      },
      () => store.list(),
    );
    runtime.setSnapshot(AGENT_ID, persisted);
    runtime.withConversationTransaction(AGENT_ID, ({ snapshot }) => {
      const added = Array.from({ length: 20 }, (_, index) => systemMessage(`new-${index}`));
      snapshot.messages.push(...added);
      snapshot.revision = store.database.persistConversationChanges({
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        changedMessages: added,
        eventType: "test.grow-cache",
      });
      return { result: undefined, snapshot };
    });
    expect(runtime.snapshot(AGENT_ID)?.messages).toHaveLength(100);
    expect(removed).toEqual([[]]);
    expect(store.database.readConversation(AGENT_ID, threadId).messages).toHaveLength(120);
  });

  it("publishes a cancellation even when retention omits its early body", () => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const cancelled: string[][] = [];
    runtime = new ConversationRuntime(
      store,
      (event) => {
        if (event.type === "conversation") cancelled.push(event.snapshot.window?.removedMessageIds ?? []);
      },
      () => store.list(),
    );
    const input: ConversationMessage = {
      ...systemMessage("input"),
      id: "input",
      author: "user",
      createdAt: "2026-10-08T00:00:00.000Z",
      delivery: { id: "input", status: "starting", position: null },
    };
    const replies = Array.from({ length: 100 }, (_, index) => ({
      ...systemMessage(`reply-${index}`),
      createdAt: "2026-10-08T00:00:02.000Z",
    }));
    const write = (messages: ConversationMessage[]) =>
      store.database.persistConversationChanges({
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        changedMessages: messages,
        eventType: "test.cancel-cache",
      });
    write(replies);
    write([input]);
    runtime.ensureSnapshot(AGENT_ID, threadId);
    runtime.withConversationTransaction(AGENT_ID, ({ snapshot }) => {
      const message = snapshot.messages.find((message) => message.id === "input");
      if (!message) throw new Error("The early input was not hydrated.");
      message.delivery = { id: "input", status: "cancelled", position: null };
      snapshot.revision = write([message]);
      return { result: undefined, snapshot };
    });
    expect(cancelled.at(-1)).toContain("input");
    expect(
      store.database.readConversation(AGENT_ID, threadId).messages.find((message) => message.id === "input")?.delivery
        ?.status,
    ).toBe("cancelled");
  });

  it("keeps the ordinary chronological tail for same-epoch completed runtime history", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ ...systemMessage(`row-${index}`), visibilityEpoch: 10 }));
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: null,
      revision: 20,
      messages: rows,
    });
    expect(runtime.snapshot(AGENT_ID)?.messages.map((message) => message.id)).toEqual(
      rows.slice(-100).map((message) => message.id),
    );
  });

  it("bounds inactive streaming count and bytes using the completed-history budget", () => {
    const rows = Array.from(
      { length: 125 },
      (_, index): ConversationMessage => ({ ...systemMessage(`stream-${index}`), status: "streaming" }),
    );
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: null,
      revision: 0,
      messages: rows,
    });
    expect(runtime.snapshot(AGENT_ID)?.messages.map((message) => message.id)).toEqual(
      rows.slice(-100).map((message) => message.id),
    );
    const large: ConversationMessage = {
      ...systemMessage("large"),
      text: "x".repeat(CONVERSATION_CACHE_BYTES_LIMIT),
      status: "streaming",
    };
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: null,
      revision: 0,
      messages: [large],
    });
    expect(runtime.snapshot(AGENT_ID)?.messages).toEqual([]);
  });

  it("preserves an active oversized response and bounds its completed neighbors and idle transition", () => {
    const rows = Array.from({ length: 125 }, (_, index) => systemMessage(`completed-${index}`));
    const large: ConversationMessage = {
      ...systemMessage("active"),
      text: "x".repeat(CONVERSATION_CACHE_BYTES_LIMIT),
      status: "streaming",
      turnId: "active",
    };
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: "active",
      revision: 0,
      messages: [...rows, large],
    });
    expect(runtime.snapshot(AGENT_ID)?.messages.map((message) => message.id)).toEqual(
      [...rows.slice(-100), large].map((message) => message.id),
    );
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: null,
      revision: 0,
      messages: [...rows, large],
    });
    expect(runtime.snapshot(AGENT_ID)?.messages).not.toContainEqual(large);
    expect(runtime.snapshot(AGENT_ID)?.messages.length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(JSON.stringify(runtime.snapshot(AGENT_ID)))).toBeLessThan(CONVERSATION_CACHE_BYTES_LIMIT);
  });

  it("does not retain an individual completed message larger than the cache budget", () => {
    const large = systemMessage("x".repeat(CONVERSATION_CACHE_BYTES_LIMIT));
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: null,
      revision: 0,
      messages: [large],
    });

    expect(runtime.snapshot(AGENT_ID)?.messages).toEqual([]);
  });

  it("deletes only an explicitly removed cached message", () => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const messages = Array.from({ length: CONVERSATION_CACHE_MESSAGE_LIMIT + 25 }, (_, index) =>
      systemMessage(`delete-${index}`),
    );
    store.database.persistConversation(
      {
        agentId: AGENT_ID,
        threadId,
        activeTurnId: null,
        revision: 0,
        messages,
      },
      "test.cache-delete",
    );
    runtime.ensureSnapshot(AGENT_ID, threadId);
    const cached = runtime.snapshot(AGENT_ID);
    if (!cached) throw new Error("The bounded snapshot was not retained.");
    const removed = cached.messages.shift();
    if (!removed) throw new Error("The bounded snapshot has no removable message.");
    runtime.emitConversation(cached, "test.cache-delete-message");

    const durable = store.database.readConversation(AGENT_ID, threadId).messages;
    expect(durable).toHaveLength(messages.length - 1);
    expect(durable.some((message) => message.id === removed.id)).toBe(false);
    expect(durable.some((message) => message.text === "delete-0")).toBe(true);
  });

  it("keeps all messages for a live turn until it is persisted", () => {
    const messages = Array.from({ length: CONVERSATION_CACHE_MESSAGE_LIMIT + 25 }, (_, index) =>
      systemMessage(`active-${index}`),
    );
    for (const message of messages) message.turnId = "turn-active";
    runtime.setSnapshot(AGENT_ID, {
      agentId: AGENT_ID,
      threadId: null,
      activeTurnId: "turn-active",
      revision: 0,
      messages,
    });

    expect(runtime.snapshot(AGENT_ID)?.messages).toHaveLength(messages.length);
  });

  it("trims completed data from active caches at the process budget", async () => {
    const completedText = "x".repeat(Math.floor(CONVERSATION_CACHE_BYTES_LIMIT * 0.95));
    const activeAgentIds: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const agentId = `active-cache-${index}`;
      activeAgentIds.push(agentId);
      await runCauseEffect(store.getOrCreate(agentId, agentId, "Active cache test"));
      const threadId = store.ensureThreadIdNow(agentId);
      runtime.setSnapshot(agentId, {
        agentId,
        threadId,
        activeTurnId: `turn-${agentId}`,
        revision: 0,
        messages: [
          { ...systemMessage(`${agentId}-completed`), id: `${agentId}-completed`, text: completedText },
          {
            ...systemMessage(`${agentId}-active`),
            id: `${agentId}-active`,
            turnId: `turn-${agentId}`,
            status: "streaming",
          },
        ],
      });
    }

    const activeSnapshots = activeAgentIds.map((agentId) => runtime.snapshot(agentId));
    expect(
      activeSnapshots.every((snapshot) => snapshot?.messages.some((message) => message.status === "streaming")),
    ).toBe(true);
    expect(
      activeSnapshots.some((snapshot) => snapshot?.messages.every((message) => message.status === "streaming")),
    ).toBe(true);
    const completedBytes = activeSnapshots.reduce((total, snapshot) => {
      if (!snapshot) return total;
      return (
        total +
        Buffer.byteLength(
          JSON.stringify({
            ...snapshot,
            messages: snapshot.messages.filter((message) => message.status !== "streaming"),
          }),
          "utf8",
        )
      );
    }, 0);
    expect(completedBytes).toBeLessThanOrEqual(CONVERSATION_CACHE_TOTAL_BYTES_LIMIT);
  });

  it("keeps a budget-evicted committed snapshot available to mailbox updates", async () => {
    const completedText = "x".repeat(Math.floor(CONVERSATION_CACHE_BYTES_LIMIT * 0.95));
    const heldSnapshots: ConversationMessage[][] = [];
    const agentIds: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const agentId = `evicted-cache-${index}`;
      agentIds.push(agentId);
      await runCauseEffect(store.getOrCreate(agentId, agentId, "Evicted cache test"));
      const threadId = store.ensureThreadIdNow(agentId);
      runtime.setSnapshot(agentId, {
        agentId,
        threadId,
        activeTurnId: null,
        revision: 0,
        messages: [{ ...systemMessage(`${agentId}-completed`), text: completedText }],
      });
      const snapshot = runtime.snapshot(agentId);
      if (!snapshot) throw new Error("The cache snapshot was not retained.");
      heldSnapshots.push(snapshot.messages);
    }

    const firstAgentId = agentIds[0];
    const firstMessages = heldSnapshots[0];
    if (!firstAgentId || !firstMessages) throw new Error("The first cache snapshot was not retained.");
    expect(runtime.loadedSnapshot(firstAgentId)).toBeUndefined();
    expect(runtime.snapshotToUpdate(firstAgentId)?.messages).toEqual(firstMessages);
  });

  it("ignores a late provider snapshot after an execution thread is forgotten", () => {
    const threadId = "channel-execution-thread";
    const now = new Date().toISOString();
    store.database.connection
      .prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)")
      .run(threadId, AGENT_ID, "Channel", now, now, 0);
    runtime.registerExecutionThread(AGENT_ID, threadId);
    const lateSnapshot = runtime.ensureSnapshot(AGENT_ID, threadId);

    runtime.forgetExecutionThread(threadId);
    lateSnapshot.messages.push(systemMessage("late provider result"));
    runtime.setSnapshot(AGENT_ID, lateSnapshot);
    runtime.emitConversation(lateSnapshot, "late-turn.completed");

    expect(runtime.isExecutionThread(threadId)).toBe(false);
    expect(
      store.database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_thread_messages WHERE thread_id = ?")
        .get(threadId),
    ).toEqual({ count: 0 });
  });
});

describe("authoritative cold conversation fragments", () => {
  it.each([false, true])("keeps a split turn's SQL order in cold runtime with supplemental=%s", (withSupplement) => {
    const threadId = store.ensureThreadIdNow(AGENT_ID);
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 8) + seconds * 1000).toISOString();
    const row = (id: string, seconds: number, author: "user" | "assistant" = "assistant"): ConversationMessage => ({
      id,
      author,
      text: id,
      createdAt: at(seconds),
      status: "completed",
      turnId: "turn",
    });
    const reveal: ConversationMessage = {
      ...row("other-turn-input", -20, "user"),
      turnId: "other",
      delivery: { id: "other-delivery", status: "queued", position: 1 },
    };
    const messages = [
      row("initial-input", 0, "user"),
      row("first-steer", 5, "user"),
      ...Array.from({ length: 120 }, (_, index) => row(`reply-${index}`, index + 10)),
      row("later-steer", 75.5, "user"),
    ];
    store.database.persistConversation(
      {
        agentId: AGENT_ID,
        threadId,
        activeTurnId: "turn",
        revision: 0,
        messages: withSupplement ? [reveal, ...messages] : messages,
      },
      "test.seed",
      {},
      undefined,
      "live",
    );
    assert(reveal.delivery);
    if (withSupplement)
      store.database.persistConversationChanges({
        agentId: AGENT_ID,
        threadId,
        activeTurnId: "turn",
        changedMessages: [{ ...reveal, delivery: { ...reveal.delivery, status: "completed", position: null } }],
        eventType: "test.reveal",
      });
    const page = store.database.readConversationPage(AGENT_ID, threadId, { type: "latest" }, 100);
    const canonical = page.messages.map((message) => message.id);
    expect(canonical).not.toContain("first-steer");
    const snapshot = runtime.ensureSnapshot(AGENT_ID, threadId);
    expect(snapshot.messages.filter((message) => canonical.includes(message.id)).map((message) => message.id)).toEqual(
      canonical,
    );
    expect(snapshot.messages.map((message) => message.id)).toEqual(
      withSupplement ? [reveal.id, ...canonical] : canonical,
    );
    expect(store.database.readConversationPage(AGENT_ID, threadId, { type: "latest" }, 100)).toEqual(page);
  });
});
