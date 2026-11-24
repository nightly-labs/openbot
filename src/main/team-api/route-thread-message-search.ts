import type { ConversationSearchPage } from "@openbot/contracts/ipc";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  THREAD_MESSAGE_SEARCH_CAPABILITY,
  THREAD_MESSAGE_SEARCH_PAGE_LIMIT,
  THREAD_MESSAGE_SEARCH_ROUTES,
} from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { messageTextCut, nullableString, readJson, WEBRTC_FRAME_BODY_BUDGET } from "./request-helpers";

const DEFAULT_PAGE_SIZE = 50;

export function searchPageWithinFrame(
  search: (limit: number) => ConversationSearchPage,
  limit: number,
): ConversationSearchPage {
  let page = search(limit);
  let bytes = Buffer.byteLength(JSON.stringify(page));
  if (bytes > WEBRTC_FRAME_BODY_BUDGET) {
    let kept = 0;
    let size = Buffer.byteLength(JSON.stringify({ ...page, results: [] }));
    for (const result of page.results) {
      size += Buffer.byteLength(JSON.stringify(result)) + 1;
      if (size > WEBRTC_FRAME_BODY_BUDGET) break;
      kept += 1;
    }
    page = search(Math.max(1, kept));
    bytes = Buffer.byteLength(JSON.stringify(page));
  }
  if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return page;
  const cut = messageTextCut(
    page.results.map((result) => result.message),
    bytes - WEBRTC_FRAME_BODY_BUDGET,
  );
  return { ...page, results: page.results.map((result) => ({ ...result, message: cut(result.message) })) };
}

export async function routeThreadMessageSearch(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "searchConversationMessages">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== THREAD_MESSAGE_SEARCH_ROUTES.search) return "unmatched";
  if (!capabilities.has(THREAD_MESSAGE_SEARCH_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.threadMessageSearchUnsupported"));
  const body = await readJson(request);
  const query = isString(body.query) ? body.query : "";
  if (!query.trim()) throw new HttpError(400, sourceText("error.team.searchQueryRequired"));
  const agentId = nullableString(body, "agentId", 255) ?? undefined;
  if (agentId !== undefined && hiddenAgentIds.has(agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  const cursor = nullableString(body, "cursor", 512) ?? undefined;
  const limit = isNumber(body.limit)
    ? Math.min(Math.max(body.limit, 1), THREAD_MESSAGE_SEARCH_PAGE_LIMIT)
    : DEFAULT_PAGE_SIZE;
  const page = searchPageWithinFrame(
    (size) => agents.searchConversationMessages(query, agentId, cursor, size, true),
    limit,
  );
  return json(200, { ...page, results: page.results.map((result) => ({ ...result, taskId: result.taskId ?? null })) });
}
