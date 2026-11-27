import { hostRemoteChatContent } from "@openbot/contracts/ipc";
import {
  REMOTE_CHAT_CONTENT_CAPABILITY,
  REMOTE_CHAT_CONTENT_ROUTES,
} from "@openbot/contracts/team-protocol/remote-chat-content-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeRemoteChatContent(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== REMOTE_CHAT_CONTENT_ROUTES.settings && url.pathname !== REMOTE_CHAT_CONTENT_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.remoteChatContent;
  if (!setting || !capabilities.has(REMOTE_CHAT_CONTENT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.remoteChatContentUnsupported"));
  const body = await readJson(request);
  if (url.pathname === REMOTE_CHAT_CONTENT_ROUTES.settings) return json(200, hostRemoteChatContent(setting.get()));
  requireAdmin(member);
  if (typeof body.enabled !== "boolean") throw new HttpError(400, sourceText("error.team.remoteChatContentRequired"));
  return json(200, hostRemoteChatContent(await runCauseEffect(setting.set({ enabled: body.enabled }))));
}
