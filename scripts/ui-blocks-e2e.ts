// Runs `ask_ui` blocks end to end on the real modules: the real `AttentionRegistry` answers each block as
// the desktop, a team member and a released client do, and the real Team API codecs carry the stored
// conversation as a host sends it to each kind of client. No provider or account is used.
// `bun scripts/ui-blocks-e2e.ts`. Writes .openbot-build/ui-blocks-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AgentEvent,
  type ConversationMessage,
  type ConversationPage,
  type ConversationSnapshot,
  isConversationMessage,
} from "@openbot/contracts/ipc";
import {
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_UI_BLOCKS_CAPABILITY,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import {
  addUiBlockAutoAnswers,
  TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY,
  withUiBlockAutoAnswers,
} from "@openbot/contracts/team-protocol/ui-block-auto-answer-v1";
import {
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v6-adapter";
import {
  decodeTeamProtocolV7CurrentHttpResponse,
  encodeTeamProtocolV7CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v7-adapter";
import {
  decodeTeamProtocolV7BaseCurrentEvent,
  encodeTeamProtocolV7BaseCurrentEvent,
} from "@openbot/contracts/team-protocol/v7-base-adapter";
import {
  type ConversationUiBlock,
  normalizeUiBlockSpec,
  type UiBlockResponse,
  type UiBlockSpec,
  type UiBlockValue,
  uiBlockAnswersFromResponse,
} from "@openbot/contracts/ui-blocks";
import { Effect } from "effect";
import { AttentionRegistry, type PromptResponder } from "../src/backend/agent/attention-registry";
import { ForbiddenAttentionAnswer } from "../src/backend/agent/inactive-attention-request";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { RequestId } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/ui-blocks-e2e");
const PAGE_PATH = "/v1/agents/agent-1/conversation-page";
const THREAD = "thread-1";
const SECRET = "e2e-secret-4be1c0";
const OWNER = undefined;
const MEMBER: PromptResponder = { sender: { id: "member-1", name: "Mia" }, privileged: false };
const ADMIN: PromptResponder = { sender: { id: "admin-1", name: "Ada" }, privileged: true };

/** The JSON of the `ask_ui` tool result, as `uiBlockPromptResult` writes it. */
interface AgentAnswer {
  status: string;
  blockId: string;
  actionId?: string;
  values?: Record<string, UiBlockValue>;
  text?: string;
  next?: string;
}

/** Records what OpenBot answers to the agent. The process never starts: only the answer is read. */
class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, { success: boolean; value: AgentAnswer | null }>();
  readonly #waiters = new Map<RequestId, () => void>();

  /** Resolves when OpenBot answers the request, so that a host timer is awaited, not slept on. */
  answered(id: RequestId): Promise<void> {
    if (this.answers.has(id)) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.set(id, resolve));
  }

  // A provider that still waits: the registry answers it when the turn ends.
  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    const raw = JSON.stringify(result);
    const parsed: { success?: boolean; contentItems?: Array<{ text?: string }> } = JSON.parse(raw);
    const text = parsed.contentItems?.[0]?.text;
    this.answers.set(id, { success: parsed.success === true, value: text ? JSON.parse(text) : null });
    this.#waiters.get(id)?.();
    this.#waiters.delete(id);
  }
}

const client = new RecordingClient("/nonexistent/codex");
const snapshot: ConversationSnapshot = {
  agentId: "agent-1",
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const events: AgentEvent[] = [];
const errors: string[] = [];
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? "agent-1" : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event) => events.push(event),
  emitError: (code) => {
    errors.push(code);
  },
  emitRuntimeSnapshot: () => {},
});

let nextRequest = 1;

/**
 * Shows a block as the `ask_ui` router does after its checks, and returns its request id and message.
 * `autoAnswer` is what `acknowledge_request` adds: the host presses that action after the delay.
 */
function ask(spec: UiBlockSpec, turnId: string, autoAnswer?: { actionId: string; afterMs: number }) {
  const normalized = normalizeUiBlockSpec(spec);
  assert(normalized, "the router would refuse this spec");
  const id = nextRequest++;
  registry.surfaceUiBlock(
    client,
    { id, method: "item/tool/call", params: { threadId: THREAD, turnId } },
    { blockId: `block-${id}`, spec: normalized },
    autoAnswer,
  );
  const message = snapshot.messages.find((candidate) => candidate.id === `question-prompt:${turnId}:${id}`);
  assert(message?.uiBlock, "the block was not stored");
  assert.equal(message.uiBlock.state.status, "pending");
  return { id, spec: normalized, message };
}

function answer(requestId: number, answers: Record<string, string[]>, responder?: PromptResponder) {
  return runCauseEffect(registry.respondToPrompt({ requestId, answers }, responder));
}

/** What the person answers on a client that knows the block. */
const asNewClient = (spec: UiBlockSpec, response: UiBlockResponse) => uiBlockAnswersFromResponse(spec, response);

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => unknown): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const confirmSpec: UiBlockSpec = {
  type: "confirm",
  title: "Send the report?",
  fields: [
    { label: "To", value: "team@example.com" },
    { label: "From", select: "from", options: ["me@example.com", "ops@example.com"] },
  ],
  actions: [
    { id: "send", label: "Send", style: "primary" },
    { id: "cancel", label: "Cancel" },
  ],
};
const dangerSpec: UiBlockSpec = {
  type: "confirm",
  title: "Delete the archive?",
  actions: [
    { id: "delete", label: "Delete", style: "danger" },
    { id: "keep", label: "Keep" },
  ],
};
const repliesSpec: UiBlockSpec = {
  type: "quick_replies",
  title: "When?",
  options: [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
  ],
};
const formSpec: UiBlockSpec = {
  type: "form",
  title: "Connect the service",
  fields: [
    // A field id that the Team API key swap would rename, if the block went through it.
    { id: "agentId", kind: "text", label: "Agent" },
    { id: "token", kind: "text", label: "Token", secret: true },
  ],
};

// The plan card that `acknowledge_request` builds.
const planSpec: UiBlockSpec = {
  type: "confirm",
  title: "On it. This is my plan.",
  fields: [
    { label: "First", value: "Read the logs" },
    { label: "Then", value: "Fix the cause" },
  ],
  actions: [
    { id: "start", label: "Start", style: "primary" },
    { id: "alternative", label: "Only find the cause" },
    { id: "cancel", label: "Cancel", style: "ghost" },
  ],
};
const AUTO_START = { actionId: "start", afterMs: 50 };

const hasUiBlock = (json: string) => json.includes('"uiBlock"');

/** A block as `ui-blocks-v1` carries it: the host's auto-answer state stays on the host. */
function onV1Wire(block: ConversationUiBlock | undefined): ConversationUiBlock | undefined {
  if (!block) return block;
  const { autoAnswer: _autoAnswer, ...state } = block.state;
  return { ...block, state };
}

function page(messages: ConversationMessage[], references: Record<string, ConversationMessage> = {}): ConversationPage {
  return {
    agentId: "agent-1",
    threadId: THREAD,
    activeTurnId: null,
    revision: snapshot.revision,
    messages: structuredClone(messages),
    references: structuredClone(references),
    pageInfo: { hasOlder: false, olderCursor: null },
  };
}

function withoutBlocks(value: ConversationPage): ConversationPage {
  const strip = (message: ConversationMessage): ConversationMessage => {
    const { uiBlock: _uiBlock, ...rest } = message;
    return rest;
  };
  return {
    ...value,
    messages: value.messages.map(strip),
    references: Object.fromEntries(Object.entries(value.references).map(([id, message]) => [id, strip(message)])),
  };
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  await step("capability: current clients advertise it, bootstrap and protocol 6 do not", () => {
    assert.ok(TEAM_CURRENT_CAPABILITIES.includes(TEAM_UI_BLOCKS_CAPABILITY));
    assert.ok(!new Set<string>(TEAM_BOOTSTRAP_CAPABILITIES).has(TEAM_UI_BLOCKS_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(6).includes(TEAM_UI_BLOCKS_CAPABILITY));
    assert.ok(teamCapabilitiesForProtocol(7).includes(TEAM_UI_BLOCKS_CAPABILITY));
  });

  // Answers on the host.
  await step("owner on a new client presses Send with a sender address", async () => {
    const { id, spec, message } = ask(confirmSpec, "turn-1");
    await answer(id, asNewClient(spec, { actionId: "send", values: { from: "ops@example.com" } }), OWNER);
    const sent = client.answers.get(id);
    assert.equal(sent?.success, true);
    assert.deepEqual(sent?.value, {
      status: "answered",
      blockId: `block-${id}`,
      actionId: "send",
      values: { from: "ops@example.com" },
    });
    assert.equal(message.uiBlock?.state.status, "answered");
    assert.deepEqual(message.uiBlock?.state.response, { actionId: "send", values: { from: "ops@example.com" } });
    assert.equal(message.questionPrompt?.resolution?.status, "answered");
    return { agentGot: sent?.value, stored: message.uiBlock?.state };
  });

  await step("member on a released client answers the fallback question by its label", async () => {
    const { id, message } = ask(repliesSpec, "turn-2");
    assert.deepEqual(
      message.questionPrompt?.questions.map((question) => question.options?.map((option) => option.label)),
      [["Today", "Tomorrow"]],
    );
    await answer(id, { reply: ["Tomorrow"] }, MEMBER);
    assert.deepEqual(client.answers.get(id)?.value, {
      status: "answered",
      blockId: `block-${id}`,
      actionId: "tomorrow",
    });
    assert.deepEqual(message.uiBlock?.state.respondedBy, MEMBER.sender);
    return message.uiBlock?.state;
  });

  await step("member cannot press a danger action or answer it in words; an admin can", async () => {
    const { id, spec, message } = ask(dangerSpec, "turn-3");
    const refused = async (answers: Record<string, string[]>) => {
      const error = await answer(id, answers, MEMBER).then(
        () => null,
        (cause: unknown) => cause,
      );
      assert.ok(error instanceof ForbiddenAttentionAnswer, `expected a refusal, got ${String(error)}`);
      assert.equal(client.answers.has(id), false, "the agent got an answer");
      assert.equal(message.uiBlock?.state.status, "pending", "the block closed");
    };
    await refused(asNewClient(spec, { actionId: "delete" }));
    await refused({ action: ["Delete"] });
    await refused({ action: ["yes, delete it"] });
    await answer(id, asNewClient(spec, { actionId: "delete" }), ADMIN);
    assert.equal(client.answers.get(id)?.value?.actionId, "delete");
    assert.deepEqual(message.uiBlock?.state.respondedBy, ADMIN.sender);
    return message.uiBlock?.state;
  });

  await step("member may take the safe action of a block with a danger action", async () => {
    const { id, spec } = ask(dangerSpec, "turn-4");
    await answer(id, asNewClient(spec, { actionId: "keep" }), MEMBER);
    assert.equal(client.answers.get(id)?.value?.actionId, "keep");
  });

  let secretMessage: ConversationMessage | undefined;
  await step("a secret form value reaches the agent and is never stored", async () => {
    const { id, spec, message } = ask(formSpec, "turn-5");
    assert.equal(message.questionPrompt?.questions.find((question) => question.id === "token")?.isSecret, true);
    await answer(id, asNewClient(spec, { actionId: "submit", values: { agentId: "a-7", token: SECRET } }), OWNER);
    assert.deepEqual(client.answers.get(id)?.value, {
      status: "answered",
      blockId: `block-${id}`,
      actionId: "submit",
      values: { agentId: "a-7", token: SECRET },
    });
    assert.equal(message.uiBlock?.state.status, "answered");
    assert.deepEqual(message.uiBlock?.state.response?.values, { agentId: "a-7" });
    assert.ok(!JSON.stringify(snapshot).includes(SECRET), "the secret is in the stored conversation");
    secretMessage = message;
    return message.uiBlock?.state;
  });

  await step("an empty answer skips the block", async () => {
    const { id, message } = ask(repliesSpec, "turn-6");
    await answer(id, {}, MEMBER);
    assert.deepEqual(client.answers.get(id)?.value, { status: "skipped", blockId: `block-${id}` });
    assert.equal(message.uiBlock?.state.status, "closed");
  });

  await step("nobody answers a plan card: the host presses Start after its delay", async () => {
    const { id, message } = ask(planSpec, "turn-8", AUTO_START);
    const pending = message.uiBlock?.state.autoAnswer;
    assert.equal(pending?.actionId, "start");
    assert.ok(pending && Number.isFinite(Date.parse(pending.at)), "the card has no start time");
    assert.equal(pending?.done, undefined);
    await client.answered(id);
    assert.deepEqual(client.answers.get(id)?.value, { status: "answered", blockId: `block-${id}`, actionId: "start" });
    assert.equal(message.uiBlock?.state.status, "answered");
    assert.deepEqual(message.uiBlock?.state.response, { actionId: "start" });
    assert.equal(message.uiBlock?.state.autoAnswer?.done, true);
    return message.uiBlock?.state;
  });

  await step("a person answers a plan card first: the host does not answer it again", async () => {
    const { id, spec, message } = ask(planSpec, "turn-9", AUTO_START);
    await answer(id, asNewClient(spec, { actionId: "cancel" }), OWNER);
    assert.equal(client.answers.get(id)?.value?.actionId, "cancel");
    assert.equal(message.uiBlock?.state.autoAnswer?.done, undefined);
    // A second plan card on a later delay: when the host presses it, the first timer had its turn too.
    const later = ask(planSpec, "turn-10", { actionId: "start", afterMs: AUTO_START.afterMs * 2 });
    await client.answered(later.id);
    assert.equal(client.answers.get(id)?.value?.actionId, "cancel", "the host replaced the person's answer");
    assert.deepEqual(message.uiBlock?.state.response, { actionId: "cancel" });
    return message.uiBlock?.state;
  });

  await step("the turn ends before an answer: the block expires", async () => {
    const { id, message } = ask(repliesSpec, "turn-7");
    registry.clearForTurn(THREAD, "turn-7");
    assert.equal(client.answers.get(id)?.success, false);
    assert.equal(client.answers.get(id)?.value?.status, "expired");
    assert.equal(message.uiBlock?.state.status, "expired");
    const late = await answer(id, { reply: ["Today"] }, OWNER).then(
      () => null,
      (cause: unknown) => cause,
    );
    assert.ok(late instanceof Error, "a late answer was taken");
  });
  assert.deepEqual(errors, [], "the registry reported an error");
  await writeFile(resolve(OUT, "conversation.json"), `${JSON.stringify(snapshot, null, 2)}\n`);

  // The stored conversation on the wire.
  const current = page(snapshot.messages, secretMessage ? { "quoted-1": { ...secretMessage, id: "quoted-1" } } : {});
  const released = withoutBlocks(current);

  await step("protocol 7 without the capability: the bytes of the released projection", () => {
    const encoded = encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, current);
    assert.equal(encoded, encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, released));
    assert.ok(!hasUiBlock(encoded));
    const event = encodeTeamProtocolV7BaseCurrentEvent({ type: "conversation-page", page: current });
    assert.equal(event, encodeTeamProtocolV7BaseCurrentEvent({ type: "conversation-page", page: released }));
    assert.ok(event && !hasUiBlock(event));
    return { bytes: encoded.length };
  });

  await step("protocol 6: the released projection, whatever the client says", () => {
    const encoded = encodeTeamProtocolV6CurrentHttpResponse("GET", PAGE_PATH, 200, current);
    assert.equal(encoded, encodeTeamProtocolV6CurrentHttpResponse("GET", PAGE_PATH, 200, released));
    assert.ok(!hasUiBlock(encoded));
    const decoded = decodeTeamProtocolV6CurrentHttpResponse("GET", PAGE_PATH, 200, JSON.parse(encoded));
    assert.ok(!hasUiBlock(JSON.stringify(decoded)));
  });

  await step("protocol 7 with the capability: page and event carry each block as stored", () => {
    const encoded = encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, current, { uiBlocks: true });
    assert.ok(!encoded.includes(SECRET));
    const decoded = decodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, JSON.parse(encoded));
    assert(decoded && typeof decoded === "object" && !Array.isArray(decoded));
    const messages: unknown[] = Array.isArray(decoded.messages) ? decoded.messages : [];
    assert.equal(messages.length, current.messages.length);
    for (const [index, message] of messages.entries()) {
      assert.ok(isConversationMessage(message), `message ${index} does not decode`);
      assert.deepEqual(message.uiBlock, onV1Wire(current.messages[index]?.uiBlock));
    }
    const references = decoded.references;
    assert(references && typeof references === "object" && !Array.isArray(references));
    const quoted = references["quoted-1"];
    assert.ok(isConversationMessage(quoted));
    assert.deepEqual(quoted.uiBlock?.state.response?.values, { agentId: "a-7" });

    const event = encodeTeamProtocolV7BaseCurrentEvent(
      { type: "conversation-page", page: current },
      { uiBlocks: true },
    );
    assert.ok(event);
    const read = decodeTeamProtocolV7BaseCurrentEvent(JSON.parse(event));
    assert.equal(read.kind, "known");
    assert(read.kind === "known" && read.event.type === "conversation-page");
    assert.deepEqual(
      read.event.page.messages.map((message) => message.uiBlock),
      current.messages.map((message) => onV1Wire(message.uiBlock)),
    );
    assert.deepEqual(read.event.page.references["quoted-1"]?.uiBlock?.state.response?.values, { agentId: "a-7" });
    return { pageBytes: encoded.length, eventBytes: event.length, blocks: messages.length };
  });

  await step("protocol 7 with the capability: the host's auto-answer state stays off the wire", () => {
    assert.ok(
      current.messages.some((message) => message.uiBlock?.state.autoAnswer),
      "no plan card to send",
    );
    const encoded = encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, current, { uiBlocks: true });
    assert.ok(!encoded.includes('"autoAnswer"'));
    const event = encodeTeamProtocolV7BaseCurrentEvent(
      { type: "conversation-page", page: current },
      { uiBlocks: true },
    );
    assert.ok(event && !event.includes('"autoAnswer"'));
  });

  await step("ui-block-auto-answer-v1: a protocol 9 capability only", () => {
    assert.ok(TEAM_CURRENT_CAPABILITIES.includes(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(8).includes(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY));
    assert.ok(teamCapabilitiesForProtocol(9).includes(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY));
  });

  await step("ui-block-auto-answer-v1: page and event carry the host's auto-answer state", () => {
    const encoded = withUiBlockAutoAnswers(
      encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, current, { uiBlocks: true }),
      current,
    );
    assert.ok(!encoded.includes(SECRET));
    // As the team client reads it: the frozen codec leaves the key out, and the client copies it back.
    const wire = JSON.parse(encoded);
    const decoded = decodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, wire);
    assert(decoded && typeof decoded === "object" && !Array.isArray(decoded));
    addUiBlockAutoAnswers(decoded, wire);
    const messages: unknown[] = Array.isArray(decoded.messages) ? decoded.messages : [];
    const autoAnswers = messages.map((message) => {
      assert.ok(isConversationMessage(message));
      return message.uiBlock?.state.autoAnswer;
    });
    assert.deepEqual(
      autoAnswers,
      current.messages.map((message) => message.uiBlock?.state.autoAnswer),
    );
    assert.ok(
      autoAnswers.some((autoAnswer) => autoAnswer?.done === true),
      "no plan card that the host answered",
    );

    const plain = encodeTeamProtocolV7BaseCurrentEvent(
      { type: "conversation-page", page: current },
      { uiBlocks: true },
    );
    assert.ok(plain);
    const event = JSON.parse(withUiBlockAutoAnswers(plain, { type: "conversation-page", page: current }));
    const read = decodeTeamProtocolV7BaseCurrentEvent(event);
    assert(read.kind === "known" && read.event.type === "conversation-page");
    addUiBlockAutoAnswers(read.event, event);
    assert.deepEqual(
      read.event.page.messages.map((message) => message.uiBlock?.state.autoAnswer),
      current.messages.map((message) => message.uiBlock?.state.autoAnswer),
    );
    return { autoAnswers: autoAnswers.filter(Boolean).length };
  });

  await step("ui-block-auto-answer-v1: a body without an automatic answer keeps its bytes", () => {
    const withoutAuto = page(
      current.messages.map((message) =>
        message.uiBlock ? { ...message, uiBlock: onV1Wire(message.uiBlock) } : message,
      ),
    );
    const encoded = encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, withoutAuto, { uiBlocks: true });
    assert.equal(withUiBlockAutoAnswers(encoded, withoutAuto), encoded);
  });

  await step("a malformed block fails closed in both directions", () => {
    const broken = JSON.parse(JSON.stringify(page(snapshot.messages.slice(0, 1))));
    broken.messages[0].uiBlock.version = 99;
    assert.throws(() => encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, broken, { uiBlocks: true }));
    const wire = JSON.parse(
      encodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, current, { uiBlocks: true }),
    );
    wire.messages[0].uiBlock.spec.type = "unknown";
    assert.throws(() => decodeTeamProtocolV7CurrentHttpResponse("GET", PAGE_PATH, 200, wire));
    const event = JSON.parse(
      encodeTeamProtocolV7BaseCurrentEvent({ type: "conversation-page", page: current }, { uiBlocks: true }) ?? "null",
    );
    event.page.messages[0].uiBlock.state.status = "unknown";
    assert.equal(decodeTeamProtocolV7BaseCurrentEvent(event).kind, "invalid");
  });

  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify({ ok: true, steps }, null, 2)}\n`);
  process.stdout.write(`ui-blocks-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`,
  );
  process.stderr.write(`ui-blocks-e2e failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
