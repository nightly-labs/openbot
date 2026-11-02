import {
  type BrowserProfileSummary,
  canAdministerServer,
  parseBrowserProfileId,
  parseBrowserProfileName,
  parseClearBrowserDataInput,
  parseUpdateAgentBrowserProfileInput,
  parseUpdateBrowserProfileInput,
} from "@openbot/contracts/ipc";
import {
  BROWSER_PROFILES_CAPABILITY,
  BROWSER_PROFILES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { AgentNotFoundError } from "../agent-admin-settings";
import { BrowserProfileRejectedError } from "../browser-profile-service";
import type { TeamApiBrowser, TeamApiBrowserProfiles } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

const ADMIN_ROUTES = new Set<string>([
  BROWSER_PROFILES_ROUTES.list,
  BROWSER_PROFILES_ROUTES.create,
  BROWSER_PROFILES_ROUTES.update,
  BROWSER_PROFILES_ROUTES.clear,
  BROWSER_PROFILES_ROUTES.delete,
  BROWSER_PROFILES_ROUTES.agent,
  BROWSER_PROFILES_ROUTES.updateAgent,
]);

/**
 * The named browser profiles of this computer, changed from a joined server. A profile holds the
 * sign-ins of its agents, so only an owner or admin can list or change profiles, or move an agent
 * between them. Any member reads the profile label of each tab they can see. Frozen by
 * `browser-profiles-v1`.
 */
export async function routeBrowserProfiles(
  context: TeamApiRequestContext,
  profiles: TeamApiBrowserProfiles | undefined,
  browser: Pick<TeamApiBrowser, "isPrivate">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const tabs = url.pathname === BROWSER_PROFILES_ROUTES.tabs;
  if (method !== "POST" || (!tabs && !ADMIN_ROUTES.has(url.pathname))) return "unmatched";
  if (!profiles || !capabilities.has(BROWSER_PROFILES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  if (tabs) {
    await readJson(request);
    // A private tab holds an administrator's MCP sign-in; to a member it does not exist.
    const hidden = (tabId: string) => !canAdministerServer(member.role) && browser.isPrivate(tabId);
    return json(200, { tabs: profiles.tabProfiles().filter((tab) => !hidden(tab.tabId)) });
  }
  requireAdmin(member);
  // `readJson` has already run the body through the browser-profiles wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const visible = (agentIds: readonly string[]) => agentIds.filter((agentId) => !hiddenAgentIds.has(agentId));
  const project = (profile: BrowserProfileSummary): BrowserProfileSummary => ({
    ...profile,
    agentIds: visible(profile.agentIds),
  });
  try {
    switch (url.pathname) {
      case BROWSER_PROFILES_ROUTES.list: {
        const list = profiles.list();
        return json(200, { profiles: list.profiles.map(project), sharedAgentIds: visible(list.sharedAgentIds) });
      }
      case BROWSER_PROFILES_ROUTES.create:
        return json(
          200,
          project(await runCauseEffect(profiles.create(parse(() => parseBrowserProfileName(body.name))))),
        );
      case BROWSER_PROFILES_ROUTES.update:
        return json(
          200,
          project(await runCauseEffect(profiles.update(parse(() => parseUpdateBrowserProfileInput(body))))),
        );
      case BROWSER_PROFILES_ROUTES.clear:
        await runCauseEffect(profiles.clear(parse(() => parseClearBrowserDataInput(body))));
        return json(200, {});
      case BROWSER_PROFILES_ROUTES.delete:
        await runCauseEffect(profiles.delete(parse(() => parseBrowserProfileId(body.profileId))));
        return json(200, {});
      case BROWSER_PROFILES_ROUTES.agent:
        return json(200, profiles.readAgent(stringField(body, "agentId")));
      default:
        return json(
          200,
          await runCauseEffect(profiles.updateAgent(parse(() => parseUpdateAgentBrowserProfileInput(body)))),
        );
    }
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    // A name in use or a missing profile is catalog text for the admin. Any other failure stays
    // private: the server answers it with its generic error.
    if (error instanceof BrowserProfileRejectedError) throw new HttpError(409, error.message);
    throw error;
  }
}

function parse<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid browser profile request.");
  }
}
