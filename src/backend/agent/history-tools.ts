import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentStore } from "../agent-store";
import type { ProviderSession } from "../database/provider-sessions";
import { openBotToolResult } from "./routine-tools";
import { type ToolOperationFailed, toolStep } from "./tool-operation";

const id = z.string().min(1).max(512);
const cursorText = z.string().min(1).max(4096);
/** Messages one search call reads before it returns a cursor, whether or not they match. */
const SEARCH_SCAN_ROWS = 200;
const searchShape = {
  query: z.string().trim().min(1).max(200),
  cursor: cursorText.optional(),
  limit: z.number().int().min(1).max(10).optional(),
};
const readShape = {
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

export const HISTORY_TOOL_DEFINITIONS = [
  {
    name: "history_search",
    description:
      "Search messages in this conversation after its latest context reset. Returns bounded excerpts and a cursor; use history_read for omitted text. Does not search other chats or channels.",
    shape: searchShape,
  },
  {
    name: "history_read",
    description:
      "Read current-conversation history after its latest reset. Read a messageId with offset for large text, or use before from an earlier response for older messages. Optional captured work steps contain no raw reasoning; continue them with workStepsOffset from nextWorkStepsOffset. Channels use channel_history.",
    shape: readShape,
  },
];

interface HistoryToolOptions {
  store: AgentStore;
  redact(text: string): string;
  capturedSteps(session: ProviderSession): Effect.Effect<Map<string, string> | null, ToolOperationFailed>;
}
interface HistoryEntry {
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

  readonly call = Effect.fn("HistoryTools.call")(function* (
    this: HistoryTools,
    agentId: string,
    threadId: string,
    tool: string,
    args: unknown,
  ) {
    const search = tool === "history_search" ? yield* toolStep(() => searchSchema.parse(args)) : null;
    const read = search ? null : yield* toolStep(() => readSchema.parse(args));
    const store = this.#options.store;
    const redact = (text: string) => this.#options.redact(redactText(text));
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
    let more = page.messages.length > scanLimit;
    for (const row of page.messages.slice(0, scanLimit)) {
      if (result.messages.length === limit) {
        more = true;
        break;
      }
      const message = row.message;
      const text = redact(message.text);
      const match = search ? text.toLowerCase().indexOf(search.query.toLowerCase()) : 0;
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
        const stepText = redact(
          (session && message.turnId ? captures.get(session.id)?.get(message.turnId) : null) ??
            "Captured work steps are unavailable.",
        );
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
    return openBotToolResult(result);
  }).bind(this);
}
