import { isPromptCacheTtl } from "@openbot/contracts/ipc";
import {
  PROMPT_CACHE_TTL_CAPABILITY,
  PROMPT_CACHE_TTL_ROUTES,
} from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** How long this server asks the provider to keep the prompt cache, read and set from a joined server. Frozen by `prompt-cache-ttl-v1`. */
export async function routePromptCacheTtl(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== PROMPT_CACHE_TTL_ROUTES.settings && url.pathname !== PROMPT_CACHE_TTL_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.promptCacheTtl;
  if (!setting || !capabilities.has(PROMPT_CACHE_TTL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.promptCacheTtlUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === PROMPT_CACHE_TTL_ROUTES.settings) return json(200, setting.get());
  if (!isPromptCacheTtl(body.ttl)) throw new HttpError(400, "Prompt cache time is required.");
  return json(200, await runCauseEffect(setting.set(body.ttl)));
}
