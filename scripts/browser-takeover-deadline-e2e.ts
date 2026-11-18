// Runs a takeover card past the provider's tool-call deadline (#9689) on the real `AttentionRegistry`.
// Antigravity 1.5.9 stops each MCP tool call after 180 s, also with progress. The call must get an
// answer before then, the card must stay open, and the next call for the same tab must wait on the
// same card. Cursor asks for no progress and stops each call after 60 s (#10577), so a Vault request
// card must also answer its call first, stay open, and send only the saved item's name as the late
// answer. A secure fill that fails gives the page to the user and tells the agent only a fixed reason
// (#10536). The browser host is a stub: no page, provider or account is used; the Vault is a temporary file.
// `bun scripts/browser-takeover-deadline-e2e.ts`. Writes .openbot-build/browser-takeover-deadline-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, BrowserTab, ConversationSnapshot } from "@openbot/contracts/ipc";
import { uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
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
/** Short, so the script waits for the real timer and not for 165 s. */
const DEADLINE_MS = 50;

/** The JSON of a takeover tool result. */
interface AgentAnswer {
  status?: string;
  next?: string;
  secureInput?: string;
}

/** Records what OpenBot answers to the agent. The process never starts. */
class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, unknown>();
  readonly #waiters = new Map<RequestId, () => void>();

  /** Resolves when OpenBot answers the request, so that a host timer is awaited, not slept on. */
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
/** When set, the fill fails with this error, as a page that the fill cannot complete. */
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
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
  lateAnswerTarget: () => ({}),
});

let nextRequest = 1;

/** One provider call of a takeover tool, as the tool router passes it. */
function call(tool: "submit_secret" | "request_takeover", turnId: string, answerBeforeMs?: number) {
  const id = nextRequest++;
  return runCauseEffect(
    registry.surfaceBrowserTakeover(client, {
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

/** Waits for the card's event, not for a time. */
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
    // It waits on the card: its own deadline answers it, and no second card shows.
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
        browser: { listTabs: () => tabs, beginTakeover: () => Effect.void, endTakeover: () => {} },
        hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
        routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
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
        // Cursor's call: no progress token, so the bridge sets only this deadline.
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
      // The turn ends, as the agent ends it after the waiting answer. The card stays.
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

  /** Submits the card while the fill fails, then the user selects Done; returns the agent's answer. */
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
        routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
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
      // Account B: the card opens, and the password of account A does not go in.
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
      // The same account, written in another case, and a call with no username: the saved login goes in.
      const same = answerOf(await signIn(" A@Example.test"));
      const unnamed = answerOf(await signIn());
      assert.equal(same.status, "completed");
      assert.equal(unnamed.status, "completed");
      assert.deepEqual(vaultFills, [SECRET, VAULT_SECRET, VAULT_SECRET], "the saved login was not filled");
      assert.equal(cards(), shown + 1, "a card opened for the saved account");
      // A login saved with no username names no account, so it is filled as before.
      savedUsername = null;
      const noSavedUsername = answerOf(await signIn("b@example.test"));
      assert.equal(noSavedUsername.status, "completed");
      assert.equal(vaultFills.at(-1), VAULT_SECRET, "the login with no username was not filled");
      assert.equal(cards(), shown + 1, "a card opened for the login with no username");
      return { typed, same, unnamed, noSavedUsername };
    },
  );

  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify({ ok: true, steps, browserLog }, null, 2)}\n`);
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
