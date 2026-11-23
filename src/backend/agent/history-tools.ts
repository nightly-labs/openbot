import { chatVisualReply } from "@openbot/contracts/chat-visual";
import {
  CONVERSATION_TRACE_STEP_LIMIT,
  type ConversationMessage,
  type ConversationTurnTrace,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactSecrets } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentStore } from "../agent-store";
import type { AgentThreadRecord, ThreadListPosition } from "../agent-threads/agent-thread-store";
import { HistoryReferenceUnavailable } from "../database/agent-history-queries";
import type { ProviderSession } from "../database/provider-sessions";
import { openBotToolResult } from "./routine-tools";
import { type ToolOperationFailed, toolStep } from "./tool-operation";

export const MAIN_CHAT_TASK_ID = "main";
const THREADS_RESULT_CHARACTERS = 8_000;
const RELATIVE_BOUND = /^(\d{1,4})([mhdw])$/;
const DATE_BOUND = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UNIT_MS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function windowBound(text: string, now: number): string | null {
  if (text.length > 40) return null;
  const relative = RELATIVE_BOUND.exec(text);
  const unit = relative ? UNIT_MS[relative[2] ?? ""] : undefined;
  if (relative && unit !== undefined) return new Date(now - Number(relative[1]) * unit).toISOString();
  const date = DATE_BOUND.exec(text);
  if (date) {
    const day = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    return day.getDate() === Number(date[3]) && day.getMonth() === Number(date[2]) - 1 ? day.toISOString() : null;
  }
  const time = ISO_TIME.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function traceSteps(trace: ConversationTurnTrace): string | null {
  const steps = trace.steps.flatMap((step) => {
    if (step.kind !== "tool") return [];
    const status = step.failed ? "failed" : step.endedAt === null ? "unfinished" : "completed";
    const name = step.command ? `$ ${step.command}` : `tool ${step.text ?? "step"}`;
    return [[`${name} (${status})`, ...(step.error ? [step.error] : [])].join("\n")];
  });
  if (!steps.length) return null;
  const cut = trace.steps.length >= CONVERSATION_TRACE_STEP_LIMIT ? ["(later steps left out)"] : [];
  return ["[work steps]", ...steps, ...cut, "[end work steps]"].join("\n");
}

const id = z.string().min(1).max(512);
const cursorText = z.string().min(1).max(4096);
const SEARCH_ALL_THREADS = 8;
const SEARCH_ALL_CHARACTERS = 8_000;
const SEARCH_SCAN_ROWS = 200;
const SEARCH_TERMS = /"([^"]+)"|(\S+)/gu;

function searchTerms(query: string): string[] {
  return [...query.toLowerCase().matchAll(SEARCH_TERMS)].flatMap((match) => {
    const term = (match[1] ?? match[2]?.replace(/^"+|"+$/gu, "") ?? "").trim();
    return term ? [term] : [];
  });
}

function searchMatch(text: string, terms: readonly string[]): number {
  const lower = text.toLowerCase();
  let first = terms.length ? lower.length : 0;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index < 0) return -1;
    first = Math.min(first, index);
  }
  return first;
}

const NO_MATCH_HINT = "No message holds all the words. Search again with fewer or shorter words.";
const taskId = id.optional();
const searchShape = {
  taskId,
  query: z.string().trim().max(200).optional(),
  after: z
    .string()
    .trim()
    .refine((text) => windowBound(text, Date.now()) !== null, "Use 24h, 7d, a date or an ISO time.")
    .optional(),
  cursor: cursorText.optional(),
  limit: z.number().int().min(1).max(10).optional(),
};
const readShape = {
  taskId,
  messageId: id.optional(),
  before: cursorText.optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  includeWorkSteps: z.boolean().optional(),
  workStepsOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
};
const listCursorSchema = z.strictObject({
  version: z.literal(1),
  list: z.literal("threads"),
  after: z.string().nullable(),
  last: z.strictObject({ updatedAt: id, threadId: id }).nullable(),
});

function readListCursor(text: string) {
  try {
    return listCursorSchema.parse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

function listCursor(after: string | null, last: ThreadListPosition | null): string {
  return Buffer.from(JSON.stringify({ version: 1, list: "threads", after, last }), "utf8").toString("base64url");
}

const searchSchema = z
  .strictObject(searchShape)
  .refine(
    (value) =>
      value.cursor === undefined ||
      (readListCursor(value.cursor) === null
        ? value.query !== undefined
        : value.query === undefined && value.taskId === undefined),
    {
      path: ["cursor"],
      message:
        "A cursor continues the call that gave it. Send a history_search cursor with the same query, a chat list cursor with no query, and a history_read cursor to history_read as before.",
    },
  );
const READ_CURSOR_HINT = "Send nextCursor to history_read as before for older messages.";
const readSchema = z
  .strictObject(readShape, {
    error: (issue) =>
      issue.code === "unrecognized_keys" && issue.keys.includes("cursor")
        ? `There is no cursor argument. ${READ_CURSOR_HINT}`
        : undefined,
  })
  .refine(
    (value) =>
      !(value.messageId && value.before) &&
      (value.offset === undefined || Boolean(value.messageId)) &&
      (value.workStepsOffset === undefined || Boolean(value.messageId && value.includeWorkSteps)),
  );
const cursorSchema = z.strictObject({
  version: z.literal(1),
  threadId: id,
  resetMessageId: id.nullable(),
  anchorMessageId: id,
  query: z.string().nullable(),
});

export function historyCursorThread(text: unknown): string | null {
  if (typeof text !== "string" || !cursorText.safeParse(text).success) return null;
  return readCursor(text)?.threadId ?? null;
}

function decodeCursor(text: string) {
  return cursorSchema.parse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
}

function readCursor(text: string) {
  try {
    return decodeCursor(text);
  } catch {
    return null;
  }
}

function unknownReference(argument: "messageId" | "before", input: string): z.ZodError {
  const message =
    argument === "before"
      ? "Use nextCursor or a messageId from an earlier answer of this chat. For another chat, send its taskId again."
      : "This chat has no such message. Use a messageId from an earlier answer of this chat, or the Message ID of a teammate request. For another chat, send its taskId again.";
  return new z.ZodError([{ code: "custom", path: [argument], input, message }]);
}

function readContent(message: ConversationMessage | undefined): string {
  return JSON.stringify(
    message?.exchange ? { ...message, exchange: { ...message.exchange, deliveries: [] } } : message,
  );
}

export function isHistoryBrowse(tool: string, args: unknown): boolean {
  if (tool !== "history_search") return false;
  if (args === undefined || args === null) return true;
  return typeof args === "object" && !("query" in args) && !("taskId" in args);
}

export const HISTORY_TOOL_DEFINITIONS = [
  {
    name: "history_search",
    description:
      'Without query: list your chats, newest first (main chat is taskId "main"). With query: search all chats or one by taskId. after: 24h, 7d or a date. history_read gives more.',
    shape: searchShape,
  },
  {
    name: "history_read",
    description:
      "Read this chat, or one by taskId. Read a messageId with offset for large text; for older messages, before is nextCursor or a messageId. Optional captured work steps contain no raw reasoning; continue them with workStepsOffset from nextWorkStepsOffset. Channels use channel_history.",
    shape: readShape,
  },
];

interface HistoryToolOptions {
  store: AgentStore;
  redact(text: string): string;
  capturedSteps(session: ProviderSession): Effect.Effect<Map<string, string> | null, ToolOperationFailed>;
  pageText(attachmentId: string): Effect.Effect<string | null>;
  recentThreads(
    agentId: string,
    after: string | null,
    limit: number,
    last: ThreadListPosition | null,
  ): readonly AgentThreadRecord[];
}

interface ThreadEntry {
  taskId: string;
  title: string;
  kind?: "chat" | "routine" | "branch";
  archived?: true;
  current?: true;
  outcome?: string;
  lastActivityAt: string | null;
  lastRequest?: string;
  lastReply?: string;
}

const REQUEST_EXCERPT = 200;
const REPLY_EXCERPT = 400;

function excerptText(text: string, size: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length <= size) return line;
  const cut = line.slice(0, size - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > size / 2 ? cut.slice(0, space) : cut}…`;
}
interface HistoryEntry {
  taskId?: string;
  messageId: string;
  author: string;
  sentTo?: string[];
  createdAt: string;
  answeredBy?: { id: string; name: string };
  text: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
  attachments: { id: string; name: string; mimeType: string; size: number }[];
  beforeNewChat?: true;
  workSteps?: string;
  workStepsOffset?: number;
  nextWorkStepsOffset?: number | null;
  attachmentsOmitted?: number;
  page?: string;
  quiet?: string;
}

export class HistoryTools {
  readonly #options: HistoryToolOptions;
  constructor(options: HistoryToolOptions) {
    this.#options = options;
  }

  readonly threads = Effect.fn("HistoryTools.threads")(function* (
    this: HistoryTools,
    agentId: string,
    currentThreadId: string,
    args: unknown,
  ) {
    const input = yield* toolStep(() => searchSchema.parse(args ?? {}));
    if (input.query !== undefined || input.taskId !== undefined)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    const cursor = input.cursor === undefined ? null : readListCursor(input.cursor);
    const now = Date.now();
    const after = cursor ? cursor.after : input.after === undefined ? null : windowBound(input.after, now);
    const limit = input.limit ?? 8;
    const store = this.#options.store;
    const redact = (text: string) => this.#options.redact(redactSecrets(text));
    const latest = (threadId: string, author: "user" | "assistant") =>
      store.database.readAgentHistory(agentId, threadId, { author, acrossResets: true, limit: 1 }).messages[0]
        ?.message ?? null;
    const shown = (entry: ThreadEntry) => after === null || (entry.lastActivityAt ?? "") >= after;
    const listed = yield* toolStep(() => {
      const entry = (taskId: string, threadId: string, record: AgentThreadRecord | null): ThreadEntry => {
        const request = latest(threadId, "user");
        const reply = latest(threadId, "assistant");
        const messages = [request?.createdAt, reply?.createdAt].filter(
          (value): value is string => typeof value === "string",
        );
        const activity = messages.length > 0 ? messages : record ? [record.updatedAt] : [];
        const kind = !record ? "chat" : record.routineId ? "routine" : record.branch ? "branch" : null;
        const title = record ? excerptText(redact(record.title), REQUEST_EXCERPT) : "Main chat";
        const lastRequest = request ? excerptText(redact(request.text), REQUEST_EXCERPT) : null;
        return {
          taskId,
          title,
          ...(kind ? { kind } : {}),
          ...(record?.closedAt ? { archived: true as const } : {}),
          ...(threadId === currentThreadId ? { current: true as const } : {}),
          ...(record?.outcome ? { outcome: record.outcome } : {}),
          lastActivityAt: activity.sort().at(-1) ?? null,
          ...(lastRequest && lastRequest !== title ? { lastRequest } : {}),
          ...(reply ? { lastReply: excerptText(redact(reply.text), REPLY_EXCERPT) } : {}),
        };
      };
      const mainThreadId =
        input.cursor === undefined ? (store.list().find((agent) => agent.id === agentId)?.threadId ?? null) : null;
      const main = mainThreadId ? entry(MAIN_CHAT_TASK_ID, mainThreadId, null) : null;
      const mainShown = main !== null && shown(main) ? main : null;
      const records = this.#options.recentThreads(agentId, after, limit + 1, cursor?.last ?? null);
      const page = records
        .slice(0, limit - (mainShown ? 1 : 0))
        .map((record) => ({ record, entry: entry(record.taskId, record.threadId, record) }));
      return { main: mainShown, page, more: records.length > page.length };
    });
    const { main, page } = listed;
    let more = listed.more;
    const answer = () => {
      const last = page.at(-1)?.record;
      return openBotToolResult({
        now: new Date(now).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        threads: [...(main ? [main] : []), ...page.map((item) => item.entry).filter(shown)].sort((left, right) =>
          (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""),
        ),
        more,
        ...(more
          ? { nextCursor: listCursor(after, last ? { updatedAt: last.updatedAt, threadId: last.threadId } : null) }
          : {}),
        next: more
          ? "Send nextCursor as cursor, with no query, for older chats. history_read with a taskId reads one."
          : "history_read with a taskId reads one.",
      });
    };
    let result = answer();
    while (JSON.stringify(result).length > THREADS_RESULT_CHARACTERS && page.length > (main ? 0 : 1)) {
      page.pop();
      more = true;
      result = answer();
    }
    return result;
  }).bind(this);

  readonly call = (agentId: string, threadId: string, tool: string, args: unknown) =>
    this.#page(agentId, threadId, tool, args).pipe(Effect.map(openBotToolResult));

  readonly searchAll = Effect.fn("HistoryTools.searchAll")(function* (
    this: HistoryTools,
    agentId: string,
    currentThreadId: string,
    args: unknown,
  ) {
    const input = yield* toolStep(() => searchSchema.parse(args));
    if (input.query === undefined || input.taskId !== undefined || input.cursor !== undefined)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    const after = input.after === undefined ? null : windowBound(input.after, Date.now());
    const limit = input.limit ?? 5;
    const conversations = yield* toolStep(() => this.#conversations(agentId, after, SEARCH_ALL_THREADS));
    const ordered = [
      ...conversations.filter((conversation) => conversation.threadId === currentThreadId),
      ...conversations.filter((conversation) => conversation.threadId !== currentThreadId),
    ];
    if (!ordered.some((conversation) => conversation.threadId === currentThreadId))
      ordered.unshift({ taskId: null, threadId: currentThreadId, record: null });
    const result: { messages: HistoryEntry[]; nextCursor?: string; more: boolean; next: string } = {
      messages: [],
      more: conversations.filter((conversation) => conversation.record !== null).length >= SEARCH_ALL_THREADS,
      next: "nextCursor continues this chat; a taskId searches another one further.",
    };
    for (const conversation of ordered) {
      if (result.messages.length === limit) {
        result.more = true;
        break;
      }
      const current = conversation.threadId === currentThreadId;
      const read = this.#page(agentId, conversation.threadId, "history_search", {
        query: input.query,
        limit: limit - result.messages.length,
        ...(input.after === undefined ? {} : { after: input.after }),
      });
      const page = current
        ? yield* read
        : yield* read.pipe(
            Effect.catch(() => Effect.succeed(null)),
            Effect.catchDefect(() => Effect.succeed(null)),
          );
      if (page === null) continue;
      if (page.nextCursor !== null) {
        result.more = true;
        if (current) result.nextCursor = page.nextCursor;
      }
      for (const message of page.messages) {
        result.messages.push(
          current || conversation.taskId === null ? message : { taskId: conversation.taskId, ...message },
        );
      }
      let cut = false;
      while (JSON.stringify(openBotToolResult(result)).length > SEARCH_ALL_CHARACTERS && result.messages.length > 1) {
        result.messages.pop();
        cut = true;
      }
      if (cut) {
        result.more = true;
        break;
      }
    }
    if (result.messages.length === 0 && !result.more) result.next = `${NO_MATCH_HINT} ${result.next}`;
    return openBotToolResult(result);
  }).bind(this);

  #conversations(
    agentId: string,
    after: string | null,
    limit: number,
  ): Array<{ taskId: string | null; threadId: string; record: AgentThreadRecord | null }> {
    const mainThreadId = this.#options.store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
    return [
      ...(mainThreadId ? [{ taskId: MAIN_CHAT_TASK_ID, threadId: mainThreadId, record: null }] : []),
      ...this.#options
        .recentThreads(agentId, after, limit, null)
        .map((record) => ({ taskId: record.taskId, threadId: record.threadId, record })),
    ];
  }

  readonly #page = Effect.fn("HistoryTools.page")(function* (
    this: HistoryTools,
    agentId: string,
    threadId: string,
    tool: string,
    args: unknown,
  ) {
    const search = tool === "history_search" ? yield* toolStep(() => searchSchema.parse(args)) : null;
    const read = search ? null : yield* toolStep(() => readSchema.parse(args));
    const searchQuery = search?.query;
    if (search && searchQuery === undefined) throw new Error(sourceText("error.agent.historyUnavailable"));
    const terms = searchQuery === undefined ? [] : searchTerms(searchQuery);
    const after = search?.after === undefined ? null : windowBound(search.after, Date.now());
    const store = this.#options.store;
    const redact = (text: string) => this.#options.redact(redactSecrets(text));
    const query = search?.query;
    const limit = search?.limit ?? read?.limit ?? (search ? 5 : 10);
    const searchCursor = search?.cursor;
    const cursor = searchCursor
      ? yield* toolStep(() => decodeCursor(searchCursor))
      : read?.before
        ? readCursor(read.before)
        : null;
    const beforeMessageId = read?.before !== undefined && cursor === null ? read.before : null;
    if (cursor && (cursor.threadId !== threadId || cursor.query !== (query ?? null)))
      throw new Error(sourceText("error.agent.historyUnavailable"));
    const scanLimit = search ? SEARCH_SCAN_ROWS : limit;
    const selection = {
      outgoing: true,
      acrossResets: true,
      limit: read?.messageId ? 1 : scanLimit + 1,
      ...(cursor ? { before: cursor.anchorMessageId } : beforeMessageId ? { before: beforeMessageId } : {}),
      ...(read?.messageId ? { messageId: read.messageId } : {}),
    };
    const page = yield* toolStep(() => {
      try {
        return store.database.readAgentHistory(agentId, threadId, selection);
      } catch (error) {
        if (error instanceof HistoryReferenceUnavailable && read?.messageId !== undefined)
          throw unknownReference("messageId", read.messageId);
        if (error instanceof HistoryReferenceUnavailable && beforeMessageId !== null)
          throw unknownReference("before", beforeMessageId);
        throw error;
      }
    });
    if (cursor && cursor.resetMessageId !== page.resetMessageId)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    const nextCursor = (messageId: string) =>
      Buffer.from(
        JSON.stringify({
          version: 1,
          threadId,
          resetMessageId: page.resetMessageId,
          anchorMessageId: messageId,
          query: query ?? null,
        }),
      ).toString("base64url");
    const result: { messages: HistoryEntry[]; nextCursor: string | null; order: string; next?: string } = {
      messages: [],
      nextCursor: null,
      order: "newest-first",
      ...(read ? { next: READ_CURSOR_HINT } : {}),
    };
    const maximum = search ? 8000 : 16000;
    const sessions = read?.includeWorkSteps ? store.database.listProviderSessions(threadId) : [];
    const captures = new Map<string, Map<string, string> | null>();
    const traces = new Map<string, string | null>();
    let more = page.messages.length > scanLimit;
    for (const row of page.messages.slice(0, scanLimit)) {
      if (result.messages.length === limit) {
        more = true;
        break;
      }
      const message = row.message;
      if (after !== null && message.createdAt < after) {
        more = false;
        break;
      }
      const visual = chatVisualReply(message);
      const pageText = visual && read?.messageId ? yield* this.#options.pageText(visual.attachment.id) : null;
      const text = redact(pageText ? `${message.text}\n\n${pageText}` : message.text);
      const match = searchMatch(text, terms);
      if (match < 0) {
        result.nextCursor = nextCursor(message.id);
        continue;
      }
      let offset = read?.offset ?? 0;
      if (offset > text.length) throw new Error(sourceText("error.agent.historyUnavailable"));
      if (search) offset = Math.max(0, match - 100);
      const excerpt = text.slice(offset, offset + (search ? 400 : 12000));
      const sentTo = message.exchange?.direction === "outgoing" ? message.exchange.recipientAgentIds : null;
      const answeredBy = message.uiBlock?.state.respondedBy;
      const entry: HistoryEntry = {
        messageId: message.id,
        author: sentTo ? "assistant" : message.author,
        ...(sentTo ? { sentTo } : {}),
        createdAt: message.createdAt,
        ...(answeredBy ? { answeredBy: { id: answeredBy.id, name: redact(answeredBy.name) } } : {}),
        ...(row.beforeReset ? { beforeNewChat: true as const } : {}),
        text: excerpt,
        offset,
        nextOffset: offset + excerpt.length < text.length ? offset + excerpt.length : null,
        totalCharacters: text.length,
        attachments: search
          ? []
          : (message.attachments ?? []).map((file) => ({
              id: file.id,
              name: redact(file.name),
              mimeType: redact(file.mimeType),
              size: file.size,
            })),
        ...(visual && !read?.messageId
          ? {
              page: "history_read with this messageId, and the taskId of this entry if it has one, gives the page text.",
            }
          : {}),
        ...(message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE
          ? {
              quiet:
                "Ended with nothing to report: no notification. The chat folds it under its run or update; the phone app does not show it.",
            }
          : {}),
      };
      if (read?.includeWorkSteps) {
        const session = sessions.find((candidate) => candidate.id === row.providerSessionId);
        if (session && !captures.has(session.id)) captures.set(session.id, yield* this.#options.capturedSteps(session));
        let steps = session && message.turnId ? captures.get(session.id)?.get(message.turnId) : undefined;
        const turnId = message.turnId;
        if (!steps && turnId) {
          if (!traces.has(turnId)) {
            const trace = yield* toolStep(() => store.database.readTurnTrace(threadId, turnId));
            traces.set(turnId, trace ? traceSteps(trace) : null);
          }
          steps = traces.get(turnId) ?? undefined;
        }
        const stepText = redact(steps ?? "Captured work steps are unavailable.");
        const stepOffset = read.workStepsOffset ?? 0;
        if (stepOffset > stepText.length) throw new Error(sourceText("error.agent.historyUnavailable"));
        let size = Math.min(4000, stepText.length - stepOffset);
        while (JSON.stringify(JSON.stringify(stepText.slice(stepOffset, stepOffset + size))).length > 6000)
          size = Math.floor(size / 2);
        entry.workSteps = stepText.slice(stepOffset, stepOffset + size);
        entry.workStepsOffset = stepOffset;
        entry.nextWorkStepsOffset = stepOffset + size < stepText.length ? stepOffset + size : null;
      }
      result.messages.push(entry);
      result.nextCursor = nextCursor(message.id);
      if (JSON.stringify(openBotToolResult(result)).length > maximum) {
        if (result.messages.length > 1) {
          result.messages.pop();
          result.nextCursor = nextCursor(result.messages.at(-1)?.messageId ?? message.id);
          more = true;
          break;
        }
        entry.attachmentsOmitted = entry.attachments.length;
        entry.attachments = [];
        let low = 0;
        let high = entry.text.length;
        const original = entry.text;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          entry.text = original.slice(0, mid);
          entry.nextOffset = offset + mid;
          if (JSON.stringify(openBotToolResult(result)).length <= maximum) low = mid;
          else high = mid - 1;
        }
        entry.text = original.slice(0, low);
        entry.nextOffset = offset + low < text.length ? offset + low : null;
      }
    }
    if (!more) result.nextCursor = null;
    if (result.nextCursor === null) delete result.next;
    for (const entry of result.messages) {
      const checked = yield* toolStep(() =>
        store.database.readAgentHistory(agentId, threadId, {
          messageId: entry.messageId,
          outgoing: true,
          acrossResets: true,
          limit: 1,
        }),
      );
      if (
        checked.resetMessageId !== page.resetMessageId ||
        checked.messages.length !== 1 ||
        readContent(checked.messages[0]?.message) !==
          readContent(page.messages.find((row) => row.message.id === entry.messageId)?.message)
      )
        throw new Error(sourceText("error.agent.historyUnavailable"));
    }
    if (JSON.stringify(openBotToolResult(result)).length > maximum)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    return result;
  }).bind(this);
}
