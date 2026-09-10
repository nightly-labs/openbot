import type { AgentEvent, ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { indexChatMessages, projectChatMessages } from "../../chat/model/chat-messages";
import { reduceAgentActivity } from "./agent-activity";
import { decodeConversationPage } from "./conversation";
import { MobileConversationStore } from "./conversation-store";

function message(id: string, text = id): ConversationMessage {
  return { id, text, author: "assistant", source: "assistant", createdAt: "2026-09-10T10:00:00Z", status: "completed" };
}
function page(ids: string[], revision = 1): ConversationPage {
  return {
    agentId: "agent",
    threadId: "thread",
    activeTurnId: null,
    revision,
    messages: ids.map((id) => message(id)),
    references: {},
    pageInfo: { hasOlder: true, olderCursor: ids[0] ?? null },
  };
}
function delta(revision: number, text: string): Extract<AgentEvent, { type: "conversation-delta" }> {
  return {
    type: "conversation-delta",
    agentId: "agent",
    threadId: "thread",
    turnId: "turn",
    messageId: "reply",
    revision,
    delta: text,
    createdAt: "2026-09-10T10:00:00Z",
  };
}
function setup() {
  const frames = new Set<() => void>();
  const store = new MobileConversationStore((flush) => {
    frames.add(flush);
    return () => frames.delete(flush);
  });
  return {
    store,
    frame: () => {
      for (const flush of [...frames]) flush();
    },
  };
}

describe("mobile conversation windows", () => {
  it("does not let an older page advance the live revision and discard queued text", () => {
    const { store, frame } = setup();
    store.applyPage(page(["reply"], 10));
    store.applyPage(page(["old"], 20), "reply");
    store.enqueue(delta(11, " still arriving"));
    frame();
    expect(store.get("agent")?.messages.map((item) => item.text)).toEqual(["old", "reply still arriving"]);
  });

  it("streams the first response into a chat that did not have a thread", () => {
    const { store, frame } = setup();
    store.applyPage({ ...page([]), threadId: null, pageInfo: { hasOlder: false, olderCursor: null } });
    store.enqueue(delta(2, "Hello"));
    frame();
    expect({ threadId: store.get("agent")?.threadId, text: store.get("agent")?.messages[0]?.text }).toEqual({
      threadId: "thread",
      text: "Hello",
    });
  });

  it("loads older messages without duplicates or losing newer streamed text and reply references", () => {
    const { store } = setup();
    store.applyPage(page(["recent", "reply"], 10));
    store.enqueue(delta(11, " latest"));
    const older = page(["old", "recent"], 9);
    older.references = { source: message("source", "Referenced outside the window") };
    store.applyPage(older, "recent");
    const latest = store.get("agent");
    const index = indexChatMessages(
      projectChatMessages(latest?.messages ?? []),
      new Map(),
      projectChatMessages(Object.values(latest?.references ?? {})),
    );
    expect({
      messages: latest?.messages.map((item) => [item.id, item.text]),
      revision: latest?.revision,
      cursor: latest?.pageInfo.olderCursor,
      reference: index.get("source"),
    }).toEqual({
      messages: [
        ["old", "old"],
        ["recent", "recent"],
        ["reply", "reply latest"],
      ],
      revision: 11,
      cursor: "old",
      reference: {
        id: "source",
        kind: "message",
        author: "agent",
        body: "Referenced outside the window",
        streaming: false,
      },
    });
  });

  it("keeps a continuous window on refresh and resets it if a reconnect leaves a gap", () => {
    const { store } = setup();
    store.applyPage(page(["a", "b", "c"]));
    store.applyPage(page(["c", "d"], 2));
    const continuous = store.get("agent");
    store.applyPage(page(["x", "y"], 3));
    const reset = store.get("agent");
    store.applyPage(page(["old"], 2), "a");
    expect({
      continuous: continuous?.messages.map((item) => item.id),
      cursor: continuous?.pageInfo.olderCursor,
      reset: reset?.messages.map((item) => item.id),
      staleOlderIgnored: store.get("agent") === reset,
    }).toEqual({
      continuous: ["a", "b", "c", "d"],
      cursor: "a",
      reset: ["x", "y"],
      staleOlderIgnored: true,
    });
  });

  it("publishes one streamed update per frame only to the changed chat and ignores stale data", () => {
    const { store, frame } = setup();
    let updates = 0;
    let unrelatedUpdates = 0;
    store.subscribe("agent", () => updates++);
    store.subscribe("another-agent", () => unrelatedUpdates++);
    store.applyPage(page([...Array.from({ length: 9999 }, (_, index) => `old-${index}`), "reply"], 10));
    const old = projectChatMessages(store.get("agent")?.messages ?? [])[0];
    updates = 0;
    store.enqueue(delta(11, " one"));
    store.enqueue(delta(12, " two"));
    store.enqueue(delta(11, " duplicate"));
    frame();
    store.applyPage(page(["reply"], 9));
    const projected = projectChatMessages(store.get("agent")?.messages ?? []);
    expect({ updates, unrelatedUpdates, oldRetained: projected[0] === old, reply: projected.at(-1) }).toEqual({
      updates: 1,
      unrelatedUpdates: 0,
      oldRetained: true,
      reply: { id: "reply", kind: "message", author: "agent", body: "reply one two", streaming: true },
    });
  });

  it("shares a pending page request and refreshes again when invalidated during the request", async () => {
    const { store } = setup();
    const first = Promise.withResolvers<ConversationPage>();
    const started = Promise.withResolvers<void>();
    let reads = 0;
    const read = () => {
      reads++;
      started.resolve();
      return reads === 1 ? first.promise : Promise.resolve(page(["new"], 2));
    };
    const pending = store.loadLatest("agent", read, () => true);
    await started.promise;
    const duplicate = store.loadLatest("agent", read, () => true, true);
    first.resolve(page(["old"]));
    await pending;
    expect({
      shared: duplicate === pending,
      reads,
      messages: store.get("agent")?.messages.map((item) => item.id),
    }).toEqual({ shared: true, reads: 2, messages: ["new"] });
  });

  it("does not restore a removed chat from an in-flight response", async () => {
    const { store } = setup();
    const response = Promise.withResolvers<ConversationPage>();
    const started = Promise.withResolvers<void>();
    const pending = store.loadLatest(
      "agent",
      () => {
        started.resolve();
        return response.promise;
      },
      () => true,
    );
    await started.promise;
    store.remove("agent");
    response.resolve(page(["private"]));
    await pending;
    expect(store.get("agent")).toBeUndefined();
  });

  it("lets a new connection load while the old connection still has an outstanding request", async () => {
    const { store } = setup();
    const response = Promise.withResolvers<ConversationPage>();
    const started = Promise.withResolvers<void>();
    const previous = store.loadLatest(
      "agent",
      () => {
        started.resolve();
        return response.promise;
      },
      () => true,
    );
    await started.promise;
    store.cancelRequests();
    await store.loadLatest(
      "agent",
      async () => page(["current"], 2),
      () => true,
    );
    response.resolve(page(["obsolete"], 5));
    await previous;
    expect(store.get("agent")?.messages.map((item) => item.id)).toEqual(["current"]);
  });

  it("keeps existing messages after an older-page failure and permits retry", async () => {
    const { store } = setup();
    store.applyPage(page(["recent"]));
    await store.loadOlder(
      "agent",
      async () => {
        throw new Error("offline");
      },
      () => true,
    );
    const failure = store.get("agent");
    await store.loadOlder(
      "agent",
      async () => ({ ...page(["old"]), pageInfo: { hasOlder: false, olderCursor: null } }),
      () => true,
    );
    const retry = store.get("agent");
    expect({
      retained: failure?.messages.map((item) => item.id),
      failed: failure?.olderError,
      pending: failure?.olderLoading,
      retry: retry?.messages.map((item) => item.id),
      error: retry?.olderError,
      hasOlder: retry?.pageInfo.hasOlder,
    }).toEqual({
      retained: ["recent"],
      failed: true,
      pending: false,
      retry: ["old", "recent"],
      error: false,
      hasOlder: false,
    });
  });

  it("releases large inactive windows and cancels queued streaming work on disposal", () => {
    const { store, frame } = setup();
    const release = store.subscribe("agent", () => {});
    store.applyPage(page(Array.from({ length: 1000 }, (_, index) => String(index))));
    store.enqueue(delta(2, "pending"));
    release();
    store.dispose();
    frame();
    expect(store.get("agent")).toBeUndefined();
  });

  it("rejects invalid page cursors and invalid reply references", () => {
    const badCursor = { ...page(["a"]), pageInfo: { hasOlder: true, olderCursor: null } };
    const badReference = { ...page(["a"]), references: { secret: { text: "invalid" } } };
    const errors = [badCursor, badReference].map((input) => {
      try {
        decodeConversationPage(input);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "unexpected";
      }
    });
    expect(errors).toEqual([
      "The server returned an invalid conversation page.",
      "The server returned an invalid conversation message.",
    ]);
  });

  it("does not update workspace activity for each token of the same response", () => {
    const current = reduceAgentActivity({}, delta(1, "first"));
    expect(reduceAgentActivity(current, delta(2, "second"))).toBe(current);
  });
});
