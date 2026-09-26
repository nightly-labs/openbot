import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "../ipc/app-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * The skills of one agent on this computer, managed from a joined server. The host downloads a
 * marketplace skill with its own account, so the client sends only ids. Frozen by `skills-admin-v1`.
 */
export async function routeSkillsAdmin(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
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
  // `readJson` has already run the body through the skills-admin wire codec.
  const body = await readJson(request);
  try {
    if (list) return json(200, await skills.listInstalled(stringField(body, "agentId")));
    if (install) return json(200, await skills.install(parseInstallSkill(body)));
    if (uninstall) {
      await skills.uninstall(parseUninstallSkill(body));
      return json(200, {});
    }
    return json(200, await skills.setEnabled(parseSetEnabledSkill(body)));
  } catch (error) {
    // The skill service throws only sentences written for the person who manages the agent, such
    // as a missing marketplace sign-in or a skill with local changes, so the admin reads the reason.
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
