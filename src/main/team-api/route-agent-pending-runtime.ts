import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_PENDING_RUNTIME_CAPABILITY,
  AGENT_PENDING_RUNTIME_ROUTES,
} from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import { isPeerHiddenProvider } from "./provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

/**
 * A change of the provider, model, effort or account of one agent from a joined server. While the agent
 * works, the host keeps it for the next turn, as the chat on the host's computer does; the released agent
 * route refuses it. It needs the `manage` level of the agent, as a model change does. A named provider
 * account that is not the agent's account needs an owner or admin, as `provider-accounts-v1` does.
 * Frozen by `agent-pending-runtime-v1`.
 */
export async function routeAgentPendingRuntime(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateAgent">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, protocol, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_PENDING_RUNTIME_ROUTES.update) return "unmatched";
  if (!capabilities.has(AGENT_PENDING_RUNTIME_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  // `readJson` has already run the body through the agent-pending-runtime wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  requireAgentLevel(context, agentId, "manage");
  const { provider, model, reasoningEffort, providerAccountId } = body;
  const input: UpdateAgentInput = { agentId };
  if (provider !== undefined) {
    if (!isAgentProvider(provider) || isPeerHiddenProvider(provider, protocol))
      throw new HttpError(400, "provider is invalid.");
    input.provider = provider;
  }
  if (model !== undefined) {
    if (!isAgentModel(model)) throw new HttpError(400, "model is invalid.");
    input.model = model;
  }
  if (reasoningEffort !== undefined) {
    if (!isReasoningEffort(reasoningEffort)) throw new HttpError(400, "reasoningEffort is invalid.");
    input.reasoningEffort = reasoningEffort;
  }
  if (typeof providerAccountId === "string") {
    const current = agents.listAgents().find((agent) => agent.id === agentId)?.providerAccountId;
    // The provider's own sign-in is the account that a model change gives. Another named account is an
    // admin choice.
    if (providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID && providerAccountId !== current) requireAdmin(member);
    input.providerAccountId = providerAccountId === DEFAULT_PROVIDER_ACCOUNT_ID ? null : providerAccountId;
  }
  if (Object.keys(input).length === 1) throw new HttpError(400, "update is empty.");
  await runCauseEffect(agents.updateAgent(input, undefined, true));
  return json(200, {});
}
