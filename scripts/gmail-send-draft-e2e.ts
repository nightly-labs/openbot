// Runs `send_gmail_draft` end to end on the real modules against a local stand-in for the Gmail API:
// `findGmailDraft` finds the draft in the second of two signed-in accounts, the real `AttentionRegistry`
// shows the card that `gmailSendCardSpec` builds, and the owner, a member and an admin answer it. It
// checks that only a privileged Send sends, that Cancel and a member send nothing, that a draft changed
// after the card is not sent, that Gmail's refusal leaves the card open, and that no token reaches an
// answer, an event or a stored message. No Google account is used.
// `bun scripts/gmail-send-draft-e2e.ts`. Writes .openbot-build/gmail-send-draft-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { type UiBlockSpec, uiBlockActionIsPrivileged, uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AttentionRegistry, type PromptResponder } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  findGmailDraft,
  GMAIL_SEND_ACTION_ID,
  type GmailAccountToken,
  type GmailApi,
  type GmailDraft,
  gmailSendCardSpec,
  sendGmailDraft,
} from "../src/backend/gmail-drafts";
import { sendGmailDraftToolSchema } from "../src/backend/openbot-tools";
import type { RequestId } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/gmail-send-draft-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const FIRST: GmailAccountToken = { name: "gmail", token: "ya29.e2e-first-account-3b1f" };
const SECOND: GmailAccountToken = { name: "gmail work", token: "ya29.e2e-second-account-9c4d" };
const DRAFT = "r-e2e-draft-1";
const HTML_DRAFT = "r-e2e-draft-html";
const REFUSED_DRAFT = "r-e2e-draft-refused";
const AUTO_DRAFT = "r-e2e-draft-auto";
const MEMBER: PromptResponder = { sender: { id: "member-1", name: "Mia" }, privileged: false };
const ADMIN: PromptResponder = { sender: { id: "admin-1", name: "Ada" }, privileged: true };

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64url");

/** The drafts of the second account. `messageId` changes when the agent edits a draft. */
const drafts = new Map<string, { messageId: string; payload: unknown; refuse?: boolean }>([
  [
    DRAFT,
    {
      messageId: "m-1",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Owner <owner@example.com>" },
          { name: "To", value: "alex@example.com" },
          { name: "Cc", value: "team@example.com" },
          { name: "Subject", value: "Launch notes" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Hi Alex,\n```\nthe plan is ready.") } },
              { mimeType: "text/html", body: { data: b64("<p>Hi Alex, the plan is ready.</p>") } },
            ],
          },
          { mimeType: "application/pdf", filename: "plan.pdf", body: { attachmentId: "a-1" } },
        ],
      },
    },
  ],
  [
    HTML_DRAFT,
    {
      messageId: "m-html",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "To", value: "sam@example.com" }],
        body: { data: b64('<style>p{}</style><p>Hello <a href="https://evil.example">Sam</a> &amp; team</p>') },
      },
    },
  ],
  [
    AUTO_DRAFT,
    {
      messageId: "m-auto",
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "To", value: "team@example.com" }],
        body: { data: b64("Daily report.") },
      },
    },
  ],
  [
    REFUSED_DRAFT,
    {
      messageId: "m-refused",
      refuse: true,
      payload: { mimeType: "text/plain", headers: [{ name: "To", value: "not an address" }], body: { data: b64("x") } },
    },
  ],
]);
const sent: Array<{ id: string; token: string }> = [];
const requests: string[] = [];

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<{ id?: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The Gmail API as `gmail-drafts.ts` calls it. Only the second account has drafts. */
const gmail = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const token = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
    requests.push(`${request.method} ${url.pathname}`);
    if (token !== FIRST.token && token !== SECOND.token) return reply(response, 401, { error: { message: "bad" } });
    const prefix = "/gmail/v1/users/me/drafts";
    if (request.method === "POST" && url.pathname === `${prefix}/send`) {
      const { id = "" } = await readJson(request);
      const draft = token === SECOND.token ? drafts.get(id) : undefined;
      if (!draft) return reply(response, 404, { error: { message: "Requested entity was not found." } });
      if (draft.refuse) return reply(response, 400, { error: { message: "Invalid To header" } });
      sent.push({ id, token });
      drafts.delete(id);
      return reply(response, 200, { id: `sent-${id}`, threadId: `thread-${id}`, labelIds: ["SENT"] });
    }
    const id = decodeURIComponent(url.pathname.slice(prefix.length + 1));
    const draft = token === SECOND.token ? drafts.get(id) : undefined;
    if (request.method !== "GET" || !draft) return reply(response, 404, { error: { message: "Not found" } });
    return reply(response, 200, {
      id,
      message: {
        id: draft.messageId,
        snippet: "",
        ...(url.searchParams.get("format") === "full" ? { payload: draft.payload } : {}),
      },
    });
  })();
});
await new Promise<void>((done) => gmail.listen(0, "127.0.0.1", done));
const address = gmail.address();
assert.ok(address && typeof address === "object", "the Gmail stand-in has no port");
const api: GmailApi = { apiUrl: `http://127.0.0.1:${address.port}/gmail/v1/users/me` };

/** Records what OpenBot answers to the agent, as raw JSON. The process never starts. */
class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, string>();

  override get running(): boolean {
    return true;
  }

  readonly #waiting = new Map<RequestId, () => void>();

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, JSON.stringify(result));
    this.#waiting.get(id)?.();
  }

  /** Resolves when OpenBot answers request `id`. */
  answered(id: RequestId): Promise<void> {
    if (this.answers.has(id)) return Promise.resolve();
    return new Promise((done) => this.#waiting.set(id, done));
  }
}

function agentAnswer(raw: string | undefined): { status?: string; actionId?: string; messageId?: string } {
  assert.ok(raw, "OpenBot did not answer the agent");
  const parsed: { contentItems?: Array<{ text?: string }> } = JSON.parse(raw);
  const text = parsed.contentItems?.[0]?.text;
  assert.ok(text, "the answer has no text");
  return JSON.parse(text);
}

const client = new RecordingClient("/nonexistent/codex");
const snapshot: ConversationSnapshot = {
  agentId: AGENT,
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const events: AgentEvent[] = [];
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
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
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
});

let nextRequest = 1;

/** Finds the draft and shows its card, as `OpenBotToolRouter.#sendGmailDraft` does. */
async function showDraft(
  draftId: string,
  automatic = false,
): Promise<{ id: number; spec: UiBlockSpec; draft: GmailDraft }> {
  const args = sendGmailDraftToolSchema.parse({ draftId });
  const draft = await Effect.runPromise(findGmailDraft([FIRST, SECOND], args.draftId, api));
  assert.ok(draft, `no account has ${draftId}`);
  const spec = gmailSendCardSpec(draft);
  assert.ok(spec, "the contract refused the card");
  const id = nextRequest++;
  registry.surfaceUiBlock(
    client,
    { id, method: "item/tool/call", params: { threadId: THREAD, turnId: `turn-${id}` } },
    {
      blockId: `block-${id}`,
      spec,
      confirmed: {
        actionId: GMAIL_SEND_ACTION_ID,
        run: () =>
          sendGmailDraft(draft, api).pipe(
            Effect.map((done) => ({ status: "sent", messageId: done.messageId, threadId: done.threadId })),
            Effect.mapError((failure) => ({ cause: new Error(failure.message) })),
          ),
      },
    },
    automatic ? { actionId: GMAIL_SEND_ACTION_ID, afterMs: 0 } : undefined,
  );
  return { id, spec, draft };
}

function press(requestId: number, spec: UiBlockSpec, actionId: string, responder?: PromptResponder) {
  return runCauseEffect(
    registry.respondToPrompt({ requestId, answers: uiBlockAnswersFromResponse(spec, { actionId }) }, responder),
  );
}

async function refused(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the answer was accepted");
}

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => unknown): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let failure: unknown = null;
try {
  let card = await showDraft(DRAFT);

  await step("the draft is found in the second account and the card shows it as plain text", () => {
    assert.equal(card.draft.account.name, SECOND.name);
    assert.ok(requests.includes(`GET /gmail/v1/users/me/drafts/${DRAFT}`), "the first account was not asked");
    assert.equal(card.spec.type, "confirm");
    if (card.spec.type !== "confirm") return;
    const fields = Object.fromEntries(
      (card.spec.fields ?? []).map((field) => [field.label, "value" in field ? field.value : ""]),
    );
    assert.equal(fields[sourceText("status.agent.gmailSend.to")], "alex@example.com");
    assert.equal(fields[sourceText("status.agent.gmailSend.cc")], "team@example.com");
    assert.equal(fields[sourceText("status.agent.gmailSend.subject")], "Launch notes");
    assert.equal(fields[sourceText("status.agent.gmailSend.attachments")], "plan.pdf");
    assert.ok(!(sourceText("status.agent.gmailSend.bcc") in fields), "an empty Bcc line is shown");
    // The body holds three backticks, so its fence must be longer to keep it one code block.
    assert.ok(card.spec.preview?.startsWith("````text\nHi Alex,\n```\nthe plan is ready.\n````"), card.spec.preview);
    assert.ok(uiBlockActionIsPrivileged(card.spec, GMAIL_SEND_ACTION_ID), "Send is not privileged");
    return fields;
  });

  await step("a member who presses Send is refused, nothing is sent, and the card stays open", async () => {
    const message = await refused(press(card.id, card.spec, GMAIL_SEND_ACTION_ID, MEMBER));
    assert.equal(message, sourceText("error.backend.uiBlockActionNotAllowed"));
    assert.equal(sent.length, 0);
    assert.ok(!client.answers.has(card.id), "the agent got an answer");
    return message;
  });

  await step("Cancel sends nothing and tells the agent", async () => {
    await press(card.id, card.spec, "cancel");
    assert.equal(sent.length, 0);
    const answer = agentAnswer(client.answers.get(card.id));
    assert.equal(answer.actionId, "cancel");
    assert.notEqual(answer.status, "sent");
    return answer;
  });

  await step("a draft changed after the card is not sent, and the card stays open", async () => {
    card = await showDraft(DRAFT);
    const draft = drafts.get(DRAFT);
    assert.ok(draft);
    draft.messageId = "m-2";
    const message = await refused(press(card.id, card.spec, GMAIL_SEND_ACTION_ID));
    assert.equal(message, sourceText("error.backend.gmailDraftChanged"));
    assert.equal(sent.length, 0);
    assert.ok(!client.answers.has(card.id), "the agent got an answer");
    return message;
  });

  await step("an admin who presses Send on the current card sends the draft once", async () => {
    card = await showDraft(DRAFT);
    await press(card.id, card.spec, GMAIL_SEND_ACTION_ID, ADMIN);
    assert.deepEqual(sent, [{ id: DRAFT, token: SECOND.token }]);
    const answer = agentAnswer(client.answers.get(card.id));
    assert.equal(answer.status, "sent");
    assert.equal(answer.messageId, `sent-${DRAFT}`);
    return answer;
  });

  await step("with the auto answer of Full access, the host presses Send and the card stays as sent", async () => {
    const autoCard = await showDraft(AUTO_DRAFT, true);
    // The host answers on a timer of 0 ms and then calls Gmail: wait for the agent's answer.
    await client.answered(autoCard.id);
    assert.deepEqual(sent.at(-1), { id: AUTO_DRAFT, token: SECOND.token });
    const answer = agentAnswer(client.answers.get(autoCard.id));
    assert.equal(answer.status, "sent");
    const stored = JSON.stringify(snapshot.messages);
    assert.ok(stored.includes('"done":true'), "the card does not say that the host answered");
    assert.ok(stored.includes("Daily report."), "the card does not keep what was sent");
    return answer;
  });

  await step("Gmail's refusal shows its sentence and leaves the card open", async () => {
    const refusedCard = await showDraft(REFUSED_DRAFT);
    const message = await refused(press(refusedCard.id, refusedCard.spec, GMAIL_SEND_ACTION_ID));
    assert.equal(message, sourceText("error.backend.gmailSendFailed", { reason: "Invalid To header" }));
    assert.equal(sent.length, 2);
    assert.ok(!client.answers.has(refusedCard.id), "the agent got an answer");
    await press(refusedCard.id, refusedCard.spec, "cancel");
    return message;
  });

  await step("an HTML body shows as text without markup or link targets", async () => {
    const htmlCard = await showDraft(HTML_DRAFT);
    assert.equal(htmlCard.draft.body, "Hello Sam & team");
    assert.ok(
      !htmlCard.spec.type || !JSON.stringify(htmlCard.spec).includes("evil.example"),
      "the link target is shown",
    );
    await press(htmlCard.id, htmlCard.spec, "cancel");
    return htmlCard.draft.body;
  });

  await step("an unknown draft id is found in no account", async () => {
    const none = await Effect.runPromise(findGmailDraft([FIRST, SECOND], "r-missing", api));
    assert.equal(none, null);
  });

  await step("no token is in an agent answer, an event or a stored message", () => {
    const seen = JSON.stringify({ answers: [...client.answers.values()], events, messages: snapshot.messages });
    for (const token of [FIRST.token, SECOND.token]) assert.ok(!seen.includes(token), "a token leaked");
    return `${client.answers.size} answers, ${events.length} events, ${snapshot.messages.length} messages checked`;
  });
} catch (error) {
  failure = error;
} finally {
  gmail.close();
}

const report = { passed: failure === null, steps, sent, requests };
await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`gmail-send-draft-e2e: ${steps.length} steps, ${report.passed ? "passed" : "failed"}\n`);
if (failure) throw failure;
