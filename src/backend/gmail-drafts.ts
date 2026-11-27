import { normalizeUiBlockSpec, UI_BLOCK_LIMITS, type UiBlockSpec } from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { readLimitedBody } from "./limited-body";

export const GMAIL_MCP_URL = "https://gmailmcp.googleapis.com/mcp/v1";

const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_BODY_LIMIT = 4 * 1024 * 1024;
const GMAIL_REQUEST_TIMEOUT_MS = 20_000;
const PREVIEW_BODY_LIMIT = 6_000;

export interface GmailAccountToken {
  name: string;
  token: string;
}

export interface GmailDraft {
  draftId: string;
  messageId: string;
  account: GmailAccountToken;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  bodyCut: boolean;
  attachments: string[];
}

export interface GmailSent {
  messageId: string;
  threadId: string;
}

export class GmailDraftFailed extends Schema.TaggedError<GmailDraftFailed>()("GmailDraftFailed", {
  message: Schema.String,
}) {}

export interface GmailApi {
  apiUrl?: string;
  fetch?: typeof fetch;
}

export const findGmailDraft = Effect.fn("Gmail.findDraft")(function* (
  accounts: readonly GmailAccountToken[],
  draftId: string,
  api: GmailApi = {},
) {
  for (const account of accounts) {
    const answer = yield* gmailRequest(api, account.token, `/drafts/${encodeURIComponent(draftId)}?format=full`);
    if (answer.status === 404 || answer.status === 400 || answer.status === 401 || answer.status === 403) continue;
    if (answer.status !== 200) return yield* sendFailed(`HTTP ${answer.status}`);
    const draft = readDraft(answer.body, draftId, account);
    if (!draft) return yield* sendFailed("unreadable draft");
    return draft;
  }
  return null;
});

export const sendGmailDraft = Effect.fn("Gmail.sendDraft")(function* (draft: GmailDraft, api: GmailApi = {}) {
  const now = yield* gmailRequest(
    api,
    draft.account.token,
    `/drafts/${encodeURIComponent(draft.draftId)}?format=minimal`,
  );
  const current = now.status === 200 ? draftSchema.safeParse(now.body) : null;
  const messageId = current?.success ? current.data.message.id : undefined;
  if (now.status === 404 || messageId !== draft.messageId)
    return yield* new GmailDraftFailed({ message: sourceText("error.backend.gmailDraftChanged") });
  const sent = yield* gmailRequest(api, draft.account.token, "/drafts/send", { id: draft.draftId });
  if (sent.status !== 200) return yield* sendFailed(gmailError(sent.body) ?? `HTTP ${sent.status}`);
  const message = sentSchema.safeParse(sent.body);
  if (!message.success) return yield* sendFailed("unreadable answer");
  return { messageId: message.data.id, threadId: message.data.threadId ?? "" } satisfies GmailSent;
});

export const GMAIL_SEND_ACTION_ID = "send";

export function gmailSendCardSpec(draft: GmailDraft): UiBlockSpec | null {
  const fields = [
    ["status.agent.gmailSend.from", draft.from],
    ["status.agent.gmailSend.to", draft.to],
    ["status.agent.gmailSend.cc", draft.cc],
    ["status.agent.gmailSend.bcc", draft.bcc],
    ["status.agent.gmailSend.subject", draft.subject || sourceText("status.agent.gmailSend.noSubject")],
    ["status.agent.gmailSend.attachments", draft.attachments.join(", ")],
  ] as const;
  const fence = "`".repeat(Math.max(3, ...[...draft.body.matchAll(/`+/gu)].map((run) => run[0].length + 1)));
  const cut = draft.bodyCut ? `\n\n${sourceText("status.agent.gmailSend.bodyCut")}` : "";
  return normalizeUiBlockSpec({
    type: "confirm",
    title: sourceText("status.agent.gmailSend.title"),
    fields: fields
      .filter(([, value]) => value.trim() !== "")
      .map(([label, value]) => ({ label: sourceText(label), value: value.slice(0, UI_BLOCK_LIMITS.text) })),
    preview: `${fence}text\n${draft.body}\n${fence}${cut}`.slice(0, UI_BLOCK_LIMITS.preview),
    actions: [
      { id: GMAIL_SEND_ACTION_ID, label: sourceText("status.agent.gmailSend.send"), style: "primary", confirm: true },
      { id: "cancel", label: sourceText("status.agent.gmailSend.cancel") },
    ],
  });
}

function sendFailed(reason: string) {
  return new GmailDraftFailed({ message: sourceText("error.backend.gmailSendFailed", { reason }) });
}

function gmailRequest(api: GmailApi, token: string, path: string, json?: unknown) {
  const run = api.fetch ?? fetch;
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            run(`${api.apiUrl ?? GMAIL_API_URL}${path}`, {
              method: json === undefined ? "GET" : "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
                ...(json === undefined ? {} : { "Content-Type": "application/json" }),
              },
              ...(json === undefined ? {} : { body: JSON.stringify(json) }),
              redirect: "error",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(GMAIL_REQUEST_TIMEOUT_MS)]),
            }),
          catch: () => sendFailed("no connection to Gmail"),
        });
        const bytes = yield* readLimitedBody(response, GMAIL_BODY_LIMIT, (reason) =>
          sendFailed(reason === "too-large" ? "the draft is too large" : "no connection to Gmail"),
        );
        let body: unknown = null;
        try {
          body = bytes.byteLength > 0 ? JSON.parse(bytes.toString("utf8")) : null;
        } catch {
          body = null;
        }
        return { status: response.status, body };
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
}

interface GmailPart {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { data?: string | undefined } | undefined;
  parts?: GmailPart[] | undefined;
}

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
const draftSchema = z.object({
  message: z.object({ id: z.string(), snippet: z.string().optional(), payload: partSchema.optional() }),
});
const sentSchema = z.object({ id: z.string(), threadId: z.string().optional() });
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

function gmailError(body: unknown): string | null {
  const parsed = errorSchema.safeParse(body);
  const message = parsed.success ? parsed.data.error.message.trim() : "";
  return message ? message.slice(0, 300) : null;
}

function readDraft(body: unknown, draftId: string, account: GmailAccountToken): GmailDraft | null {
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  const payload = message.payload ?? {};
  const headers = new Map((payload.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
  const attachments: string[] = [];
  const plain = partText(payload, "text/plain", attachments);
  const html = plain === null ? partText(payload, "text/html", []) : null;
  const full = (plain ?? (html === null ? (message.snippet ?? "") : htmlText(html))).replace(/\r\n/gu, "\n").trim();
  return {
    draftId,
    messageId: message.id,
    account,
    from: headers.get("from") ?? "",
    to: headers.get("to") ?? "",
    cc: headers.get("cc") ?? "",
    bcc: headers.get("bcc") ?? "",
    subject: headers.get("subject") ?? "",
    body: full.slice(0, PREVIEW_BODY_LIMIT),
    bodyCut: full.length > PREVIEW_BODY_LIMIT,
    attachments,
  };
}

function partText(part: GmailPart, mimeType: string, attachments: string[]): string | null {
  if (part.filename) {
    attachments.push(part.filename);
    return null;
  }
  let found: string | null = null;
  if (part.mimeType?.toLowerCase() === mimeType && part.body?.data !== undefined)
    found = Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const childText = partText(child, mimeType, attachments);
    found ??= childText;
  }
  return found;
}

function htmlText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\n{3,}/gu, "\n\n");
}
