import type { CustomAgentSummary } from "@openbot/contracts/ipc";
import { CUSTOM_AGENTS_CAPABILITY, CUSTOM_AGENTS_ROUTES } from "@openbot/contracts/team-protocol/custom-agents-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseDeleteCustomAgent, parseSaveCustomAgent } from "../ipc/custom-agent-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * `custom-agents-v1`: the custom ACP agents of this host, for an owner or admin. The same parsers and
 * change service as the local Settings run here. An environment value only arrives here; no response
 * carries one.
 */
export async function routeCustomAgents(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, member, request, capabilities, json } = context;
  if (method !== "POST" || !Object.values(CUSTOM_AGENTS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  const agents = admin?.customAgents;
  if (!agents || !capabilities.has(CUSTOM_AGENTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.provider.customAgentsUnavailable"));
  requireAdmin(member);
  const body = await readJson(request);
  try {
    switch (url.pathname) {
      case CUSTOM_AGENTS_ROUTES.list:
        return json(200, (await runCauseEffect(agents.list())).map(wireCustomAgent));
      case CUSTOM_AGENTS_ROUTES.save: {
        const result = await runCauseEffect(agents.save(parseSaveCustomAgent(body)));
        return json(200, { agents: result.agents.map(wireCustomAgent), restart: result.restart });
      }
      default: {
        const result = await runCauseEffect(agents.remove(parseDeleteCustomAgent(body).id));
        return json(200, { agents: result.agents.map(wireCustomAgent), restart: result.restart });
      }
    }
  } catch (error) {
    // The parsers and the change service quote no environment value; the redaction is the second guard.
    throw new HttpError(
      409,
      redactText(error instanceof Error ? error.message : sourceText("error.provider.customAgentsUnavailable")),
    );
  }
}

/** The released fields only, so a field that this computer adds later does not reach a peer. */
function wireCustomAgent(agent: CustomAgentSummary) {
  return {
    id: agent.id,
    name: agent.name,
    command: agent.command,
    args: agent.args,
    envNames: agent.envNames,
    usagePrompt: agent.usagePrompt ?? null,
    resolvedCommand: agent.resolvedCommand,
  };
}
