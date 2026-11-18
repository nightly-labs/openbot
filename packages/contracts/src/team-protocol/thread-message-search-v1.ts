// Frozen optional thread-message-search-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can
// search the messages of the agent chats of the host and of the side threads of those agents, with
// the text match of the released `GET /v1/messages/search`. The member can already read each of these
// chats and threads. The host leaves out archived threads, as the desktop search does. Each result
// names the agent, the message and, for a message in a side thread, the task of that thread
// (`taskId`), which `agent-tasks-v1` opens. A message is checked with the released message-search
// validator and carries only its message keys. The host leaves out the results of an agent that the
// client cannot see; `total` counts as the released route counts. At most 100 results cross in one
// page, and the host cuts long message text so that a page fits one frame. `nextCursor` is opaque and
// only this route reads it. A request key outside the contract is refused. Widening any of it needs a
// second capability string.
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
import type { TeamProtocolV2Json } from "./v2";

export const THREAD_MESSAGE_SEARCH_CAPABILITY = "thread-message-search-v1";

export const THREAD_MESSAGE_SEARCH_ROUTES = {
  search: "/v1/messages/search-threads",
} as const;

/** The most results one page carries. The host also uses it as the largest `limit`. */
export const THREAD_MESSAGE_SEARCH_PAGE_LIMIT = 100;

/** The body a client sends. A null `agentId` searches every agent; an absent `limit` gives 50. */
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
/** A key outside the contract is refused, not dropped. */
const request: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !REQUEST_KEYS.includes(key)))
    throw new Error("Invalid thread message search request.");
  return requestFields(input);
};

/**
 * The page has the keys of the released message-search route, and each result also has `taskId`.
 * The released validator and projection run on the page without `taskId`, in the wire spelling.
 */
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

/**
 * The page a host answers, as the client type. The transport has already run the response through
 * the codec above; this gives it the type that the client reads.
 */
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
