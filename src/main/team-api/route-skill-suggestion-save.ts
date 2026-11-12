import { parseSaveSkillSuggestion } from "@openbot/contracts/ipc";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel } from "./request-helpers";

/**
 * Save on a skill question in one agent's chat. A member who can chat with the agent can press it,
 * as the member could answer yes in the chat. The agent id is in the body, so the router's check of
 * the path does not see it, and this module refuses an agent hidden from the caller. Frozen by
 * `skill-learning-v1`.
 */
export async function routeSkillSuggestionSave(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "saveSkillSuggestion" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== SKILL_LEARNING_ROUTES.save) return "unmatched";
  if (!capabilities.has(SKILL_LEARNING_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.skillLearningUnsupported"));
  // `readJson` has already run the body through the skill-learning wire codec.
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
