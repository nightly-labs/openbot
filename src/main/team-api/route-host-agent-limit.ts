import {
  HOST_AGENT_LIMIT_CAPABILITY,
  HOST_AGENT_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/host-agent-limit-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseHostAgentLimit } from "../host-agent-limit-preference-store";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeHostAgentLimit(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_AGENT_LIMIT_ROUTES.settings && url.pathname !== HOST_AGENT_LIMIT_ROUTES.update)
  )
    return "unmatched";
  const agentLimit = admin?.agentLimit;
  if (!agentLimit || !capabilities.has(HOST_AGENT_LIMIT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostAgentLimitUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === HOST_AGENT_LIMIT_ROUTES.settings) return json(200, agentLimit.get());
  let limit: number | null;
  try {
    limit = parseHostAgentLimit(body.limit);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : sourceText("error.host.agentLimitInvalid"));
  }
  return json(200, await runCauseEffect(agentLimit.set(limit)));
}
