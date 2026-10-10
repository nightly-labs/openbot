// Cross-boundary test fixture: real host pages enter the renderer through the mocked IPC bridge.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  AgentSummary,
  ConversationMessage,
  ConversationMessageOrder,
  ConversationPage,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { For, flush } from "solid-js";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_KEY_COLUMNS, ORDERED_THREAD_MESSAGES } from "../../backend/database/conversation-queries";
import { runCauseEffect } from "../../backend/effect-boundary";
import { OpenBotDatabase } from "../../backend/openbot-database";
import { AppProviders } from "../src/app-providers";
import {
  attachment,
  emitAgentEvent,
  emitAuth,
  emitServers,
  installOpenbotStub,
  queuedDelivery,
  testConversationPage,
  testServer,
} from "../src/app-test-harness";
import { useAuth } from "../src/features/account/account-context";
import { useAgents } from "../src/features/agents/agents-context";
import { useConversation } from "../src/features/conversation/conversation-context";
import { useServers } from "../src/features/servers/servers-context";
import { presentQueueDeliveries } from "../src/queue-reconciliation";
import { useTurns } from "../src/turns";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 8) + seconds * 1000).toISOString();
const message = (id: string, seconds: number, fields: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  author: "assistant",
  text: id,
  createdAt: at(seconds),
  status: "completed",
  ...fields,
});
const page = (messages: ConversationMessage[], revision = 1): ConversationPage =>
  testConversationPage("chief", messages, {
    threadId: "thread-chief",
    revision,
    activeTurnId: "current",
    pageInfo: { hasOlder: true, olderCursor: "page-boundary" },
  });
const snapshot = (messages: ConversationMessage[], revision: number): ConversationSnapshot => ({
  agentId: "chief",
  threadId: "thread-chief",
  activeTurnId: "current",
  revision,
  messages: sortConversationMessages([...messages]),
});

function installFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(0);
    flush();
  };
}

interface ProofScope {
  auth: ReturnType<typeof useAuth>;
  servers: ReturnType<typeof useServers>;
  turns: ReturnType<typeof useTurns>;
}
function TranscriptProbe(props: {
  captureScope?: (scope: ProofScope) => void;
  capture: (conversation: ReturnType<typeof useConversation>) => void;
  captureAgents?: (agents: ReturnType<typeof useAgents>) => void;
}) {
  const conversation = useConversation();
  const turns = useTurns();
  props.capture(conversation);
  props.captureScope?.({ auth: useAuth(), servers: useServers(), turns });
  props.captureAgents?.(useAgents());
  return (
    <>
      <section aria-label="Transcript">
        <For each={conversation.activeMessages()}>
          {(row) => (
            <p>
              {row.body}
              {row.attachments?.map((file) => file.name).join(",")}
            </p>
          )}
        </For>
      </section>
      <output aria-label="Queue members">
        {presentQueueDeliveries({
          snapshot: turns.queues().chief,
          activeTurnId: turns.activeTurns().chief,
          renderedMessageIds: new Set(conversation.activeMessages().map((row) => row.id)),
        })
          .map((delivery) => delivery.id)
          .join(",")}
      </output>
    </>
  );
}

async function mountConversation(
  initial: ConversationPage,
  captureAgents?: (agents: ReturnType<typeof useAgents>) => void,
  captureScope?: (scope: ProofScope) => void,
) {
  vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) => {
    if (input.orderProof) return database.readConversationOrderProof(input.agentId, initial.threadId, input.orderProof);
    return initial;
  });
  let captured: ReturnType<typeof useConversation> | undefined;
  render(() => (
    <AppProviders>
      <TranscriptProbe
        captureScope={captureScope}
        captureAgents={captureAgents}
        capture={(conversation) => {
          captured = conversation;
        }}
      />
    </AppProviders>
  ));
  await waitFor(() => expect(captured?.conversations.chief?.loaded).toBe(true));
  assert(captured);
  return captured;
}

let database: OpenBotDatabase;
let root: string;
beforeEach(async () => {
  installOpenbotStub();
  root = await mkdtemp(join(tmpdir(), "openbot-window-current-"));
  database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  database.close();
  await rm(root, { recursive: true, force: true });
});

async function currentPage(inputSeconds: number, split = false, replyCount = 120) {
  const agent = {
    id: "chief",
    provider: "codex" as const,
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium" as const,
    threadId: "thread-chief",
    workspacePath: "/tmp/fixture-chief",
    preview: "",
    updatedAt: at(0),
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
  database.replaceAgents("fixture-agents", [agent], "agents.updated");
  const pending = queuedDelivery("input", "Keep this input", 1, {
    createdAt: at(inputSeconds),
    attachments: [attachment("file", "input.pdf", "pdf")],
  });
  const input = message("input", inputSeconds, { author: "user", delivery: pending, attachments: pending.attachments });
  const replies = Array.from({ length: split ? replyCount : 50 }, (_, index) =>
    message(`reply-${index}`, 2, { turnId: "current" }),
  );
  const first = message("first-input", 0, { author: "user", turnId: "current" });
  const history = Array.from({ length: 75 }, (_, index) =>
    message(`history-${index}`, index - 100, { turnId: `past-${index}` }),
  );
  const rows = [...history, first, ...(split ? [] : [input]), ...replies];
  const before = database.persistConversation(snapshot(rows, 0), "fixture.initial", {}, "fixture-initial", "live");
  const initial = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  expect(initial.pageInfo.hasOlder).toBe(true);
  expect(initial.messages).toHaveLength(split ? 100 : 52);
  expect(initial.messages.some((row) => row.id === "input")).toBe(!split);
  if (split) {
    database.appendConversationMessage({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: "current",
      message: input,
      eventType: "fixture.queued",
    });
    rows.push(input);
  }
  return { initial, pending, input, rows, before, agent };
}

describe("current upstream actual page and context membership", () => {
  it.each([
    { seconds: 1, split: false },
    { seconds: 2, split: false },
    { seconds: 3, split: false },
    { seconds: 1, split: true },
    { seconds: 2, split: true },
    { seconds: 3, split: true },
  ])("keeps a queued input at $seconds after coalesced handoff (split: $split)", async ({ seconds, split }) => {
    const { initial, pending, input, rows } = await currentPage(seconds, split);
    const conversation = await mountConversation(initial);
    const paint = installFrames();
    const anchor = conversation.activeMessages().find((row) => row.id === (split ? "reply-119" : "reply-49"));
    expect(conversation.activeMessages().map((row) => row.id)).not.toContain("input");
    const work = queuedDelivery("work", "Current work", null, { status: "running", turnId: "current" });
    emitAgentEvent?.({ type: "queue-changed", snapshot: { agentId: "chief", deliveries: [work, pending] } });
    const running = { ...pending, status: "running" as const, position: null, turnId: "current" };
    const visible = { ...input, turnId: "current", delivery: running };
    database.persistConversationChanges({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: "current",
      changedMessages: [visible],
      eventType: "fixture.reveal",
    });
    const updated = database.readConversation("chief", "thread-chief");
    emitAgentEvent?.({ type: "conversation", snapshot: updated });
    emitAgentEvent?.({ type: "queue-changed", snapshot: { agentId: "chief", deliveries: [work, running] } });
    paint();
    expect(screen.getByRole("status", { name: "Queue members" })).toBeEmptyDOMElement();
    const report = {
      seconds,
      canonicalBefore: initial.messages.map((row) => row.id),
      canonicalAfter: database
        .readConversationPage("chief", "thread-chief", { type: "latest" }, 50)
        .messages.map((row) => row.id),
      snapshot: updated.messages.map((row) => row.id),
      shown: conversation.activeMessages().map((row) => row.id),
    };
    if (process.env.OPENBOT_WINDOW_REPORT)
      await writeFile(`${process.env.OPENBOT_WINDOW_REPORT}-${seconds}-${split}.json`, JSON.stringify(report, null, 2));
    expect(conversation.activeMessages().map((row) => row.id)).toContain("input");
    expect(screen.getByRole("region", { name: "Transcript" })).toHaveTextContent("input.pdf");
    expect(conversation.activeMessages().find((row) => row.id === (split ? "reply-119" : "reply-49"))).toBe(anchor);
    expect(conversation.activeMessages().map((row) => row.id)).not.toContain("history-0");
    const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
    await conversation.applyConversationPage(fresh, "replace", "latest");
    flush();
    expect(conversation.activeMessages().map((row) => row.id)).toContain("input");
    expect(new Set(conversation.activeMessages().map((row) => row.id)).size).toBe(conversation.activeMessages().length);
    expect(database.readConversation("chief", "thread-chief").messages).toHaveLength(rows.length);
  });

  it("keeps an old same-time prefix outside a split canonical page", async () => {
    const { initial } = await currentPage(2, true);
    const conversation = await mountConversation(initial);
    const paint = installFrames();
    const full = database.readConversation("chief", "thread-chief");
    emitAgentEvent?.({ type: "conversation", snapshot: full });
    paint();
    expect(conversation.activeMessages().map((row) => row.id)).not.toContain("first-input");
    expect(conversation.activeMessages().map((row) => row.id)).not.toContain("reply-0");
    expect(conversation.activeMessages().map((row) => row.id)).not.toContain("input");
    const older = database.readConversationPage(
      "chief",
      "thread-chief",
      { type: "before", cursor: initial.pageInfo.olderCursor ?? "" },
      50,
    );
    expect(older.messages.map((row) => row.id)).toContain("first-input");
    expect(older.messages.every((row) => !initial.messages.some((loaded) => loaded.id === row.id))).toBe(true);
  });
});

it("recovers an early queued reveal from a cold current canonical split page", async () => {
  const { initial, input, pending } = await currentPage(1, true);
  const visible = {
    ...input,
    turnId: "current",
    delivery: { ...pending, status: "running" as const, position: null, turnId: "current" },
  };
  database.persistConversationChanges({
    agentId: "chief",
    threadId: "thread-chief",
    activeTurnId: "current",
    changedMessages: [visible],
    eventType: "fixture.reveal",
  });
  const cold = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  expect(cold.messages).toHaveLength(100);
  expect(cold.pageInfo.hasOlder).toBe(true);
  expect(cold.messages.map((row) => row.id)).not.toContain("input");
  const conversation = await mountConversation(cold);
  expect(conversation.activeMessages().map((row) => row.id)).toContain("input");
  expect(conversation.activeMessages().map((row) => row.id)).not.toContain("first-input");
  expect(initial.pageInfo.olderCursor).not.toBeNull();
});

it("holds a real around page through a marked current-turn reveal and an old revision", async () => {
  const { initial, input, pending } = await currentPage(1, true);
  const conversation = await mountConversation(initial);
  const around = database.readConversationPage(
    "chief",
    "thread-chief",
    { type: "around", messageId: "history-25" },
    10,
  );
  await conversation.applyConversationPage(around, "replace", "around");
  flush();
  const ids = conversation.activeMessages().map((row) => row.id);
  const anchor = conversation.activeMessages()[0];
  const paint = installFrames();
  const visible = {
    ...input,
    turnId: "current",
    delivery: { ...pending, status: "running" as const, position: null, turnId: "current" },
  };
  database.persistConversationChanges({
    agentId: "chief",
    threadId: "thread-chief",
    activeTurnId: "current",
    changedMessages: [visible],
    eventType: "fixture.reveal",
  });
  emitAgentEvent?.({ type: "conversation", snapshot: database.readConversation("chief", "thread-chief") });
  paint();
  expect(conversation.activeMessages().map((row) => row.id)).toEqual(ids);
  expect(conversation.activeMessages()[0]).toBe(anchor);
  await conversation.applyConversationPage(initial, "replace", "latest");
  flush();
  expect(conversation.activeMessages().map((row) => row.id)).toEqual(ids);
});

it.each([false, true])(
  "keeps inactive same-cohort history at fifty rows and retains a reveal across reopen (coalesced: %s)",
  async (coalesced) => {
    let agents: ReturnType<typeof useAgents> | undefined;
    const conversation = await mountConversation(page([message("reply", 2)]), (value) => {
      agents = value;
    });
    const rows = Array.from({ length: 120 }, (_, index) =>
      message(`row-${index}`, 2 + index / 1000, { visibilityEpoch: 10, visibilityKind: "created" }),
    );
    const paint = installFrames();
    emitAgentEvent?.({
      type: "conversation",
      snapshot: { ...snapshot(rows, 10), agentId: "sales-outbound", window: { removedMessageIds: [] } },
    });
    paint();
    expect(conversation.conversations["sales-outbound"]?.messages.map((row) => row.id)).toEqual(
      rows.slice(-50).map((row) => row.id),
    );
    expect(conversation.conversations["sales-outbound"]?.visibilityFloor).toBe(10);
    const input = message("input", 1, { author: "user", visibilityEpoch: 10, visibilityKind: "revealed" });
    if (coalesced)
      emitAgentEvent?.({
        type: "conversation",
        snapshot: { ...snapshot([input, ...rows], 10), agentId: "sales-outbound", window: { removedMessageIds: [] } },
      });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: { ...snapshot([input, ...rows], 11), agentId: "sales-outbound", window: { removedMessageIds: [] } },
    });
    paint();
    expect(conversation.conversations["sales-outbound"]?.messages).toHaveLength(50);
    expect(conversation.conversations["sales-outbound"]?.messages.some((row) => row.id === "input")).toBe(true);
    const reopened = {
      ...page(rows.slice(-50), 11),
      agentId: "sales-outbound",
      windowMembers: { messages: [input], visibilityFloor: 10 },
      messageOrder: [input, ...rows.slice(-50)].map(
        (message, index): ConversationMessageOrder => ({
          id: message.id,
          key: [at(0), 0, "fixture-group", 4, at(index), index, message.id],
        }),
      ),
    };
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(reopened);
    assert(agents);
    agents.setActiveAgentId("sales-outbound");
    flush();
    await waitFor(() => expect(conversation.activeMessages()).toHaveLength(51));
    expect(conversation.activeMessages().map((row) => row.id)).toEqual([
      "input",
      ...rows.slice(-50).map((row) => row.id),
    ]);
    expect(conversation.conversations["sales-outbound"]?.visibilityFloor).toBe(10);
  },
);

it.each([false, true])(
  "preserves canonical split-turn order with a later steer and supplemental=%s",
  async (withSupplement) => {
    const rows = [
      message("initial-input", 0, { author: "user", turnId: "current" }),
      message("first-steer", 5, { author: "user", turnId: "current" }),
      ...Array.from({ length: 120 }, (_, index) =>
        message(`chronological-reply-${index}`, index + 10, { turnId: "current" }),
      ),
      message("later-steer", 75.5, { author: "user", turnId: "current" }),
    ];
    await currentPage(3, true);
    const reveal = message("other-turn-reveal", -20, {
      author: "user",
      turnId: "other-turn",
      delivery: queuedDelivery("other-turn-reveal", "other-turn-reveal", 1),
    });
    database.persistConversation(
      snapshot(withSupplement ? [reveal, ...rows] : rows, 0),
      "fixture.order",
      {},
      "fixture-order",
      "live",
    );
    assert(reveal.delivery);
    if (withSupplement)
      database.persistConversationChanges({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "current",
        changedMessages: [{ ...reveal, delivery: { ...reveal.delivery, status: "completed", position: null } }],
        eventType: "fixture.reveal",
      });
    const canonical = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
    const expected = canonical.messages.map((row) => row.id);
    expect(canonical.messages).toHaveLength(100);
    expect(canonical.pageInfo.hasOlder).toBe(true);
    expect(expected).not.toContain("initial-input");
    expect(expected).not.toContain("first-steer");
    expect(expected.indexOf("later-steer")).toBeGreaterThan(0);
    const conversation = await mountConversation(canonical);
    const shown = () => conversation.activeMessages().map((row) => row.id);
    const canonicalIds = new Set(expected);
    expect(shown().filter((id) => canonicalIds.has(id))).toEqual(expected);
    expect(shown()).toEqual(withSupplement ? [reveal.id, ...expected] : expected);
    const cursor = canonical.pageInfo.olderCursor;
    assert(cursor);
    const older = database.readConversationPage("chief", "thread-chief", { type: "before", cursor }, 50);
    const olderExpected = older.messages.map((row) => row.id);
    await conversation.applyConversationPage(older, "older");
    flush();
    expect(shown().filter((id) => canonicalIds.has(id))).toEqual(expected);
    expect(shown().filter((id) => olderExpected.includes(id))).toEqual(olderExpected);
    await conversation.applyConversationPage(canonical, "latest");
    flush();
    expect(shown().filter((id) => canonicalIds.has(id))).toEqual(expected);
    // A complete host snapshot is already ordered. Cache omission must not sort its partial projection again.
    const full = database.readConversation("chief", "thread-chief");
    const paint = installFrames();
    emitAgentEvent?.({
      type: "conversation",
      snapshot: { ...full, revision: full.revision + 1, window: { removedMessageIds: [] } },
    });
    paint();
    expect(shown().filter((id) => canonicalIds.has(id))).toEqual(expected);
    const around = database.readConversationPage(
      "chief",
      "thread-chief",
      { type: "around", messageId: "chronological-reply-60" },
      10,
    );
    await conversation.applyConversationPage({ ...around, revision: full.revision + 2 }, "replace", "around");
    flush();
    expect(shown()).toEqual(around.messages.map((row) => row.id));
  },
);

it.each([
  { withSupplement: false, observed: false },
  { withSupplement: true, observed: false },
  { withSupplement: false, observed: true },
  { withSupplement: true, observed: true },
])(
  "keeps loaded page order across reveal/latest with supplemental=$withSupplement observed=$observed",
  async ({ withSupplement, observed }) => {
    const { initial, pending, input } = await currentPage(1, true);
    const conversation = await mountConversation(initial);
    assert(initial.pageInfo.olderCursor);
    const older = database.readConversationPage(
      "chief",
      "thread-chief",
      { type: "before", cursor: initial.pageInfo.olderCursor },
      50,
    );
    await conversation.applyConversationPage(older, "older");
    flush();
    expect(conversation.activeMessages().map((row) => row.id)).toContain("reply-0");
    const running = { ...pending, status: "running" as const, position: null, turnId: "current" };
    database.persistConversationChanges({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: "current",
      changedMessages: [{ ...input, turnId: "current", delivery: running }],
      eventType: "fixture.reveal",
    });
    if (withSupplement) {
      const extra = message("other-supplement", -200, {
        author: "user",
        delivery: queuedDelivery("other-supplement", "Supplement", 1),
      });
      database.appendConversationMessage({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "current",
        message: extra,
        eventType: "fixture.hidden",
      });
      assert(extra.delivery);
      database.persistConversationChanges({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "current",
        changedMessages: [{ ...extra, delivery: { ...extra.delivery, status: "completed", position: null } }],
        eventType: "fixture.supplement",
      });
    }
    const full = database.readConversation("chief", "thread-chief");
    if (observed) {
      const paint = installFrames();
      emitAgentEvent?.({ type: "conversation", snapshot: full });
      paint();
    }
    const shownBefore = conversation.activeMessages().map((row) => row.id);
    const shownSet = new Set([...shownBefore, input.id, ...(withSupplement ? ["other-supplement"] : [])]);
    const expected = full.messages.filter((row) => shownSet.has(row.id)).map((row) => row.id);
    if (observed) expect(shownBefore).toEqual(expected);
    const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
    await conversation.applyConversationPage(fresh, "latest");
    flush();
    const shownAfter = conversation.activeMessages().map((row) => row.id);

    expect(shownAfter).toEqual(expected);
    assert(fresh.pageInfo.olderCursor);
    const newerOlder = database.readConversationPage(
      "chief",
      "thread-chief",
      { type: "before", cursor: fresh.pageInfo.olderCursor },
      50,
    );
    await conversation.applyConversationPage(newerOlder, "older");
    flush();
    const afterOlder = conversation.activeMessages().map((row) => row.id);
    const shownIds = new Set(afterOlder);
    expect(afterOlder).toEqual(
      full.messages.filter((row) => shownIds.has(row.id) && row.delivery?.status !== "queued").map((row) => row.id),
    );
  },
);

async function loadedProofView(replyCount = 120, captureScope?: (scope: ProofScope) => void) {
  const fixture = await currentPage(1, true, replyCount);
  const conversation = await mountConversation(fixture.initial, undefined, captureScope);
  let cursor = fixture.initial.pageInfo.olderCursor;
  while (cursor) {
    const older = database.readConversationPage("chief", "thread-chief", { type: "before", cursor }, 50);
    expect(await conversation.applyConversationPage(older, "older")).toBe(true);
    cursor = older.pageInfo.olderCursor;
  }
  flush();
  const visible = {
    ...fixture.input,
    turnId: "current",
    delivery: { ...fixture.pending, status: "running" as const, position: null, turnId: "current" },
  };
  database.persistConversationChanges({
    agentId: "chief",
    threadId: "thread-chief",
    activeTurnId: "current",
    changedMessages: [visible],
    eventType: "fixture.proof-reveal",
  });
  const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  return { ...fixture, conversation, fresh };
}

it("proves every identity in a loaded view above two hundred without dropping history or promoting quote references", async () => {
  const { conversation, fresh } = await loadedProofView(601);
  const old = conversation.activeMessages();
  const anchor = old.find((row) => row.id === "reply-0");
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockClear();
  const referenced = message("reference-only", -500, { turnId: "quote" });
  expect(
    await conversation.applyConversationPage({ ...fresh, references: { [referenced.id]: referenced } }, "latest"),
  ).toBe(true);
  flush();
  const shown = conversation.activeMessages();
  expect(shown.map((row) => row.id)).toEqual(
    database
      .readConversation("chief", "thread-chief")
      .messages.filter((row) => row.delivery?.status !== "queued")
      .map((row) => row.id),
  );
  expect(shown.find((row) => row.id === anchor?.id)).toBe(anchor);
  expect(shown).toHaveLength(old.length + 1);
  const requests = read.mock.calls.map(([input]) => input.orderProof);
  expect(requests).toHaveLength(4);
  expect(requests.every((proof) => proof && proof.messageIds.length <= 200)).toBe(true);
  expect(new Set(requests.flatMap((proof) => proof?.messageIds ?? [])).size).toBe(shown.length);
  expect(requests.some((proof) => proof?.messageIds.includes(referenced.id))).toBe(false);
});

it.each(["missing", "foreign", "stale", "legacy"])(
  "keeps the complete view and object identities when %s proof cannot establish order",
  async (kind) => {
    const { conversation, fresh } = await loadedProofView(250);
    const old = conversation.activeMessages();
    const read = vi.mocked(window.openbot.agent.readConversationPage);
    read.mockClear();
    read.mockImplementation(async (input) => {
      assert(input.orderProof);
      const reply = database.readConversationOrderProof(input.agentId, fresh.threadId, input.orderProof);
      assert(reply.orderProof);
      if (kind === "legacy") return { ...fresh, messageOrder: undefined };
      if (kind === "foreign") return { ...reply, orderProof: { ...reply.orderProof, threadId: "foreign" } };
      if (kind === "stale")
        return {
          ...reply,
          revision: reply.revision + 1,
          orderProof: { ...reply.orderProof, revision: reply.revision + 1 },
        };
      const entries = reply.orderProof.entries.map((entry, index) =>
        index === 0 ? { id: entry.id, order: null } : entry,
      );
      return { ...reply, orderProof: { ...reply.orderProof, entries } };
    });
    expect(await conversation.applyConversationPage(fresh, "latest")).toBe(false);
    flush();
    expect(conversation.activeMessages().slice(0, old.length)).toEqual(old);
    expect(old.every((row, index) => conversation.conversations.chief?.messages[index] === row)).toBe(true);
    expect(conversation.conversations.chief?.revision).toBeLessThan(fresh.revision);
    expect(read.mock.calls.filter(([input]) => input.orderProof)).toHaveLength(1);
  },
);

it.each(["event", "delete", "page", "remove", "account", "scope", "cancel"])(
  "invalidates all proof batches on a new %s while live bodies continue",
  async (kind) => {
    let scope: ProofScope | undefined;
    const { conversation, fresh } = await loadedProofView(250, (value) => {
      scope = value;
    });
    assert(scope);
    let resolve: ((value: ConversationPage) => void) | undefined;
    let request: Parameters<typeof window.openbot.agent.readConversationPage>[0] | undefined;
    const read = vi.mocked(window.openbot.agent.readConversationPage);
    read.mockClear();
    read.mockImplementation((input) => {
      if (!input.orderProof) return Promise.resolve(fresh);
      request = input;
      return new Promise<ConversationPage>((done) => {
        resolve = done;
      });
    });
    const operation = conversation.applyConversationPage(fresh, "latest");
    await waitFor(() => expect(resolve).toBeDefined());
    assert(resolve);
    assert(request?.orderProof);
    const proof = database.readConversationOrderProof("chief", fresh.threadId, request.orderProof);
    const old = conversation.conversations.chief?.messages;
    if (kind === "event") {
      const changed = message("reply-249", 2, { turnId: "current", text: "Updated live body" });
      database.persistConversationChanges({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "current",
        changedMessages: [changed],
        eventType: "fixture.live",
      });
      const paint = installFrames();
      emitAgentEvent?.({ type: "conversation", snapshot: database.readConversation("chief", "thread-chief") });
      paint();
      expect(conversation.activeMessages().find((row) => row.id === changed.id)?.body).toBe(changed.text);
    } else if (kind === "delete") {
      const full = database.readConversation("chief", "thread-chief");
      database.persistConversation(
        { ...full, messages: full.messages.filter((row) => row.id !== "reply-249") },
        "fixture.delete",
        {},
        "fixture-delete",
        "live",
      );
      const paint = installFrames();
      emitAgentEvent?.({
        type: "conversation",
        snapshot: {
          ...database.readConversation("chief", "thread-chief"),
          window: { removedMessageIds: ["reply-249"] },
        },
      });
      paint();
      expect(conversation.activeMessages().some((row) => row.id === "reply-249")).toBe(false);
    } else if (kind === "page") {
      await conversation.applyConversationPage(fresh, "replace", "around");
    } else if (kind === "remove") conversation.removeConversation("chief");
    else if (kind === "scope") emitServers?.([testServer("local", false), testServer("remote-1", true)]);
    else if (kind === "account")
      emitAuth?.({
        status: "signed_in",
        user: { id: "other-account", email: "other@example.com", name: null, avatarUrl: null },
      });
    else scope.turns.setActiveTurns((current) => ({ ...current, chief: null }));
    flush();
    const current = conversation.conversations.chief?.messages;
    resolve(proof);
    expect(await operation).toBe(false);
    flush();
    expect(conversation.conversations.chief?.messages).toBe(current);
    if (kind === "account" || kind === "cancel") expect(current).toBe(old);
    expect(read.mock.calls.filter(([input]) => input.orderProof)).toHaveLength(1);
  },
);

it("refuses a proof plan that cannot fit actual page and reference bytes, preserving the view and allowing a later visible read", async () => {
  const { conversation, fresh } = await loadedProofView();
  const previous = conversation.conversations.chief?.messages;
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockClear();
  const large = message("large-reference", -300, { text: "é".repeat(4 * 1024 * 1024) });
  expect(await conversation.applyConversationPage({ ...fresh, references: { [large.id]: large } }, "latest")).toBe(
    false,
  );
  expect(conversation.conversations.chief?.messages).toBe(previous);
  expect(read).not.toHaveBeenCalled();
  expect(await conversation.applyConversationPage(fresh, "latest")).toBe(true);
  flush();
  expect(conversation.activeMessages().some((row) => row.id === "input")).toBe(true);
});

it("does not reuse first-batch keys after a full writer reindexes between batches, and recovers on the next explicit read", async () => {
  const { conversation, fresh } = await loadedProofView(250);
  const old = conversation.conversations.chief?.messages;
  let calls = 0;
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockClear();
  read.mockImplementation(async (input) => {
    assert(input.orderProof);
    if (++calls === 2) {
      const full = database.readConversation("chief", "thread-chief");
      const rows = [...full.messages].reverse();
      database.persistConversation({ ...full, messages: rows }, "fixture.reindex", {}, "fixture-reindex", "live");
    }
    return database.readConversationOrderProof(input.agentId, fresh.threadId, input.orderProof);
  });
  expect(await conversation.applyConversationPage(fresh, "latest")).toBe(false);
  expect(conversation.conversations.chief?.messages).toBe(old);
  expect(calls).toBe(2);
  const latest = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  expect(await conversation.applyConversationPage(latest, "latest")).toBe(true);
  flush();
  const ids = new Set(conversation.conversations.chief?.messages.map((row) => row.id));
  expect(conversation.conversations.chief?.messages.map((row) => row.id)).toEqual(
    database
      .readConversation("chief", "thread-chief")
      .messages.filter((row) => ids.has(row.id))
      .map((row) => row.id),
  );
});

it("does not query proofs on a hot streaming delta, and accepts an oversized active body without trimming loaded history", async () => {
  const { conversation, fresh } = await loadedProofView();
  const active = message("reply-119", 2, { text: "x".repeat(8 * 1024 * 1024), status: "streaming", turnId: "current" });
  database.persistConversationChanges({
    agentId: "chief",
    threadId: "thread-chief",
    activeTurnId: "current",
    changedMessages: [active],
    eventType: "fixture.active-body",
  });
  const latest = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockClear();
  expect(await conversation.applyConversationPage(latest, "latest")).toBe(true);
  flush();
  expect(conversation.activeMessages().find((row) => row.id === active.id)?.body).toBe(active.text);
  const previousLength = conversation.conversations.chief?.messages.length;
  read.mockClear();
  const prepares = vi.spyOn(database.connection, "prepare");
  emitAgentEvent?.({
    type: "conversation-delta",
    agentId: "chief",
    revision: latest.revision + 1,
    threadId: "thread-chief",
    turnId: "current",
    createdAt: active.createdAt,
    messageId: active.id,
    delta: "!",
  });
  flush();
  expect(conversation.activeMessages().find((row) => row.id === active.id)?.body).toBe(`${active.text}!`);
  expect(conversation.conversations.chief?.messages).toHaveLength(previousLength ?? 0);
  expect(read).not.toHaveBeenCalled();
  expect(prepares).not.toHaveBeenCalled();
  expect(fresh.threadId).toBe(latest.threadId);
});

async function cacheQuoteBodies(conversation: ReturnType<typeof useConversation>, agent: AgentSummary) {
  const cachedAgents = Array.from({ length: 8 }, (_, index) => ({
    ...agent,
    id: `cached-${index}`,
    threadId: `cached-thread-${index}`,
  }));
  database.replaceAgents("fixture.cache-agents", [agent, ...cachedAgents], "fixture.cache-agents");
  for (const other of cachedAgents) {
    const quote = message(`quote-${other.id}`, -200, { turnId: "old", text: "x".repeat(7.5 * 1024 * 1024) });
    const rows = [
      quote,
      ...Array.from({ length: 110 }, (_, index) =>
        message(`${other.id}-reply-${index}`, index, { turnId: "cache", replyToMessageId: quote.id }),
      ),
    ];
    database.persistConversation(
      { agentId: other.id, threadId: other.threadId, activeTurnId: null, revision: 0, messages: rows },
      "fixture.cache",
      {},
      `fixture-${other.id}`,
      "live",
    );
    const cached = database.readConversationPage(other.id, other.threadId, { type: "latest" }, 50);
    expect(cached.references[quote.id]?.text).toBe(quote.text);
    await conversation.applyConversationPage(cached, "replace", "latest");
    expect(conversation.conversations[other.id]?.references?.[quote.id]?.body).toBe(quote.text);
  }
  return cachedAgents;
}

it("accounts actual cached quote bodies in the shared sixty-four MiB proof budget without evicting any loaded view", async () => {
  const { conversation, fresh, agent } = await loadedProofView();
  const old = conversation.conversations.chief?.messages;
  const cachedAgents = await cacheQuoteBodies(conversation, agent);
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockClear();
  const extra = message("pending-quote", -300, { text: "x".repeat(5 * 1024 * 1024) });
  expect(await conversation.applyConversationPage({ ...fresh, references: { [extra.id]: extra } }, "latest")).toBe(
    false,
  );
  expect(conversation.conversations.chief?.messages).toBe(old);
  expect(read).not.toHaveBeenCalled();
  expect(
    cachedAgents.every((other) =>
      Object.values(conversation.conversations[other.id]?.references ?? {}).some(
        (row) => row.body.length === 7.5 * 1024 * 1024,
      ),
    ),
  ).toBe(true);
});

it("uses fresh host keys after a streaming writer changes a loaded row turn, role, time and ordinal without a complete event", async () => {
  const { conversation } = await loadedProofView(250);
  const changed = message("reply-0", -150, { author: "user", turnId: "other-turn", text: "Updated ownership" });
  const full = database.readConversation("chief", "thread-chief");
  database.persistStreamingMessage({
    snapshot: { ...full, messages: [changed, ...full.messages.filter((row) => row.id !== changed.id)] },
    messageId: changed.id,
    eventType: "fixture.streaming-reindex",
  });
  const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  expect(await conversation.applyConversationPage(fresh, "latest")).toBe(true);
  flush();
  const shown = conversation.conversations.chief?.messages.map((row) => row.id) ?? [];
  const ids = new Set(shown);
  const expected = database.connection
    .prepare(`${ORDERED_THREAD_MESSAGES} SELECT message_id FROM ordered ORDER BY ${ORDER_KEY_COLUMNS}`)
    .all("thread-chief")
    .flatMap((row) => (typeof row.message_id === "string" && ids.has(row.message_id) ? [row.message_id] : []));
  expect(shown).toEqual(expected);
  expect(shown.indexOf(changed.id)).toBe(0);
});

it("keeps a disposed owner cached-body reservation until its outstanding proof settles", async () => {
  const { conversation, agent } = await loadedProofView();
  await cacheQuoteBodies(conversation, agent);
  const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  let resolve: ((page: ConversationPage) => void) | undefined;
  let request: Parameters<typeof window.openbot.agent.readConversationPage>[0] | undefined;
  read.mockImplementation((input) => {
    request = input;
    return new Promise<ConversationPage>((done) => {
      resolve = done;
    });
  });
  const oldOperation = conversation.applyConversationPage(fresh, "latest");
  await waitFor(() => expect(resolve).toBeDefined());
  assert(resolve);
  assert(request?.orderProof);
  const result = database.readConversationOrderProof("chief", fresh.threadId, request.orderProof);
  cleanup();
  let newAgents: ReturnType<typeof useAgents> | undefined;
  const newConversation = await mountConversation(fresh, (agents) => {
    newAgents = agents;
  });
  await waitFor(() => expect(newAgents?.activeAgentId()).toBe("chief"));
  flush();
  const old = newConversation.conversations.chief?.messages;
  const quote = message("new-pending-quote", -300, { text: "x".repeat(5 * 1024 * 1024) });
  read.mockClear();
  expect(await newConversation.applyConversationPage({ ...fresh, references: { [quote.id]: quote } }, "latest")).toBe(
    false,
  );
  expect(read).not.toHaveBeenCalled();
  expect(newConversation.conversations.chief?.messages).toBe(old);
  resolve(result);
  expect(await oldOperation).toBe(false);
  const retry = await newConversation.applyConversationPage({ ...fresh, references: { [quote.id]: quote } }, "latest");
  expect(retry).toBe(true);
  expect(read).toHaveBeenCalled();
});

it.each(["disposed", "live"] as const)(
  "charges growth of a %s pending owner cache before admitting another live owner",
  async (kind) => {
    const { conversation, agent } = await loadedProofView();
    const fresh = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
    const read = vi.mocked(window.openbot.agent.readConversationPage);
    let resolve: ((page: ConversationPage) => void) | undefined;
    let request: Parameters<typeof window.openbot.agent.readConversationPage>[0] | undefined;
    read.mockImplementation((input) => {
      request = input;
      return new Promise<ConversationPage>((done) => {
        resolve = done;
      });
    });
    const oldOperation = conversation.applyConversationPage(fresh, "latest");
    await waitFor(() => expect(resolve).toBeDefined());
    assert(resolve);
    assert(request?.orderProof);
    const result = database.readConversationOrderProof("chief", fresh.threadId, request.orderProof);
    const retained = await cacheQuoteBodies(conversation, agent);
    const retainedBytes = () =>
      retained.reduce(
        (total, other) =>
          total +
          Object.values(conversation.conversations[other.id]?.references ?? {}).reduce(
            (bytes, row) => bytes + new TextEncoder().encode(row.body).byteLength,
            0,
          ),
        0,
      );
    expect(retainedBytes()).toBe(60 * 1024 * 1024);
    const latest = database.readConversationPage("chief", "thread-chief", { type: "latest" }, 50);
    try {
      if (kind === "disposed") cleanup();
      let newAgents: ReturnType<typeof useAgents> | undefined;
      const next = await mountConversation(latest, (agents) => {
        newAgents = agents;
      });
      await waitFor(() => expect(newAgents?.activeAgentId()).toBe("chief"));
      flush();
      const before = next.conversations.chief?.messages;
      const quote = message("growth-owner-quote", -300, { text: "x".repeat(5 * 1024 * 1024) });
      read.mockClear();
      expect(await next.applyConversationPage({ ...latest, references: { [quote.id]: quote } }, "latest")).toBe(false);
      expect(read).not.toHaveBeenCalled();
      expect(next.conversations.chief?.messages).toBe(before);
      expect(retainedBytes()).toBe(60 * 1024 * 1024);
    } finally {
      resolve(result);
      expect(await oldOperation).toBe(kind === "live");
    }
  },
);

it("preserves remote reconnect loading, failure and explicit retry without applying an older response", async () => {
  const local = testServer("local", false);
  const remote = { ...testServer("remote-1", true), connectionSequence: 1 };
  vi.mocked(window.openbot.servers.list).mockResolvedValue([local, remote]);
  const requests: Array<ReturnType<typeof Promise.withResolvers<ConversationPage>>> = [];
  const read = vi.mocked(window.openbot.agent.readConversationPage);
  read.mockImplementation(() => {
    const request = Promise.withResolvers<ConversationPage>();
    requests.push(request);
    return request.promise;
  });
  let conversation: ReturnType<typeof useConversation> | undefined;
  render(() => (
    <AppProviders>
      <TranscriptProbe
        capture={(value) => {
          conversation = value;
        }}
      />
    </AppProviders>
  ));
  await waitFor(() => expect(requests).toHaveLength(1));
  assert(conversation);
  expect(conversation.conversations.chief?.loading).toBe(true);
  requests[0]?.reject(new Error("Controlled connection loss"));
  await waitFor(() => expect(conversation?.conversations.chief?.loadError).toBeTruthy());
  expect(conversation.conversations.chief?.loading).toBe(false);
  conversation.retryConversation();
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(conversation.conversations.chief?.loadError).toBeNull();
  expect(conversation.conversations.chief?.loading).toBe(true);
  emitServers?.([local, { ...remote, connectionSequence: 2 }]);
  await waitFor(() => expect(requests).toHaveLength(3));
  requests[2]?.resolve(page([message("new-response", 3)], 3));
  await waitFor(() => expect(conversation?.activeMessages().map((row) => row.id)).toEqual(["new-response"]));
  expect(conversation.conversations.chief?.loading).toBe(false);
  requests[1]?.resolve(page([message("old-response", 2)], 2));
  await requests[1]?.promise;
  flush();
  expect(conversation.activeMessages().map((row) => row.id)).toEqual(["new-response"]);
  expect(read.mock.calls.every(([input, serverId]) => !input.orderProof && serverId === "remote-1")).toBe(true);
});
