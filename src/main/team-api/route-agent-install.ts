import { AGENT_INSTALL_CAPABILITY, AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { parseInstallAgentTemplate } from "../ipc/agent-template-handlers";
import { parseInstallMarketplaceAgent } from "../ipc/app-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * A new agent on this computer from a marketplace listing or a shared template, added from a joined
 * server. This computer downloads the listing or template with its own account. Frozen by
 * `agent-install-v1`.
 */
export async function routeAgentInstall(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const marketplace = method === "POST" && url.pathname === AGENT_INSTALL_ROUTES.marketplace;
  const template = method === "POST" && url.pathname === AGENT_INSTALL_ROUTES.template;
  if (!marketplace && !template) return "unmatched";
  const marketplaceAgents = admin?.marketplaceAgents;
  const agentTemplates = admin?.agentTemplates;
  if (!marketplaceAgents || !agentTemplates || !capabilities.has(AGENT_INSTALL_CAPABILITY))
    throw new HttpError(400, "Adding agents is not supported by this connection.");
  requireAdmin(member);
  const body = await readJson(request);
  const add = marketplace ? addFromMarketplace(marketplaceAgents, body) : addFromTemplate(agentTemplates, body);
  try {
    const { agent } = await add();
    return json(200, { agentId: agent.id, name: agent.name });
  } catch (error) {
    // A withdrawn listing, a newer template or a signed-out host is a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}

type Install = () => Promise<{ agent: { id: string; name: string } }>;

function parsed<T>(parse: (value: unknown) => T, body: unknown): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent installation.");
  }
}

function addFromMarketplace(service: NonNullable<TeamApiAdmin["marketplaceAgents"]>, body: unknown): Install {
  // agent-install-v1 only adds a new agent, so an id to update is never passed on.
  const { listingId, timezone, receiptId } = parsed(parseInstallMarketplaceAgent, body);
  return () => service.install({ listingId, timezone, receiptId });
}

function addFromTemplate(service: NonNullable<TeamApiAdmin["agentTemplates"]>, body: unknown): Install {
  const input = parsed(parseInstallAgentTemplate, body);
  return () => service.install(input);
}
