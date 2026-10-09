import { parseResetAgentSessionSetting, parseSetAgentSessionSetting } from "@openbot/contracts/ipc";
import {
  AGENT_SESSION_SETTINGS_CAPABILITY,
  AGENT_SESSION_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

/** Session configuration belongs to the host owner or an administrator. */
export async function routeAgentSessionSettings(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(AGENT_SESSION_SETTINGS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  const settings = admin?.sessionSettings;
  if (!settings || !capabilities.has(AGENT_SESSION_SETTINGS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  if (url.pathname === AGENT_SESSION_SETTINGS_ROUTES.read)
    return json(200, await runCauseEffect(settings.readAgentSessionSettings(stringField(body, "agentId"))));
  if (url.pathname === AGENT_SESSION_SETTINGS_ROUTES.set)
    return json(200, await runCauseEffect(settings.setAgentSessionSetting(parseSetAgentSessionSetting(body))));
  return json(200, await runCauseEffect(settings.resetAgentSessionSetting(parseResetAgentSessionSetting(body))));
}
