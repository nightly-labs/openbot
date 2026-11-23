import { parseSaveAgentInstructionsInput } from "@openbot/contracts/ipc";
import {
  AGENT_INSTRUCTIONS_CAPABILITY,
  AGENT_INSTRUCTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { sourceText } from "@openbot/i18n/source";
import { AgentInstructionsRefusedError } from "../agent-instructions-files";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireListedAgent, requireVisibleBodyAgent } from "./request-helpers";

export async function routeAgentInstructions(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== AGENT_INSTRUCTIONS_ROUTES.read && url.pathname !== AGENT_INSTRUCTIONS_ROUTES.save)
  )
    return "unmatched";
  const instructions = admin?.instructions;
  if (!instructions || !capabilities.has(AGENT_INSTRUCTIONS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentInstructionsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  requireListedAgent(instructions, agentId);
  try {
    if (url.pathname === AGENT_INSTRUCTIONS_ROUTES.read) return json(200, await instructions.read(agentId));
    return json(200, await instructions.save(parseSaveAgentInstructionsInput(body)));
  } catch (error) {
    requireListedAgent(instructions, agentId);
    if (error instanceof AgentInstructionsRefusedError) throw new HttpError(409, error.message);
    throw error;
  }
}
