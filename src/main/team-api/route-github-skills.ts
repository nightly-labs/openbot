import { GITHUB_SKILLS_CAPABILITY, GITHUB_SKILLS_ROUTES } from "@openbot/contracts/team-protocol/github-skills-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

export async function routeGithubSkills(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== GITHUB_SKILLS_ROUTES.read) return "unmatched";
  const skills = admin?.skills;
  if (!skills || !capabilities.has(GITHUB_SKILLS_CAPABILITY))
    throw new HttpError(400, sourceText("error.skill.githubHostTooOld"));
  requireAdmin(member);
  const body = await readJson(request);
  try {
    return json(200, await runCauseEffect(skills.readGithub(stringField(body, "link"))));
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
