import {
  CLIENT_BROWSER_CAPABILITY,
  CLIENT_BROWSER_ROUTES,
  decodeClientBrowserAnswer,
  decodeClientBrowserPresence,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiClientBrowser } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export async function routeClientBrowser(
  context: TeamApiRequestContext,
  clientBrowser: TeamApiClientBrowser | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CLIENT_BROWSER_ROUTES.presence && url.pathname !== CLIENT_BROWSER_ROUTES.result)
  )
    return "unmatched";
  if (!clientBrowser || !capabilities.has(CLIENT_BROWSER_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.clientBrowserUnsupported"));
  const body = await readJson(request);
  if (url.pathname === CLIENT_BROWSER_ROUTES.presence) {
    let presence: ReturnType<typeof decodeClientBrowserPresence>;
    try {
      presence = decodeClientBrowserPresence(body);
    } catch {
      throw new HttpError(400, sourceText("error.team.requestFailed"));
    }
    clientBrowser.setPresence(member.id, sessionId, presence);
    return json(200, {});
  }
  let answer: ReturnType<typeof decodeClientBrowserAnswer>;
  try {
    answer = decodeClientBrowserAnswer(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  if (!clientBrowser.resolve(member.id, sessionId, answer))
    throw new HttpError(404, sourceText("error.team.clientBrowserCommandUnknown"));
  return json(200, {});
}
