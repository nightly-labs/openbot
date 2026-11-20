import { isAttachmentSummary } from "../ipc-attachments";
import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import type { ConversationFileSearchPage, ConversationFileSearchResult } from "../ipc-conversations";
import { isDynamicRecord } from "../runtime-values";
import {
  adminRoute,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const CONVERSATION_FILE_SEARCH_CAPABILITY = "conversation-file-search-v1";

export const CONVERSATION_FILE_SEARCH_ROUTES = {
  search: "/v1/conversation-files/search",
} as const;

export const CONVERSATION_FILE_SEARCH_PAGE_LIMIT = 100;

export type ConversationFileSearchRequest = { query: string; cursor: string | null; limit?: number };

const QUERY_LIMIT = 255;
const CURSOR_LIMIT = 2_048;
const CREATED_AT_LIMIT = 64;

const attachment = fields({
  id: identifier,
  name: string(255),
  size: count,
  kind: oneOf("image", "file"),
  mimeType: string(255),
  previewKind: oneOf("image", "pdf", "text", "none"),
  previewUrl: nullable(string(2_048)),
});

export const CONVERSATION_FILE_SEARCH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    CONVERSATION_FILE_SEARCH_ROUTES.search,
    adminRoute(
      fields({ query: string(QUERY_LIMIT), cursor: nullable(string(CURSOR_LIMIT)) }, { limit: count }),
      fields({
        results: list(
          fields({ agentId: identifier, messageId: identifier, createdAt: string(CREATED_AT_LIMIT), attachment }),
          CONVERSATION_FILE_SEARCH_PAGE_LIMIT,
        ),
        nextCursor: nullable(string(CURSOR_LIMIT)),
      }),
    ),
  ],
]);

function decodeResult(value: unknown): ConversationFileSearchResult {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !isIdentifier(value.messageId) ||
    !isBoundedString(value.createdAt, CREATED_AT_LIMIT) ||
    !isAttachmentSummary(value.attachment)
  )
    throw new Error("Invalid conversation file search result.");
  return {
    agentId: value.agentId,
    messageId: value.messageId,
    createdAt: value.createdAt,
    attachment: value.attachment,
  };
}

export function decodeConversationFileSearchResponse(value: unknown): ConversationFileSearchPage {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.results) ||
    value.results.length > CONVERSATION_FILE_SEARCH_PAGE_LIMIT ||
    !(value.nextCursor === null || isBoundedString(value.nextCursor, CURSOR_LIMIT))
  )
    throw new Error("Invalid conversation file search page.");
  return { results: value.results.map(decodeResult), nextCursor: value.nextCursor };
}
