import { hostAgentMemoryLimit, isAgentMemoryLimit } from "@openbot/contracts/ipc";
import {
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_MEMORY_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** How many memories each agent of this computer can keep, read and set from a joined server. Frozen by `agent-memory-limit-v1`. */
export async function routeAgentMemoryLimit(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== AGENT_MEMORY_LIMIT_ROUTES.settings && url.pathname !== AGENT_MEMORY_LIMIT_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.memoryLimit;
  if (!setting || !capabilities.has(AGENT_MEMORY_LIMIT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentMemoryLimitUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === AGENT_MEMORY_LIMIT_ROUTES.settings) return json(200, hostAgentMemoryLimit(setting.get()));
  // The snapshot names every value this host permits, so only a malformed request sends another.
  if (!isAgentMemoryLimit(body.limit)) throw new HttpError(400, "Agent memory limit is required.");
  return json(200, hostAgentMemoryLimit(await runCauseEffect(setting.set({ limit: body.limit }))));
}
