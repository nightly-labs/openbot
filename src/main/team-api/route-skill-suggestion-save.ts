import { parseSaveSkillSuggestion } from "@openbot/contracts/ipc";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel } from "./request-helpers";

export async function routeSkillSuggestionSave(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "saveSkillSuggestion" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== SKILL_LEARNING_ROUTES.save) return "unmatched";
  if (!capabilities.has(SKILL_LEARNING_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.skillLearningUnsupported"));
  const body = await readJson(request);
  let input: ReturnType<typeof parseSaveSkillSuggestion>;
  try {
    input = parseSaveSkillSuggestion(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  if (hiddenAgentIds.has(input.agentId) || !agents.listAgents().some((agent) => agent.id === input.agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, input.agentId, "chat");
  return json(200, await runCauseEffect(agents.saveSkillSuggestion(input)));
}
