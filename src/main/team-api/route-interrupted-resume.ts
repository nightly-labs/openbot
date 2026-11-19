import {
  INTERRUPTED_RESUME_CAPABILITY,
  INTERRUPTED_RESUME_LIST_LIMIT,
  INTERRUPTED_RESUME_ROUTES,
} from "@openbot/contracts/team-protocol/interrupted-resume-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { memberSender, readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

/**
 * Interrupted-turn visibility and continuation for a joined client (`interrupted-resume-v1`).
 * Members see only agents visible to them and can continue only agents they are permitted to message.
 */
export async function routeInterruptedResume(
  context: TeamApiRequestContext,
  agents: Pick<
    TeamApiAgents,
    "listAgents" | "getRuntimeSnapshot" | "acknowledgeInterruptedTurn" | "continueInterrupted"
  >,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== INTERRUPTED_RESUME_ROUTES.list &&
      url.pathname !== INTERRUPTED_RESUME_ROUTES.continue &&
      url.pathname !== INTERRUPTED_RESUME_ROUTES.dismiss)
  ) {
    return "unmatched";
  }
  if (!capabilities.has(INTERRUPTED_RESUME_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.team.interruptedResumeUnsupported"));
  }
  const body = await readJson(request);
  if (url.pathname === INTERRUPTED_RESUME_ROUTES.list) {
    const snapshot = agents.getRuntimeSnapshot();
    return json(200, {
      interruptedTurns: (snapshot.interruptedTurns ?? [])
        .filter((turn) => !hiddenAgentIds.has(turn.agentId))
        .slice(0, INTERRUPTED_RESUME_LIST_LIMIT),
    });
  }
  if (url.pathname === INTERRUPTED_RESUME_ROUTES.dismiss) {
    const agentId = stringField(body, "agentId");
    const turnId = stringField(body, "turnId");
    if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireListedAgent(agents, agentId);
    requireAgentLevel(context, agentId, "chat");
    agents.acknowledgeInterruptedTurn(agentId, turnId);
    return json(200, {});
  }
  const requested = Array.isArray(body.agentIds)
    ? body.agentIds.filter((item): item is string => typeof item === "string")
    : [];
  const allowed: string[] = [];
  for (const agentId of requested) {
    if (hiddenAgentIds.has(agentId)) continue;
    requireListedAgent(agents, agentId);
    requireAgentLevel(context, agentId, "chat");
    allowed.push(agentId);
  }
  const result = await runCauseEffect(agents.continueInterrupted(allowed, memberSender(member)));
  return json(200, result);
}
