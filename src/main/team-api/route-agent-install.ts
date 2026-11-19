import { randomUUID } from "node:crypto";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { AGENT_INSTALL_CAPABILITY, AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_UPDATE_CAPABILITY, AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentMarketplaceFailure } from "../agent-marketplace-service";
import type { AgentTemplateFailure } from "../agent-template-service";
import { parseInstallAgentTemplate } from "../ipc/agent-template-handlers";
import { parseInstallMarketplaceAgent } from "../ipc/app-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";

export async function routeAgentInstall(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
  newAgentHidden: () => boolean,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const marketplace = method === "POST" && url.pathname === AGENT_INSTALL_ROUTES.marketplace;
  const template = method === "POST" && url.pathname === AGENT_INSTALL_ROUTES.template;
  const update = method === "POST" && url.pathname === AGENT_UPDATE_ROUTES.marketplace;
  if (!marketplace && !template && !update) return "unmatched";
  const marketplaceAgents = admin?.marketplaceAgents;
  const agentTemplates = admin?.agentTemplates;
  if (update) {
    if (!marketplaceAgents || !capabilities.has(AGENT_UPDATE_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.agentUpdateUnsupported"));
    requireAdmin(member);
    const body = await readJson(request);
    requireVisibleBodyAgent(body, hiddenAgentIds);
    return answer(json, updateFromMarketplace(marketplaceAgents, body));
  }
  if (!marketplaceAgents || !agentTemplates || !capabilities.has(AGENT_INSTALL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentInstallUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (newAgentHidden()) throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
  return answer(
    json,
    marketplace ? addFromMarketplace(marketplaceAgents, body) : addFromTemplate(agentTemplates, body),
  );
}

async function answer(json: TeamApiRequestContext["json"], add: Install): Promise<RouteOutcome> {
  try {
    const { agent } = await runCauseEffect(add());
    return json(200, { agentId: agent.id, name: agent.name });
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}

type Install = () => Effect.Effect<
  { agent: { id: string; name: string } },
  AgentMarketplaceFailure | AgentTemplateFailure
>;

function parsed<T>(parse: (value: unknown) => T, body: unknown): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent installation.");
  }
}

function addFromMarketplace(service: NonNullable<TeamApiAdmin["marketplaceAgents"]>, body: unknown): Install {
  const { listingId, timezone, receiptId } = parsed(parseInstallMarketplaceAgent, body);
  return () => service.install({ listingId, timezone, receiptId });
}

function updateFromMarketplace(service: NonNullable<TeamApiAdmin["marketplaceAgents"]>, body: unknown): Install {
  const input = parsed(parseInstallMarketplaceAgent, {
    ...(isDynamicRecord(body) ? body : {}),
    receiptId: randomUUID(),
  });
  if (input.agentId === undefined) throw new HttpError(400, sourceText("error.team.agentUpdateTargetRequired"));
  return () => service.install(input);
}

function addFromTemplate(service: NonNullable<TeamApiAdmin["agentTemplates"]>, body: unknown): Install {
  const input = parsed(parseInstallAgentTemplate, body);
  return () => service.install(input);
}
