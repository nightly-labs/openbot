import { parseUpdateAgentAdminSettingsInput } from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AgentNotFoundError } from "../agent-admin-settings";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * Access and auto-approve of one agent, changed from a joined server. Both decide what the agent
 * may do on this computer, so only an owner or admin can read or change them. Turbo mode stays a
 * local choice: the route reports it and cannot change it. Frozen by `agent-admin-v1`.
 */
export async function routeAgentAdmin(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_ADMIN_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_ADMIN_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agents;
  if (!settings || !capabilities.has(AGENT_ADMIN_CAPABILITY))
    throw new HttpError(400, "Agent settings are not supported by this connection.");
  requireAdmin(member);
  // `readJson` has already run the body through the agent-admin wire codec.
  const body = await readJson(request);
  try {
    if (read) return json(200, settings.read(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentAdminSettingsInput>;
    try {
      input = parseUpdateAgentAdminSettingsInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent settings update.");
    }
    return json(200, await settings.update(input));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}
