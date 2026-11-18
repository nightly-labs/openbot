import { hostSkillLearning, isSkillLearningMode } from "@openbot/contracts/ipc";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** What the memory reviews of this computer do with a skill a chat teaches, read and set from a joined server. Frozen by `skill-learning-v1`. */
export async function routeSkillLearning(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== SKILL_LEARNING_ROUTES.settings && url.pathname !== SKILL_LEARNING_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.skillLearning;
  if (!setting || !capabilities.has(SKILL_LEARNING_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.skillLearningUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === SKILL_LEARNING_ROUTES.settings) return json(200, hostSkillLearning(setting.get()));
  // The snapshot names every value this host permits, so only a malformed request sends another.
  if (!isSkillLearningMode(body.mode)) throw new HttpError(400, "Skill learning mode is required.");
  return json(200, hostSkillLearning(await runCauseEffect(setting.set({ mode: body.mode }))));
}
