import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "../ipc/app-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

/**
 * The skills of one agent on this computer, managed from a joined server. The host downloads a
 * marketplace skill with its own account, so the client sends only ids. Frozen by `skills-admin-v1`.
 */
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
  // `readJson` has already run the body through the skills-admin wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (list)
      return json(
        200,
        await Effect.runPromise(
          skills.listInstalled(stringField(body, "agentId")).pipe(Effect.mapError((error) => error.cause)),
        ),
      );
    if (install)
      return json(
        200,
        await Effect.runPromise(skills.install(parseInstallSkill(body)).pipe(Effect.mapError((error) => error.cause))),
      );
    if (uninstall) {
      await Effect.runPromise(
        skills.uninstall(parseUninstallSkill(body)).pipe(Effect.mapError((error) => error.cause)),
      );
      return json(200, {});
    }
    return json(
      200,
      await Effect.runPromise(
        skills.setEnabled(parseSetEnabledSkill(body)).pipe(Effect.mapError((error) => error.cause)),
      ),
    );
  } catch (error) {
    // The skill service throws only sentences written for the person who manages the agent, such
    // as a missing marketplace sign-in or a skill with local changes, so the admin reads the reason.
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
