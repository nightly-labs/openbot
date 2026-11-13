import { GITHUB_SKILLS_CAPABILITY, GITHUB_SKILLS_ROUTES } from "@openbot/contracts/team-protocol/github-skills-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * The skills under a public GitHub link, read by this host with no GitHub account. An install of one
 * goes through `skills-admin-v1` with the id that this read gives. Frozen by `github-skills-v1`.
 */
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
  // `readJson` has already run the body through the github-skills wire codec.
  const body = await readJson(request);
  try {
    return json(200, await runCauseEffect(skills.readGithub(stringField(body, "link"))));
  } catch (error) {
    // The read throws only sentences for the admin: a bad link, a private repository, the GitHub limit.
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
