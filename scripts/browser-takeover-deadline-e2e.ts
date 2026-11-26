import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, BrowserTab, ConversationSnapshot } from "@openbot/contracts/ipc";
import { type UiBlockSpec, uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { vaultRequestFormSpec } from "../src/backend/agent/prompts";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { browserFailure } from "../src/backend/browser-effects";
import type { PreparedBrowserSecret } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { RequestId } from "../src/backend/protocol";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/browser-takeover-deadline-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const TAB = "tab-1";
const SECRET = "e2e-password-7c41";
const VAULT_SECRET = "e2e-vault-password-93be";
const DEADLINE_MS = 50;
const USER_ANSWER_LIMIT_MS = 200;

interface AgentAnswer {
  status?: string;
  next?: string;
  secureInput?: string;
}

class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, unknown>();
  readonly #waiters = new Map<RequestId, () => void>();

  answered(id: RequestId): Promise<unknown> {
    if (this.answers.has(id)) return Promise.resolve(this.answers.get(id));
    return new Promise((done) => this.#waiters.set(id, () => done(this.answers.get(id))));
  }

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, result);
    this.#waiters.get(id)?.();
    this.#waiters.delete(id);
  }
}

const client = new RecordingClient("/nonexistent/codex");

class NoteClient extends RecordingClient {
  readonly userInputNote = true;
}
const snapshot: ConversationSnapshot = {
  agentId: AGENT,
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const tabs: BrowserTab[] = [
  {
    id: TAB,
    title: "Sign in",
    url: "https://example.test/login",
    loading: false,
    ownerThreadId: THREAD,
    ownerAgentId: AGENT,
  },
];
const events: AgentEvent[] = [];
const browserLog: string[] = [];
const submitted: string[] = [];
let fillFailure: Error | undefined;

function preparedSecret(): PreparedBrowserSecret {
  return {
    request: { method: "password", origin: "https://example.test", digits: 6 },
    agentScriptedOrigin: false,
    vaultFillable: false,
    withCode: false,
    submit: (secret) =>
      fillFailure
        ? Effect.fail(browserFailure(fillFailure))
        : Effect.sync(() => {
            submitted.push(secret);
            return "submitted" as const;
          }),
    cancel: () => {
      browserLog.push("secret-cancelled");
    },
  };
}

const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: {
    listTabs: () => tabs,
    toolCanUseTab: (params, tabId) =>
      tabs.some(
        (candidate) =>
          candidate.id === tabId &&
          candidate.ownerAgentId === params.ownerAgentId &&
          candidate.ownerThreadId === params.threadId,
      ),
    prepareSecret: () => Effect.sync(preparedSecret),
    beginTakeover: (tabId) =>
      Effect.sync(() => {
        browserLog.push(`begin:${tabId}`);
      }),
    endTakeover: (tabId) => {
      browserLog.push(`end:${tabId}`);
    },
  },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
  emit: (event) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
  lateAnswerTarget: () => ({}),
});

let nextRequest = 1;

function call(tool: "submit_secret" | "request_takeover", turnId: string, answerBeforeMs?: number) {
  return callOn(registry, tool, turnId, answerBeforeMs);
}

function callOn(
  target: AttentionRegistry,
  tool: "submit_secret" | "request_takeover",
  turnId: string,
  answerBeforeMs?: number,
) {
  const id = nextRequest++;
  return runCauseEffect(
    target.surfaceBrowserTakeover(client, {
      id,
      method: "item/tool/call",
      params: {
        threadId: THREAD,
        turnId,
        callId: `call-${id}`,
        namespace: "openbot_browser",
        tool,
        arguments: { tabId: TAB },
      },
      ...(answerBeforeMs === undefined ? {} : { answerBeforeMs }),
    }),
  );
}

function answerOf(result: unknown): AgentAnswer & { success: boolean } {
  const parsed: { success?: boolean; contentItems?: Array<{ text?: string }> } = JSON.parse(JSON.stringify(result));
  const text = parsed.contentItems?.[0]?.text ?? "";
  const success = parsed.success === true;
  try {
    const value: AgentAnswer = JSON.parse(text);
    return { success, ...value };
  } catch {
    return { success, next: text };
  }
}

const count = (type: AgentEvent["type"]) => events.filter((event) => event.type === type).length;
const openCards = () => registry.runtimeAttention().pendingBrowserTakeovers;

async function cardShown(before: number): Promise<void> {
  while (count("browser-takeover-requested") === before) await new Promise((done) => setImmediate(done));
}

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  await step("a password card stays open after its call gets the deadline answer", async () => {
    const shown = count("browser-takeover-requested");
    const first = answerOf(await call("submit_secret", "turn-1", DEADLINE_MS));
    assert.equal(first.success, true);
    assert.equal(first.status, "waiting");
    assert.match(first.next ?? "", /Call submit_secret again now with tabId "tab-1"/);
    assert.equal(count("browser-takeover-requested"), shown + 1, "the card was shown once");
    assert.equal(count("browser-takeover-resolved"), 0, "the card was closed");
    assert.equal(openCards().length, 1);
    assert.equal(openCards()[0]?.secret?.method, "password", "the card lost its password form");
    assert(!browserLog.includes("secret-cancelled"), "the password form was cancelled");
    return first;
  });

  await step("the next call waits on the same card, and gets the user's result", async () => {
    const shown = count("browser-takeover-requested");
    const requestId = openCards()[0]?.requestId;
    assert(requestId !== undefined);
    const second = answerOf(await call("submit_secret", "turn-1", DEADLINE_MS));
    assert.equal(second.status, "waiting");
    assert.equal(openCards()[0]?.requestId, requestId);
    const third = call("submit_secret", "turn-1", 60_000);
    await runCauseEffect(
      registry.respondToBrowserSecret({ requestId, agentId: AGENT, decision: "submit", secret: SECRET }),
    );
    const answer = answerOf(await third);
    assert.equal(answer.status, "completed");
    assert.equal(count("browser-takeover-requested"), shown, "the call showed a second card");
    assert.equal(count("browser-takeover-resolved"), 1);
    assert.deepEqual(submitted, [SECRET]);
    assert.equal(openCards().length, 0);
    assert(!JSON.stringify(answer).includes(SECRET), "the agent got the secret");
    return answer;
  });

  await step("a result between two calls waits for the next call", async () => {
    const shown = count("browser-takeover-requested");
    const first = answerOf(await call("request_takeover", "turn-2", DEADLINE_MS));
    assert.equal(first.status, "waiting");
    const requestId = openCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(registry.respondToBrowserTakeover({ requestId, decision: "complete" }));
    assert.equal(openCards().length, 0);
    const next = answerOf(await call("request_takeover", "turn-2", 60_000));
    assert.equal(next.status, "completed");
    assert.equal(count("browser-takeover-requested"), shown + 1, "the next call showed a new card");
    assert.equal(openCards().length, 0);
    return next;
  });

  await step("a result between two calls also reaches a call with the other tool", async () => {
    const shown = count("browser-takeover-requested");
    const first = answerOf(await call("request_takeover", "turn-2b", DEADLINE_MS));
    assert.equal(first.status, "waiting");
    const requestId = openCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(registry.respondToBrowserTakeover({ requestId, decision: "complete" }));
    const next = answerOf(await call("submit_secret", "turn-2b", 60_000));
    assert.equal(next.status, "completed");
    assert.equal(count("browser-takeover-requested"), shown + 1, "the next call showed a new card");
    assert.equal(openCards().length, 0);
    return next;
  });

  await step("the end of the turn closes a waiting card, and a new turn gets a new card", async () => {
    const resolved = count("browser-takeover-resolved");
    const first = answerOf(await call("request_takeover", "turn-3", DEADLINE_MS));
    assert.equal(first.status, "waiting");
    registry.clearForTurn(THREAD, "turn-3", true);
    assert.equal(count("browser-takeover-resolved"), resolved + 1);
    assert.equal(openCards().length, 0);
    const shown = count("browser-takeover-requested");
    const fresh = call("request_takeover", "turn-4");
    await cardShown(shown);
    assert.equal(openCards().length, 1, "the old cancel answered the new turn");
    registry.clearForTurn(THREAD, "turn-4", true);
    return answerOf(await fresh);
  });

  await step("with no deadline the call waits, and a second call for the tab is refused", async () => {
    const shown = count("browser-takeover-requested");
    const waiting = call("request_takeover", "turn-5");
    await cardShown(shown);
    const second = answerOf(await call("request_takeover", "turn-5", DEADLINE_MS));
    assert.equal(second.success, false);
    assert.equal(openCards().length, 1);
    const requestId = openCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(registry.respondToBrowserTakeover({ requestId, decision: "complete" }));
    return { first: answerOf(await waiting), second };
  });

  await step("another tool for a waiting card is refused", async () => {
    const first = answerOf(await call("request_takeover", "turn-6", DEADLINE_MS));
    assert.equal(first.status, "waiting");
    const other = answerOf(await call("submit_secret", "turn-6", DEADLINE_MS));
    assert.equal(other.success, false);
    assert.equal(openCards().length, 1);
    registry.clearForTurn(THREAD, "turn-6", true);
    return other;
  });

  await step("a question detaches before the deadline", async () => {
    const id = nextRequest++;
    registry.surfaceDynamicPrompt(client, {
      id,
      method: "item/tool/call",
      params: {
        threadId: THREAD,
        turnId: "turn-7",
        callId: `call-${id}`,
        namespace: "openbot",
        tool: "ask_user",
        arguments: { questions: [{ id: "q1", header: "Plan", question: "Which plan?" }] },
      },
      answerBeforeMs: DEADLINE_MS,
    });
    const answer = answerOf(await client.answered(id));
    assert.equal(answer.status, "waiting");
    assert.equal(registry.runtimeAttention().pendingPrompts[0]?.detached, true);
    registry.clearForTurn(THREAD, "turn-7", false);
    return answer;
  });

  await step("a Vault request card stays open past its call, and its late answer has no secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-takeover-deadline-e2e-"));
    try {
      const vault = new VaultService({
        store: new VaultStore(join(root, "openbot-vault.json"), {
          encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
          decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
        }),
        canPersist: () => true,
      });
      await Effect.runPromise(vault.load());
      const lateAnswers: string[] = [];
      const vaultRegistry = new AttentionRegistry({
        conversation: {
          agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
          publicThreadId: (_agentId, threadId) => threadId,
          ensureSnapshot: () => snapshot,
          emitConversation: () => {
            snapshot.revision += 1;
          },
        },
        browser: {
          listTabs: () => tabs,
          toolCanUseTab: (params, tabId) =>
            tabs.some(
              (candidate) =>
                candidate.id === tabId &&
                candidate.ownerAgentId === params.ownerAgentId &&
                candidate.ownerThreadId === params.threadId,
            ),
          beginTakeover: () => Effect.void,
          endTakeover: () => {},
        },
        hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
        routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
        emit: (event) => events.push(event),
        emitError: () => {},
        emitRuntimeSnapshot: () => {},
        vaultItems: vault.items,
        agentName: () => "Coder",
        lateAnswerTarget: () => ({}),
        sendLateAnswer: (_agentId, _target, text) => lateAnswers.push(text),
      });
      const args = { kind: "login" as const, title: "Login for the sign-up", website: "example.test", username: "ada" };
      const id = nextRequest++;
      const request = {
        id,
        method: "item/tool/call",
        params: {
          threadId: THREAD,
          turnId: "turn-8",
          callId: `call-${id}`,
          namespace: "openbot_browser",
          tool: "request_vault_item",
          arguments: args,
        },
        detachAfterMs: DEADLINE_MS,
      };
      const shown = await runCauseEffect(
        vaultRegistry.requestVaultItem(client, request, { ...request.params, ownerAgentId: AGENT }),
      );
      assert.equal(shown, null, "the card was refused");
      const waiting = answerOf(await client.answered(id));
      assert.equal(waiting.status, "waiting");
      const pending = vaultRegistry.runtimeAttention().pendingPrompts;
      assert.equal(pending.length, 1, "the card closed with its call");
      assert.equal(pending[0]?.detached, true);
      vaultRegistry.clearForTurn(THREAD, "turn-8", true);
      assert.equal(vaultRegistry.runtimeAttention().pendingPrompts.length, 1, "the end of the turn closed the card");
      const spec = vaultRequestFormSpec(args);
      assert(typeof spec !== "string");
      const answers = uiBlockAnswersFromResponse(spec, {
        actionId: "submit",
        values: { website: "example.test", username: "ada", password: VAULT_SECRET },
      });
      const requestId = pending[0]?.requestId;
      assert(requestId !== undefined);
      await runCauseEffect(
        vaultRegistry.respondToPrompt(
          { requestId, answers },
          { sender: { id: "owner", name: "Ada" }, privileged: true },
        ),
      );
      assert.equal(vaultRegistry.runtimeAttention().pendingPrompts.length, 0);
      assert.equal(lateAnswers.length, 1, "the agent got no late answer");
      assert.match(lateAnswers[0] ?? "", /^> Login for the sign-up\n\n\S/u);
      assert(!lateAnswers.some((text) => text.includes(VAULT_SECRET)), "the late answer holds the password");
      assert(!JSON.stringify(client.answers.get(id)).includes(VAULT_SECRET), "the agent got the password");
      return { waiting, lateAnswer: lateAnswers[0] };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await step("a confirm card answers a provider deadline first, stays open, and its answer comes late", async () => {
    const lateAnswers: string[] = [];
    const cardRegistry = new AttentionRegistry({
      conversation: {
        agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
        publicThreadId: (_agentId, threadId) => threadId,
        ensureSnapshot: () => snapshot,
        emitConversation: () => {
          snapshot.revision += 1;
        },
      },
      browser: {
        listTabs: () => tabs,
        toolCanUseTab: () => false,
        beginTakeover: () => Effect.void,
        endTakeover: () => {},
      },
      hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
      routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
      emit: (event) => events.push(event),
      emitError: () => {},
      emitRuntimeSnapshot: () => {},
      lateAnswerTarget: () => ({}),
      sendLateAnswer: (_agentId, _target, text) => lateAnswers.push(text),
    });
    const surface = (turnId: string, spec: UiBlockSpec, deadline: boolean) => {
      const id = nextRequest++;
      cardRegistry.surfaceUiBlock(
        client,
        {
          id,
          method: "item/tool/call",
          params: { threadId: THREAD, turnId, callId: `call-${id}`, namespace: "openbot", tool: "ask_ui" },
          ...(deadline ? { detachAfterMs: DEADLINE_MS } : {}),
        },
        { blockId: `block-${id}`, spec },
      );
      return id;
    };
    const spec: UiBlockSpec = {
      type: "confirm",
      title: "Post the weekly status update?",
      fields: [{ label: "Channel", value: "#team" }],
      actions: [
        { id: "post", label: "Post", style: "primary" },
        { id: "skip", label: "Not now" },
      ],
    };
    const noDeadlineId = surface("turn-card-1", spec, false);
    const secretId = surface(
      "turn-card-2",
      {
        type: "form",
        title: "Connect the service",
        fields: [{ id: "token", kind: "text", label: "Token", secret: true }],
      },
      true,
    );
    const id = surface("turn-card-3", spec, true);
    const waiting = answerOf(await client.answered(id));
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.success, true, "the agent got a failed call");
    assert(!client.answers.has(secretId), "a form with a secret field answered its call");
    assert(!client.answers.has(noDeadlineId), "a card with no provider deadline answered its call");
    const card = () => cardRegistry.runtimeAttention().pendingPrompts.find((prompt) => prompt.requestId === id);
    assert.equal(card()?.detached, true);
    cardRegistry.clearForTurn(THREAD, "turn-card-3", true);
    assert(card(), "the end of the turn closed the card");
    await runCauseEffect(
      cardRegistry.respondToPrompt(
        { requestId: id, answers: uiBlockAnswersFromResponse(spec, { actionId: "post" }) },
        { sender: { id: "owner", name: "Ada" }, privileged: true },
      ),
    );
    assert.equal(card(), undefined);
    assert.deepEqual(lateAnswers, ["> Post the weekly status update?\n> \n> Channel: #team\n\nPost"]);
    cardRegistry.clearForTurn(THREAD, "turn-card-1", true);
    cardRegistry.clearForTurn(THREAD, "turn-card-2", true);
    return { waiting, lateAnswer: lateAnswers[0] };
  });

  const releasedAnswers: string[] = [];
  const limitedEvents: AgentEvent[] = [];
  const limitedLog: string[] = [];
  const limitedRegistry = (lateAnswerTarget: () => { taskId?: string } | null) =>
    new AttentionRegistry({
      conversation: {
        agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
        publicThreadId: (_agentId, threadId) => threadId,
        ensureSnapshot: () => snapshot,
        emitConversation: () => {
          snapshot.revision += 1;
        },
      },
      browser: {
        listTabs: () => tabs,
        toolCanUseTab: (params, tabId) =>
          tabs.some(
            (candidate) =>
              candidate.id === tabId &&
              candidate.ownerAgentId === params.ownerAgentId &&
              candidate.ownerThreadId === params.threadId,
          ),
        prepareSecret: () => Effect.sync(preparedSecret),
        beginTakeover: (tabId) =>
          Effect.sync(() => {
            limitedLog.push(`begin:${tabId}`);
          }),
        endTakeover: (tabId) => {
          limitedLog.push(`end:${tabId}`);
        },
      },
      hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
      routines: {
        markNeedsAttention: () => {},
        markRunningForTurn: () => {},
        runsTurn: (turnId) => turnId.startsWith("routine-"),
      },
      emit: (event) => limitedEvents.push(event),
      emitError: () => {},
      emitRuntimeSnapshot: () => {},
      lateAnswerTarget,
      sendLateAnswer: (_agentId, _target, text) => releasedAnswers.push(text),
      userAnswerLimitMs: USER_ANSWER_LIMIT_MS,
    });
  const limited = limitedRegistry(() => ({}));
  const limitedCards = () => limited.runtimeAttention().pendingBrowserTakeovers;
  const limitedCount = (type: AgentEvent["type"]) => limitedEvents.filter((event) => event.type === type).length;

  await step("with no provider deadline, a takeover ends its call at the limit and the card stays", async () => {
    const answer = answerOf(await callOn(limited, "request_takeover", "turn-limit-1"));
    assert.equal(answer.success, true);
    assert.equal(answer.status, "waiting");
    assert.match(answer.next ?? "", /arrives as the user's next message/);
    assert.match(answer.next ?? "", /end your turn/);
    assert.equal(limitedCount("browser-takeover-requested"), 1, "the card was not shown once");
    assert.equal(limitedCount("browser-takeover-resolved"), 0, "the limit closed the card");
    assert.equal(limitedCards().length, 1);
    assert.equal(limited.hasAttentionForTurn(THREAD, "turn-limit-1"), false, "the turn still waits for the card");
    limited.clearForTurn(THREAD, "turn-limit-1", true);
    assert.equal(limitedCards().length, 1, "the end of the turn closed the released card");
    assert.deepEqual(limitedLog, [`begin:${TAB}`], "the tab went back to the agent");
    return answer;
  });

  await step("a second call in the same turn does not wait and shows no new card", async () => {
    const answer = answerOf(await callOn(limited, "request_takeover", "turn-limit-1"));
    assert.equal(answer.status, "waiting");
    assert.equal(limitedCount("browser-takeover-requested"), 1, "the call showed a second card");
    assert.equal(limitedCards().length, 1);
    return answer;
  });

  await step("a late answer reaches the agent as a new message, once", async () => {
    const requestId = limitedCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(limited.respondToBrowserTakeover({ requestId, decision: "complete" }));
    assert.equal(limitedCards().length, 0);
    assert.equal(limitedCount("browser-takeover-resolved"), 1);
    assert.deepEqual(releasedAnswers, [
      `I finished the browser takeover in tab ${TAB}. Take a fresh snapshot and continue.`,
    ]);
    assert.deepEqual(limitedLog, [`begin:${TAB}`, `end:${TAB}`]);
    const again = await runCauseEffect(limited.respondToBrowserTakeover({ requestId, decision: "complete" })).then(
      () => "accepted",
      () => "refused",
    );
    assert.equal(again, "refused", "the takeover ran twice");
    assert.equal(releasedAnswers.length, 1, "the agent got a second late answer");
    return { lateAnswer: releasedAnswers[0], again };
  });

  await step("a cancel by the user also reaches the agent as a new message", async () => {
    await callOn(limited, "request_takeover", "turn-limit-2");
    limited.clearForTurn(THREAD, "turn-limit-2", true);
    const requestId = limitedCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(limited.respondToBrowserTakeover({ requestId, decision: "cancel" }));
    assert.equal(
      releasedAnswers.at(-1),
      `I cancelled the browser takeover in tab ${TAB}. Do not try it again until I ask.`,
    );
    return releasedAnswers.at(-1);
  });

  await step("a late password answer tells the agent that the Vault did not save it", async () => {
    await callOn(limited, "submit_secret", "turn-limit-11");
    limited.clearForTurn(THREAD, "turn-limit-11", true);
    const requestId = limitedCards()[0]?.requestId;
    assert(requestId !== undefined);
    const late = releasedAnswers.length;
    await runCauseEffect(
      limited.respondToBrowserSecret({
        requestId,
        agentId: AGENT,
        decision: "submit",
        secret: SECRET,
        saveToVault: true,
      }),
    );
    assert.equal(releasedAnswers.length, late + 1, "the late answer did not reach the agent once");
    const answer = releasedAnswers.at(-1) ?? "";
    assert.match(answer, /^I finished the browser takeover/);
    assert.match(answer, /The password was not saved: no Vault is available\./);
    assert.doesNotMatch(answer, new RegExp(SECRET), "the late answer has the secret");
    return answer;
  });

  await step("a call in a later turn waits on the released card and gets its result", async () => {
    await callOn(limited, "request_takeover", "turn-limit-3");
    limited.clearForTurn(THREAD, "turn-limit-3", true);
    const shown = limitedCount("browser-takeover-requested");
    const requestId = limitedCards()[0]?.requestId;
    assert(requestId !== undefined);
    const late = releasedAnswers.length;
    const next = callOn(limited, "request_takeover", "turn-limit-4");
    await runCauseEffect(limited.respondToBrowserTakeover({ requestId, decision: "complete" }));
    const answer = answerOf(await next);
    assert.equal(answer.status, "completed");
    assert.equal(limitedCount("browser-takeover-requested"), shown, "the later turn showed a new card");
    assert.equal(releasedAnswers.length, late, "the agent got the result twice");
    assert.equal(limitedCards().length, 0);
    return answer;
  });

  await step("a message of the user in the chat closes a released card with no late answer", async () => {
    await callOn(limited, "request_takeover", "turn-limit-5");
    limited.clearForTurn(THREAD, "turn-limit-5", true);
    assert.equal(limitedCards().length, 1);
    const late = releasedAnswers.length;
    limited.closeDetachedForUserMessage(AGENT, THREAD);
    assert.equal(limitedCards().length, 0, "the message did not close the card");
    assert.equal(releasedAnswers.length, late, "the agent got a late answer for the user's own message");
    return "closed";
  });

  await step("a chat with no late answer target closes the card at the limit", async () => {
    const routine = limitedRegistry(() => null);
    const answer = answerOf(await callOn(routine, "request_takeover", "turn-limit-6"));
    assert.equal(answer.status, "expired");
    assert.equal(routine.runtimeAttention().pendingBrowserTakeovers.length, 0, "the card stayed open");
    return answer;
  });

  await step("a question with no provider deadline detaches at the limit", async () => {
    const id = nextRequest++;
    limited.surfaceDynamicPrompt(client, {
      id,
      method: "item/tool/call",
      params: {
        threadId: THREAD,
        turnId: "turn-limit-7",
        callId: `call-${id}`,
        namespace: "openbot",
        tool: "ask_user",
        arguments: { questions: [{ id: "q1", header: "Plan", question: "Which plan?" }] },
      },
    });
    const answer = answerOf(await client.answered(id));
    assert.equal(answer.status, "waiting");
    assert.equal(limited.runtimeAttention().pendingPrompts[0]?.detached, true);
    limited.clearForTurn(THREAD, "turn-limit-7", false);
    return answer;
  });

  const askQuestion = (target: AttentionRegistry, turnId: string, isSecret: boolean) => {
    const id = nextRequest++;
    target.surfaceDynamicPrompt(client, {
      id,
      method: "item/tool/call",
      params: {
        threadId: THREAD,
        turnId,
        callId: `call-${id}`,
        namespace: "openbot",
        tool: "ask_user",
        arguments: { questions: [{ id: "q1", header: "Plan", question: "Which plan?", isSecret }] },
      },
    });
    return client.answered(id);
  };

  await step("a question in a chat with no late answer target expires at the limit", async () => {
    const routine = limitedRegistry(() => null);
    const answer = answerOf(await askQuestion(routine, "turn-limit-8", false));
    assert.equal(answer.success, false);
    assert.match(answer.next ?? "", /expired/);
    assert.equal(routine.runtimeAttention().pendingPrompts.length, 0, "the question card stayed open");
    assert.equal(routine.hasAttentionForTurn(THREAD, "turn-limit-8"), false, "the turn still waits");
    return answer;
  });

  await step("a question of a client with answer notes detaches at the limit and gets the answer late", async () => {
    const noteClient = new NoteClient("/nonexistent/claude");
    const id = nextRequest++;
    limited.surfacePrompt(noteClient, {
      id,
      method: "item/tool/requestUserInput",
      params: {
        threadId: THREAD,
        turnId: "turn-limit-10",
        questions: [
          {
            id: "color",
            header: "Color",
            question: "Which color?",
            options: [
              { label: "Red", description: "Choose red" },
              { label: "Blue", description: "Choose blue" },
            ],
          },
        ],
      },
    });
    const result: { answers?: Record<string, string[]>; note?: string } = JSON.parse(
      JSON.stringify(await noteClient.answered(id)),
    );
    assert.deepEqual(result.answers, {});
    assert.match(result.note ?? "", /answer arrives as the user's next message/);
    assert.equal(limited.runtimeAttention().pendingPrompts[0]?.detached, true, "the card closed at the limit");
    assert.equal(limited.hasAttentionForTurn(THREAD, "turn-limit-10"), false, "the turn still waits");
    limited.clearForTurn(THREAD, "turn-limit-10", true);
    const late = releasedAnswers.length;
    await runCauseEffect(limited.respondToPrompt({ requestId: id, answers: { color: ["Blue"] } }));
    assert.equal(releasedAnswers.length, late + 1, "the late answer did not reach the agent once");
    assert.match(releasedAnswers.at(-1) ?? "", /Blue/);
    assert.equal(noteClient.answers.size, 1, "the provider got a second answer");
    return { note: result.note, lateAnswer: releasedAnswers.at(-1) };
  });

  await step("a routine question leaves the user's waiting question open", async () => {
    const noteClient = new NoteClient("/nonexistent/claude");
    const ask = async (turnId: string, question: string) => {
      const id = nextRequest++;
      limited.surfacePrompt(noteClient, {
        id,
        method: "item/tool/requestUserInput",
        params: {
          threadId: THREAD,
          turnId,
          questions: [
            {
              id: "pick",
              header: "Pick",
              question,
              options: [
                { label: "Yes", description: "Do it" },
                { label: "No", description: "Do not do it" },
              ],
            },
          ],
        },
      });
      await noteClient.answered(id);
      limited.clearForTurn(THREAD, turnId, true);
      return String(id);
    };
    const open = (ids: string[]) =>
      limited
        .runtimeAttention()
        .pendingPrompts.map((prompt) => String(prompt.requestId))
        .filter((id) => ids.includes(id));
    const chatQuestion = await ask("turn-limit-12", "Use the new plan?");
    const firstRoutineQuestion = await ask("routine-turn-limit-13", "Post the report?");
    assert.deepEqual(
      open([chatQuestion, firstRoutineQuestion]),
      [chatQuestion, firstRoutineQuestion],
      "the routine question closed the user's question",
    );
    const nextRoutineQuestion = await ask("routine-turn-limit-14", "Post the next report?");
    assert.deepEqual(
      open([chatQuestion, firstRoutineQuestion, nextRoutineQuestion]),
      [chatQuestion, nextRoutineQuestion],
      "a newer routine question did not replace the older routine question",
    );
    const late = releasedAnswers.length;
    await runCauseEffect(limited.respondToPrompt({ requestId: Number(chatQuestion), answers: { pick: ["Yes"] } }));
    assert.equal(releasedAnswers.length, late + 1, "the user's answer did not reach the agent");
    assert.match(releasedAnswers.at(-1) ?? "", /Use the new plan\?[\s\S]*Yes/);
    limited.expireDetached(AGENT, THREAD);
    return { lateAnswer: releasedAnswers.at(-1) };
  });

  await step("a secret question expires at the limit", async () => {
    const answer = answerOf(await askQuestion(limited, "turn-limit-9", true));
    assert.equal(answer.success, false);
    assert.match(answer.next ?? "", /expired/);
    assert.equal(limited.runtimeAttention().pendingPrompts.length, 0, "the secret question card stayed open");
    return answer;
  });

  const failedFill = async (turnId: string, failure: Error) => {
    fillFailure = failure;
    const shown = count("browser-takeover-requested");
    const pending = call("submit_secret", turnId);
    await cardShown(shown);
    const requestId = openCards()[0]?.requestId;
    assert(requestId !== undefined);
    await runCauseEffect(
      registry.respondToBrowserSecret({ requestId, agentId: AGENT, decision: "submit", secret: SECRET }),
    );
    fillFailure = undefined;
    assert.equal(count("browser-takeover-requested"), shown + 2, "the page did not go to the user");
    assert.equal(openCards()[0]?.secret?.requiresReload, true, "the card does not say that the fill stopped");
    await runCauseEffect(registry.respondToBrowserTakeover({ requestId, decision: "complete" }));
    const answer = answerOf(await pending);
    assert.equal(answer.status, "completed");
    assert(!JSON.stringify(answer).includes(SECRET), "the agent got the secret");
    return answer;
  };

  await step("a failed fill gives the page to the user and tells the agent the fixed reason", async () => {
    const answer = await failedFill(
      "turn-9",
      new Error(
        "Secure authentication could not be completed. Authentication submit button is not ready. Take over to check the page.",
      ),
    );
    assert.equal(
      answer.secureInput,
      "OpenBot could not finish entering the value. Authentication submit button is not ready. The page went to the user.",
    );
    return answer;
  });

  await step("a failed fill with another error tells the agent no page text", async () => {
    const answer = await failedFill("turn-10", new Error(`ERR_ABORTED loading https://example.test/?code=${SECRET}`));
    assert.equal(answer.secureInput, "OpenBot could not finish entering the value. The page went to the user.");
    return answer;
  });

  await step(
    "a sign-in of another username than the only saved login gets the card, not that login (#12070)",
    async () => {
      const vaultFills: string[] = [];
      const vaultEvents: AgentEvent[] = [];
      let savedUsername: string | null = "a@example.test";
      const vaultRegistry = new AttentionRegistry({
        conversation: {
          agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
          publicThreadId: (_agentId, threadId) => threadId,
          ensureSnapshot: () => snapshot,
          emitConversation: () => {
            snapshot.revision += 1;
          },
        },
        browser: {
          listTabs: () => tabs,
          toolCanUseTab: (params, tabId) =>
            tabs.some(
              (candidate) =>
                candidate.id === tabId &&
                candidate.ownerAgentId === params.ownerAgentId &&
                candidate.ownerThreadId === params.threadId,
            ),
          prepareSecret: () =>
            Effect.sync(() => ({
              ...preparedSecret(),
              vaultFillable: true,
              submit: (secret: string) =>
                Effect.sync(() => {
                  vaultFills.push(secret);
                  return "submitted" as const;
                }),
            })),
          beginTakeover: () => Effect.void,
          endTakeover: () => {},
        },
        hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
        routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
        emit: (event) => vaultEvents.push(event),
        emitError: () => {},
        emitRuntimeSnapshot: () => {},
        lateAnswerTarget: () => ({}),
        passwordVault: {
          connected: () => true,
          loginsFor: () =>
            Effect.succeed([
              { id: "openbot:a", title: "Account A", username: savedUsername, hasOneTimePassword: false },
            ]),
          secretFor: (loginId) => Effect.succeed(loginId === "openbot:a" ? VAULT_SECRET : null),
        },
      });
      const cards = () => vaultEvents.filter((event) => event.type === "browser-takeover-requested").length;
      const signIn = (username?: string) => {
        const id = nextRequest++;
        return runCauseEffect(
          vaultRegistry.surfaceBrowserTakeover(client, {
            id,
            method: "item/tool/call",
            params: {
              threadId: THREAD,
              turnId: `turn-vault-${id}`,
              callId: `call-${id}`,
              namespace: "openbot_browser",
              tool: "submit_secret",
              arguments: {
                tabId: TAB,
                method: "password",
                targets: [{ kind: "css", selector: "#password" }],
                submission: "click",
                submitTarget: { kind: "css", selector: "#submit" },
                ...(username === undefined ? {} : { username }),
              },
            },
          }),
        );
      };
      const shown = cards();
      const other = signIn("b@example.test");
      let answered = false;
      void other.finally(() => {
        answered = true;
      });
      while (cards() === shown && !answered) await new Promise((done) => setImmediate(done));
      assert.deepEqual(vaultFills, [], "the password of the other account was filled");
      const card = vaultRegistry.runtimeAttention().pendingBrowserTakeovers[0];
      assert(card?.secret, "no password card for the other account");
      assert.equal(card.vaultSkip, undefined, "the card names a vault reason for another account");
      await runCauseEffect(
        vaultRegistry.respondToBrowserSecret({
          requestId: card.requestId,
          agentId: AGENT,
          decision: "submit",
          secret: SECRET,
        }),
      );
      const typed = answerOf(await other);
      assert.equal(typed.status, "completed");
      assert.deepEqual(vaultFills, [SECRET], "the card did not fill what the user typed");
      const same = answerOf(await signIn(" A@Example.test"));
      const unnamed = answerOf(await signIn());
      assert.equal(same.status, "completed");
      assert.equal(unnamed.status, "completed");
      assert.deepEqual(vaultFills, [SECRET, VAULT_SECRET, VAULT_SECRET], "the saved login was not filled");
      assert.equal(cards(), shown + 1, "a card opened for the saved account");
      savedUsername = null;
      const noSavedUsername = answerOf(await signIn("b@example.test"));
      assert.equal(noSavedUsername.status, "completed");
      assert.equal(vaultFills.at(-1), VAULT_SECRET, "the login with no username was not filled");
      assert.equal(cards(), shown + 1, "a card opened for the login with no username");
      return { typed, same, unnamed, noSavedUsername };
    },
  );

  await step(
    "a saved login that an agent script blocks goes back to the agent at once, with no card (#14181)",
    async () => {
      const vaultFills: string[] = [];
      const vaultEvents: AgentEvent[] = [];
      const attention: string[] = [];
      const vaultRegistry = new AttentionRegistry({
        conversation: {
          agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
          publicThreadId: (_agentId, threadId) => threadId,
          ensureSnapshot: () => snapshot,
          emitConversation: () => {
            snapshot.revision += 1;
          },
        },
        browser: {
          listTabs: () => tabs,
          toolCanUseTab: (params, tabId) =>
            tabs.some(
              (candidate) =>
                candidate.id === tabId &&
                candidate.ownerAgentId === params.ownerAgentId &&
                candidate.ownerThreadId === params.threadId,
            ),
          prepareSecret: () =>
            Effect.sync(() => ({
              ...preparedSecret(),
              agentScriptedOrigin: true,
              vaultFillable: true,
              submit: (secret: string) =>
                Effect.sync(() => {
                  vaultFills.push(secret);
                  return "submitted" as const;
                }),
            })),
          beginTakeover: () => Effect.void,
          endTakeover: () => {},
        },
        hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
        routines: {
          markNeedsAttention: (turnId) => attention.push(`needs:${turnId}`),
          markRunningForTurn: (turnId) => attention.push(`running:${turnId}`),
          runsTurn: () => false,
        },
        emit: (event) => vaultEvents.push(event),
        emitError: () => {},
        emitRuntimeSnapshot: () => {},
        lateAnswerTarget: () => ({}),
        passwordVault: {
          connected: () => true,
          loginsFor: () =>
            Effect.succeed([
              { id: "openbot:a", title: "Account A", username: "a@example.test", hasOneTimePassword: false },
            ]),
          secretFor: (loginId) => Effect.succeed(loginId === "openbot:a" ? VAULT_SECRET : null),
        },
      });
      const cards = () => vaultEvents.filter((event) => event.type === "browser-takeover-requested").length;
      const signIn = (loginId?: string) => {
        const id = nextRequest++;
        return runCauseEffect(
          vaultRegistry.surfaceBrowserTakeover(client, {
            id,
            method: "item/tool/call",
            params: {
              threadId: THREAD,
              turnId: `turn-scripted-${id}`,
              callId: `call-${id}`,
              namespace: "openbot_browser",
              tool: "submit_secret",
              arguments: {
                tabId: TAB,
                method: "password",
                targets: [{ kind: "css", selector: "#password" }],
                submission: "click",
                submitTarget: { kind: "css", selector: "#submit" },
                ...(loginId === undefined ? {} : { loginId }),
              },
            },
          }),
        );
      };
      const cancelledBefore = browserLog.filter((entry) => entry === "secret-cancelled").length;
      const scripted = signIn("openbot:a");
      let answered = false;
      void scripted.finally(() => {
        answered = true;
      });
      while (cards() === 0 && !answered) await new Promise((done) => setImmediate(done));
      assert.equal(cards(), 0, "a password card opened for a skip that the agent can fix");
      const skipped = answerOf(await scripted);
      assert.equal(skipped.success, false, "the skipped saved login was reported as a success");
      assert.match(skipped.next ?? "", /evaluate/u, "the agent did not get the reason for the skip");
      assert.match(skipped.next ?? "", /navigate direction=reload/u, "the agent did not get the reload step");
      assert.match(skipped.next ?? "", /request_takeover/u, "the agent did not get the takeover fallback");
      assert.equal(cards(), 0, "a password card opened for a skip that the agent can fix");
      assert.deepEqual(vaultFills, [], "a saved password was filled while an agent script can run");
      assert.equal(vaultRegistry.runtimeAttention().pendingBrowserTakeovers.length, 0, "the takeover stayed open");
      assert.equal(
        browserLog.filter((entry) => entry === "secret-cancelled").length,
        cancelledBefore + 1,
        "the secure input lock of the tab was not released",
      );
      assert(!attention.some((entry) => entry.startsWith("needs:")), "the routine was marked as waiting for the user");
      const unnamed = signIn();
      let unnamedAnswered = false;
      void unnamed.finally(() => {
        unnamedAnswered = true;
      });
      while (cards() === 0 && !unnamedAnswered) await new Promise((done) => setImmediate(done));
      const card = vaultRegistry.runtimeAttention().pendingBrowserTakeovers[0];
      assert(card?.secret, "no password card for a sign-in without loginId");
      await runCauseEffect(
        vaultRegistry.respondToBrowserSecret({
          requestId: card.requestId,
          agentId: AGENT,
          decision: "submit",
          secret: SECRET,
        }),
      );
      assert.equal(answerOf(await unnamed).status, "completed");
      assert.deepEqual(vaultFills, [SECRET], "the card did not fill what the user typed");
      return { skipped, cards: cards() };
    },
  );

  await step(
    "a routine's saved login that OpenBot cannot fill goes back to the agent, with no card (#16283)",
    async () => {
      const vaultEvents: AgentEvent[] = [];
      const attention: string[] = [];
      let routineFillFails = false;
      let routineScripted = false;
      const vaultRegistry = new AttentionRegistry({
        conversation: {
          agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
          publicThreadId: (_agentId, threadId) => threadId,
          ensureSnapshot: () => snapshot,
          emitConversation: () => {
            snapshot.revision += 1;
          },
        },
        browser: {
          listTabs: () => tabs,
          toolCanUseTab: (params, tabId) =>
            tabs.some(
              (candidate) =>
                candidate.id === tabId &&
                candidate.ownerAgentId === params.ownerAgentId &&
                candidate.ownerThreadId === params.threadId,
            ),
          prepareSecret: () =>
            Effect.sync(() => ({
              ...preparedSecret(),
              agentScriptedOrigin: routineScripted,
              vaultFillable: true,
              submit: () =>
                routineFillFails
                  ? Effect.fail(browserFailure("The secure field changed before OpenBot could enter the value."))
                  : Effect.succeed("submitted" as const),
            })),
          beginTakeover: () => Effect.void,
          endTakeover: () => {},
        },
        hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
        routines: {
          markNeedsAttention: (turnId) => attention.push(`needs:${turnId}`),
          markRunningForTurn: (turnId) => attention.push(`running:${turnId}`),
          runsTurn: (turnId) => turnId.startsWith("routine-"),
        },
        emit: (event) => vaultEvents.push(event),
        emitError: () => {},
        emitRuntimeSnapshot: () => {},
        lateAnswerTarget: () => ({}),
        passwordVault: {
          connected: () => true,
          loginsFor: () =>
            Effect.succeed([
              { id: "openbot:a", title: "Account A", username: "a@example.test", hasOneTimePassword: false },
            ]),
          secretFor: (loginId) => Effect.succeed(loginId === "openbot:a" ? VAULT_SECRET : null),
        },
      });
      const cards = () => vaultEvents.filter((event) => event.type === "browser-takeover-requested").length;
      const signIn = (turnId: string, loginId: string) =>
        runCauseEffect(
          vaultRegistry.surfaceBrowserTakeover(client, {
            id: nextRequest++,
            method: "item/tool/call",
            params: {
              threadId: THREAD,
              turnId,
              callId: `call-${turnId}`,
              namespace: "openbot_browser",
              tool: "submit_secret",
              arguments: {
                tabId: TAB,
                method: "password",
                targets: [{ kind: "css", selector: "#password" }],
                submission: "click",
                submitTarget: { kind: "css", selector: "#submit" },
                loginId,
              },
            },
          }),
        );
      const settled = async (turnId: string, loginId: string) => {
        const before = cards();
        const call = signIn(turnId, loginId);
        let answered = false;
        void call.finally(() => {
          answered = true;
        });
        while (cards() === before && !answered) await new Promise((done) => setImmediate(done));
        return { call };
      };
      const cancelledBefore = browserLog.filter((entry) => entry === "secret-cancelled").length;
      const { call: unknownCall } = await settled("routine-unknown-login", "openbot:missing");
      assert.equal(cards(), 0, "a password card opened in a routine for an unknown saved login");
      const unknown = answerOf(await unknownCall);
      assert.equal(unknown.success, false, "the skipped saved login was reported as a success");
      assert.match(unknown.next ?? "", /list_logins/u, "the agent did not get the reason for the skip");
      assert.match(unknown.next ?? "", /routine run/u, "the agent was not told that nobody answers in a routine");
      routineScripted = true;
      const { call: scriptedCall } = await settled("routine-scripted-login", "openbot:a");
      assert.equal(cards(), 0, "a password card opened in a routine for a login that an agent script blocks");
      const scripted = answerOf(await scriptedCall);
      assert.match(scripted.next ?? "", /navigate direction=reload/u, "the agent did not get the reload step");
      assert.doesNotMatch(
        scripted.next ?? "",
        /so that the user types the password/u,
        "a routine was told to open a card that nobody answers",
      );
      routineScripted = false;
      routineFillFails = true;
      const { call: failedCall } = await settled("routine-failed-fill", "openbot:a");
      assert.equal(cards(), 0, "a takeover card opened in a routine after a saved login fill failed");
      const failed = answerOf(await failedCall);
      assert.equal(failed.success, false, "the failed fill was reported as a success");
      assert.match(failed.next ?? "", /could not finish filling saved login openbot:a/u);
      assert.equal(vaultRegistry.runtimeAttention().pendingBrowserTakeovers.length, 0, "the takeover stayed open");
      assert.equal(
        browserLog.filter((entry) => entry === "secret-cancelled").length,
        cancelledBefore + 3,
        "the secure input lock of the tab was not released",
      );
      assert(!attention.some((entry) => entry.startsWith("needs:")), "the routine was marked as waiting for the user");
      routineFillFails = false;
      const { call: chatCall } = await settled("turn-chat-unknown-login", "openbot:missing");
      const card = vaultRegistry.runtimeAttention().pendingBrowserTakeovers[0];
      assert(card?.secret, "a chat lost the password card for an unknown saved login");
      await runCauseEffect(
        vaultRegistry.respondToBrowserSecret({
          requestId: card.requestId,
          agentId: AGENT,
          decision: "submit",
          secret: SECRET,
        }),
      );
      assert.equal(answerOf(await chatCall).status, "completed");
      return { unknown, scripted, failed, cards: cards() };
    },
  );

  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ok: true, steps, browserLog, limitedLog, releasedAnswers }, null, 2)}\n`,
  );
  process.stdout.write(`browser-takeover-deadline-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`,
  );
  process.stderr.write(
    `browser-takeover-deadline-e2e failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
