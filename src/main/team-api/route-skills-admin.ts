import { isGithubSkillId } from "@openbot/contracts/ipc";
import { GITHUB_SKILLS_CAPABILITY } from "@openbot/contracts/team-protocol/github-skills-v1";
import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "../ipc/app-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

export async function routeSkillsAdmin(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = method === "POST" ? url.pathname : "";
  const list = path === SKILLS_ADMIN_ROUTES.list;
  const install = path === SKILLS_ADMIN_ROUTES.install;
  const uninstall = path === SKILLS_ADMIN_ROUTES.uninstall;
  const setEnabled = path === SKILLS_ADMIN_ROUTES.setEnabled;
  if (!list && !install && !uninstall && !setEnabled) return "unmatched";
  const skills = admin?.skills;
  if (!skills || !capabilities.has(SKILLS_ADMIN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.skillsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (list) return json(200, await runCauseEffect(skills.listInstalled(stringField(body, "agentId"))));
    if (install) {
      const input = parseInstallSkill(body);
      if (isGithubSkillId(input.skillId) && !capabilities.has(GITHUB_SKILLS_CAPABILITY))
        throw new HttpError(400, sourceText("error.skill.githubHostTooOld"));
      return json(200, await runCauseEffect(skills.install(input)));
    }
    if (uninstall) {
      await runCauseEffect(skills.uninstall(parseUninstallSkill(body)));
      return json(200, {});
    }
    return json(200, await runCauseEffect(skills.setEnabled(parseSetEnabledSkill(body))));
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
