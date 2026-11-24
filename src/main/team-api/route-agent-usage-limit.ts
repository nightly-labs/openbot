import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_USAGE_LIMIT_CAPABILITY,
  AGENT_USAGE_LIMIT_LIST_LIMIT,
  AGENT_USAGE_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import { isPeerHiddenProvider } from "./provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

export async function routeAgentUsageLimit(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "getRuntimeSnapshot" | "updateAgent">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, protocol, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== AGENT_USAGE_LIMIT_ROUTES.list && url.pathname !== AGENT_USAGE_LIMIT_ROUTES.switch)
  )
    return "unmatched";
  if (!capabilities.has(AGENT_USAGE_LIMIT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.usageLimitUnsupported"));
  const body = await readJson(request);
  if (url.pathname === AGENT_USAGE_LIMIT_ROUTES.list) {
    const snapshot = agents.getRuntimeSnapshot();
    const visible = (choice: { provider: string }) => !isPeerHiddenProvider(choice.provider, protocol);
    return json(200, {
      usageLimits: (snapshot.usageLimits ?? [])
        .filter((limit) => !hiddenAgentIds.has(limit.agentId))
        .slice(0, AGENT_USAGE_LIMIT_LIST_LIMIT),
      usageLimitedModels: (snapshot.usageLimitedModels ?? []).filter(visible).slice(0, AGENT_USAGE_LIMIT_LIST_LIMIT),
      failedModels: (snapshot.failedModels ?? []).filter(visible).slice(0, AGENT_USAGE_LIMIT_LIST_LIMIT),
    });
  }
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  requireAgentLevel(context, agentId, "manage");
  const { provider, model, reasoningEffort, providerAccountId } = body;
  if (!isAgentProvider(provider) || isPeerHiddenProvider(provider, protocol))
    throw new HttpError(400, "provider is invalid.");
  if (!isAgentModel(model)) throw new HttpError(400, "model is invalid.");
  if (!isReasoningEffort(reasoningEffort)) throw new HttpError(400, "reasoningEffort is invalid.");
  const account = typeof providerAccountId === "string" ? providerAccountId : DEFAULT_PROVIDER_ACCOUNT_ID;
  const current = agents.listAgents().find((agent) => agent.id === agentId)?.providerAccountId;
  if (account !== DEFAULT_PROVIDER_ACCOUNT_ID && account !== current) requireAdmin(member);
  const input: UpdateAgentInput = {
    agentId,
    provider,
    model,
    reasoningEffort,
    providerAccountId: account === DEFAULT_PROVIDER_ACCOUNT_ID ? null : account,
    leaveUsageLimit: true,
  };
  await runCauseEffect(agents.updateAgent(input, undefined, false));
  return json(200, {});
}
