import { isNumber } from "@openbot/contracts/runtime-values";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_PAGE_LIMIT,
  CONVERSATION_FILE_SEARCH_ROUTES,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, readJson, stringField } from "./request-helpers";

const DEFAULT_PAGE_SIZE = 50;

export async function routeConversationFiles(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "searchConversationFiles">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== CONVERSATION_FILE_SEARCH_ROUTES.search) return "unmatched";
  if (!capabilities.has(CONVERSATION_FILE_SEARCH_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.conversationFileSearchUnsupported"));
  const body = await readJson(request);
  const query = stringField(body, "query", true, 255);
  const cursor = nullableString(body, "cursor", 2_048);
  const limit = isNumber(body.limit)
    ? Math.min(Math.max(body.limit, 1), CONVERSATION_FILE_SEARCH_PAGE_LIMIT)
    : DEFAULT_PAGE_SIZE;
  return json(200, agents.searchConversationFiles(query, cursor ?? undefined, limit));
}
