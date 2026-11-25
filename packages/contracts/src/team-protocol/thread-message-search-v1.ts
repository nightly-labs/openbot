import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import { isConversationMessage } from "../ipc-conversation-messages";
import type { ConversationSearchPage } from "../ipc-conversations";
import { isDynamicRecord, isNumber } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { toCurrentAgentKeys, toWireAgentKeys } from "./current-agent-keys";
import { isProviderAwareConversationSearch, projectProviderAwareConversationSearch } from "./provider-aware-codec";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const THREAD_MESSAGE_SEARCH_CAPABILITY = "thread-message-search-v1";

export const THREAD_MESSAGE_SEARCH_ROUTES = {
  search: "/v1/messages/search-threads",
} as const;

export const THREAD_MESSAGE_SEARCH_PAGE_LIMIT = 100;

export type ThreadMessageSearchRequest = {
  query: string;
  agentId: string | null;
  cursor: string | null;
  limit?: number;
};

const QUERY_LIMIT = 100_000;
const CURSOR_LIMIT = 512;
const REQUEST_KEYS = ["query", "agentId", "cursor", "limit"];

const requestFields = fields(
  { query: string(QUERY_LIMIT), agentId: nullable(identifier), cursor: nullable(string(CURSOR_LIMIT)) },
  { limit: count },
);
const request: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !REQUEST_KEYS.includes(key)))
    throw new Error("Invalid thread message search request.");
  return requestFields(input);
};

const page: AdminDecoder = (input) => {
  if (
    !isDynamicRecord(input) ||
    !Array.isArray(input.results) ||
    input.results.length > THREAD_MESSAGE_SEARCH_PAGE_LIMIT
  )
    throw new Error("Invalid thread message search page.");
  const taskIds = input.results.map((result) => {
    const taskId = isDynamicRecord(result) ? result.taskId : undefined;
    if (taskId !== null && !isIdentifier(taskId)) throw new Error("Invalid thread message search task.");
    return taskId;
  });
  const copy: TeamProtocolV2Json = JSON.parse(JSON.stringify(input));
  const wire = toWireAgentKeys(copy);
  if (!isProviderAwareConversationSearch(wire)) throw new Error("Invalid thread message search page.");
  const projected = projectProviderAwareConversationSearch(wire);
  const results = Array.isArray(projected.results) ? projected.results : [];
  return toCurrentAgentKeys({
    ...projected,
    results: results.map((result, index) =>
      isDynamicRecord(result) ? { ...result, taskId: taskIds[index] ?? null } : result,
    ),
  });
};

export const THREAD_MESSAGE_SEARCH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [THREAD_MESSAGE_SEARCH_ROUTES.search, adminRoute(request, page)],
]);

export function decodeThreadMessageSearchResponse(value: unknown): ConversationSearchPage {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.results) ||
    !isNumber(value.total) ||
    !(value.nextCursor === null || isBoundedString(value.nextCursor, CURSOR_LIMIT))
  )
    throw new Error("Invalid thread message search page.");
  return {
    results: value.results.map((result) => {
      if (
        !isDynamicRecord(result) ||
        !isIdentifier(result.agentId) ||
        !isConversationMessage(result.message) ||
        !(result.taskId === null || isIdentifier(result.taskId))
      )
        throw new Error("Invalid thread message search result.");
      return {
        agentId: result.agentId,
        message: result.message,
        ...(result.taskId === null ? {} : { taskId: result.taskId }),
      };
    }),
    total: value.total,
    nextCursor: value.nextCursor,
  };
}
