import { CONVERSATION_TRACE_STEP_LIMIT, type ConversationTurnTrace } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactSecrets } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentStore } from "../agent-store";
import type { AgentThreadRecord } from "../agent-threads/agent-thread-store";
import type { ProviderSession } from "../database/provider-sessions";
import { openBotToolResult } from "./routine-tools";
import { type ToolOperationFailed, toolStep } from "./tool-operation";

/** The `taskId` that names the agent's own chat, from a side thread. Task and thread ids have a prefix. */
export const MAIN_CHAT_TASK_ID = "main";
/** The size of one list of conversations, as the other history answers are bounded. */
const THREADS_RESULT_CHARACTERS = 8_000;
const RELATIVE_BOUND = /^(\d{1,4})([mhdw])$/;
const DATE_BOUND = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UNIT_MS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/**
 * A time bound as an ISO instant: a relative age such as `24h` or `7d` before `now`, a date (midnight
 * of the host's time zone), or an ISO date and time. Null when the text is none of them.
 */
function windowBound(text: string, now: number): string | null {
  if (text.length > 40) return null;
  const relative = RELATIVE_BOUND.exec(text);
  const unit = relative ? UNIT_MS[relative[2] ?? ""] : undefined;
  if (relative && unit !== undefined) return new Date(now - Number(relative[1]) * unit).toISOString();
  const date = DATE_BOUND.exec(text);
  if (date) {
    const day = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    // `Date` rolls 2026-02-30 over to March; refuse a day that does not exist.
    return day.getDate() === Number(date[3]) && day.getMonth() === Number(date[2]) - 1 ? day.toISOString() : null;
  }
  // Only an ISO time: V8 parses loose text such as "1" or "June" as a year-2001 date.
  const time = ISO_TIME.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * The tool steps of a turn trace, in the form of a capture. Null when the turn has no tool step.
 * Thinking and answers stay out: the answers are in the history, and reasoning stays with the provider.
 */
function traceSteps(trace: ConversationTurnTrace): string | null {
  const steps = trace.steps.flatMap((step) => {
    if (step.kind !== "tool") return [];
    const status = step.failed ? "failed" : step.endedAt === null ? "unfinished" : "completed";
    const name = step.command ? `$ ${step.command}` : `tool ${step.text ?? "step"}`;
    return [[`${name} (${status})`, ...(step.error ? [step.error] : [])].join("\n")];
  });
  if (!steps.length) return null;
  // The trace keeps only the first steps of a turn.
  const cut = trace.steps.length >= CONVERSATION_TRACE_STEP_LIMIT ? ["(later steps left out)"] : [];
  return ["[work steps]", ...steps, ...cut, "[end work steps]"].join("\n");
}

const id = z.string().min(1).max(512);
const cursorText = z.string().min(1).max(4096);
/** Conversations and characters of one search across all conversations. */
const SEARCH_ALL_THREADS = 8;
const SEARCH_ALL_CHARACTERS = 8_000;
/** Messages one search call reads before it returns a cursor, whether or not they match. */
const SEARCH_SCAN_ROWS = 200;
/** A side thread of the calling agent, or `main` for its own chat. The router checks the owner. */
const taskId = id.optional();
/**
 * Without `query`, `history_search` lists the agent's conversations, as `session_search` without a
 * query browses sessions in Hermes. One tool keeps the catalog small.
 */
const searchShape = {
  taskId,
  // An empty query matches every message. `windowBound` limits `after`, which keeps the catalog schema small.
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
const searchSchema = z.strictObject(searchShape);
const readSchema = z
  .strictObject(readShape)
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

/** Whether a `history_search` call lists conversations: no arguments, or no query and no taskId. */
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
      "Read this chat, or one by taskId, after its latest reset. Read a messageId with offset for large text, or use before from an earlier response for older messages. Optional captured work steps contain no raw reasoning; continue them with workStepsOffset from nextWorkStepsOffset. Channels use channel_history.",
    shape: readShape,
  },
];

interface HistoryToolOptions {
  store: AgentStore;
  redact(text: string): string;
  capturedSteps(session: ProviderSession): Effect.Effect<Map<string, string> | null, ToolOperationFailed>;
  /** The agent's side threads, open and archived, with activity at or after `after`. The latest first. */
  recentThreads(agentId: string, after: string | null, limit: number): readonly AgentThreadRecord[];
}

/**
 * One conversation in a list. Fields with no value are left out: the list goes to the model on each
 * call, so every byte costs tokens.
 */
interface ThreadEntry {
  taskId: string;
  title: string;
  /** Absent for a plain side thread. */
  kind?: "chat" | "routine" | "branch";
  archived?: true;
  outcome?: string;
  lastActivityAt: string | null;
  lastRequest?: string;
  lastReply?: string;
}

/** Excerpt sizes of one list entry. The reply usually says what was done, so it gets more room. */
const REQUEST_EXCERPT = 200;
const REPLY_EXCERPT = 400;

/** One line of at most `size` characters, cut at a word, with an ellipsis when it was cut. */
function excerptText(text: string, size: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length <= size) return line;
  const cut = line.slice(0, size - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > size / 2 ? cut.slice(0, space) : cut}…`;
}
interface HistoryEntry {
  /** Set in a search across conversations, for a message of another conversation. */
  taskId?: string;
  messageId: string;
  author: string;
  createdAt: string;
  text: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
  attachments: { id: string; name: string; mimeType: string; size: number }[];
  workSteps?: string;
  workStepsOffset?: number;
  nextWorkStepsOffset?: number | null;
  attachmentsOmitted?: number;
}

/** Owns bounded model-facing history output. Scope is supplied by the authenticated router. */
export class HistoryTools {
  readonly #options: HistoryToolOptions;
  constructor(options: HistoryToolOptions) {
    this.#options = options;
  }

  /**
   * Lists the agent's own chat and its side threads with activity in a time window, the latest first,
   * each with its last request and reply after its latest reset. Like `session_search` without a query
   * in Hermes: stored messages only, no generation. All reads are in one synchronous step.
   */
  readonly threads = Effect.fn("HistoryTools.threads")(function* (
    this: HistoryTools,
    agentId: string,
    currentThreadId: string,
    args: unknown,
  ) {
    const input = yield* toolStep(() => searchSchema.parse(args ?? {}));
    if (input.query !== undefined || input.taskId !== undefined || input.cursor !== undefined)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    const now = Date.now();
    const after = input.after === undefined ? null : windowBound(input.after, now);
    const limit = input.limit ?? 8;
    const store = this.#options.store;
    const redact = (text: string) => this.#options.redact(redactSecrets(text));
    // Redact the whole message before the cut, so that a cut never splits a secret out of a match.
    const latest = (threadId: string, author: "user" | "assistant") =>
      store.database.readAgentHistory(agentId, threadId, { author, limit: 1 }).messages[0]?.message ?? null;
    const listed = yield* toolStep(() => {
      const conversations = this.#conversations(agentId, after, limit + 1);
      const records = conversations.filter((conversation) => conversation.record !== null);
      // The conversation of this call is left out: its messages are already in context.
      const candidates = conversations.filter((candidate) => candidate.threadId !== currentThreadId);
      const entries = candidates.map(({ taskId, threadId, record }): ThreadEntry => {
        const request = latest(threadId, "user");
        const reply = latest(threadId, "assistant");
        // Messages give the activity: an archive, a reopen or an outcome also moves `updatedAt`.
        const messages = [request?.createdAt, reply?.createdAt].filter(
          (value): value is string => typeof value === "string",
        );
        const activity = messages.length > 0 ? messages : record ? [record.updatedAt] : [];
        const kind = !record ? "chat" : record.routineId ? "routine" : record.branch ? "branch" : null;
        // The UI calls the agent's own chat its main chat; a model reads "own chat" as the current one.
        const title = record ? excerptText(redact(record.title), REQUEST_EXCERPT) : "Main chat";
        const lastRequest = request ? excerptText(redact(request.text), REQUEST_EXCERPT) : null;
        return {
          taskId: taskId ?? MAIN_CHAT_TASK_ID,
          title,
          ...(kind ? { kind } : {}),
          ...(record?.closedAt ? { archived: true as const } : {}),
          ...(record?.outcome ? { outcome: record.outcome } : {}),
          lastActivityAt: activity.sort().at(-1) ?? null,
          // A thread title is often its first request. Do not send the same text twice.
          ...(lastRequest && lastRequest !== title ? { lastRequest } : {}),
          ...(reply ? { lastReply: excerptText(redact(reply.text), REPLY_EXCERPT) } : {}),
        };
      });
      // The own chat has no row: it is older than every side thread, so only its activity is checked.
      const shown = entries
        .filter((entry) => after === null || (entry.lastActivityAt ?? "") >= after)
        .sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
      return { threads: shown.slice(0, limit), more: records.length > limit || shown.length > limit };
    });
    const result = {
      now: new Date(now).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      threads: listed.threads,
      more: listed.more,
      next: "history_read with a taskId reads one.",
    };
    while (JSON.stringify(openBotToolResult(result)).length > THREADS_RESULT_CHARACTERS && result.threads.length > 1) {
      result.threads.pop();
      result.more = true;
    }
    return openBotToolResult(result);
  }).bind(this);

  /** One search or read of one conversation, as a tool answer. */
  readonly call = (agentId: string, threadId: string, tool: string, args: unknown) =>
    this.#page(agentId, threadId, tool, args).pipe(Effect.map(openBotToolResult));

  /**
   * Searches all conversations of the agent for `query`: the current one first, then the main chat
   * and the side threads with activity since `after`, the latest first. A model asks "find X" without
   * a thread far more often than with one, so one call answers it. Each conversation is scanned as
   * one `history_search` page; there is no cursor across conversations.
   */
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
      // Another conversation can be deleted or change during the scan; its matches are left out.
      const page = current
        ? yield* read
        : yield* read.pipe(
            Effect.catch(() => Effect.succeed(null)),
            Effect.catchDefect(() => Effect.succeed(null)),
          );
      if (page === null) continue;
      if (page.nextCursor !== null) {
        result.more = true;
        // The cursor of this conversation continues with the same query and no taskId.
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
    return openBotToolResult(result);
  }).bind(this);

  /** The main chat and the side threads with activity at or after `after`, in one synchronous read. */
  #conversations(
    agentId: string,
    after: string | null,
    limit: number,
  ): Array<{ taskId: string | null; threadId: string; record: AgentThreadRecord | null }> {
    const mainThreadId = this.#options.store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
    return [
      ...(mainThreadId ? [{ taskId: MAIN_CHAT_TASK_ID, threadId: mainThreadId, record: null }] : []),
      ...this.#options
        .recentThreads(agentId, after, limit)
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
    const after = search?.after === undefined ? null : windowBound(search.after, Date.now());
    const store = this.#options.store;
    const redact = (text: string) => this.#options.redact(redactSecrets(text));
    const query = search?.query;
    const limit = search?.limit ?? read?.limit ?? (search ? 5 : 10);
    const suppliedCursor = search?.cursor ?? read?.before;
    const cursor = suppliedCursor
      ? yield* toolStep(() => cursorSchema.parse(JSON.parse(Buffer.from(suppliedCursor, "base64url").toString("utf8"))))
      : null;
    if (cursor && (cursor.threadId !== threadId || cursor.query !== (query ?? null)))
      throw new Error(sourceText("error.agent.historyUnavailable"));
    // Search matches redacted text in fixed scan batches. A SQL match on stored text would let
    // hits and misses reveal a redacted secret one character at a time.
    const scanLimit = search ? SEARCH_SCAN_ROWS : limit;
    const selection = {
      limit: read?.messageId ? 1 : scanLimit + 1,
      ...(cursor ? { before: cursor.anchorMessageId } : {}),
      ...(read?.messageId ? { messageId: read.messageId } : {}),
    };
    const page = yield* toolStep(() => store.database.readAgentHistory(agentId, threadId, selection));
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
    const result: { messages: HistoryEntry[]; nextCursor: string | null; order: string } = {
      messages: [],
      nextCursor: null,
      order: "newest-first",
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
      // Newest first: the first message before the window ends the search.
      if (after !== null && message.createdAt < after) {
        more = false;
        break;
      }
      const text = redact(message.text);
      const match = searchQuery === undefined ? 0 : text.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (match < 0) {
        result.nextCursor = nextCursor(message.id);
        continue;
      }
      let offset = read?.offset ?? 0;
      if (offset > text.length) throw new Error(sourceText("error.agent.historyUnavailable"));
      if (search) offset = Math.max(0, match - 100);
      const excerpt = text.slice(offset, offset + (search ? 400 : 12000));
      const entry: HistoryEntry = {
        messageId: message.id,
        author: message.author,
        createdAt: message.createdAt,
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
      };
      if (read?.includeWorkSteps) {
        const session = sessions.find((candidate) => candidate.id === row.providerSessionId);
        if (session && !captures.has(session.id)) captures.set(session.id, yield* this.#options.capturedSteps(session));
        let steps = session && message.turnId ? captures.get(session.id)?.get(message.turnId) : undefined;
        // Only a session that a provider switch or a rotation replaced has a capture. A turn of the
        // current session, such as a routine run, has the trace that the chat shows.
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
        // Even a single large message must be readable. Cut only after whole-value redaction.
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
    // File reads yield. Recheck reset and message existence before any content leaves the process.
    for (const entry of result.messages) {
      const checked = yield* toolStep(() =>
        store.database.readAgentHistory(agentId, threadId, { messageId: entry.messageId, limit: 1 }),
      );
      if (
        checked.resetMessageId !== page.resetMessageId ||
        checked.messages.length !== 1 ||
        JSON.stringify(checked.messages[0]?.message) !==
          JSON.stringify(page.messages.find((row) => row.message.id === entry.messageId)?.message)
      )
        throw new Error(sourceText("error.agent.historyUnavailable"));
    }
    if (JSON.stringify(openBotToolResult(result)).length > maximum)
      throw new Error(sourceText("error.agent.historyUnavailable"));
    return result;
  }).bind(this);
}
