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

/**
 * The instruction file at the root of one agent's workspace. The agent reads it in each session, so
 * only an owner or an admin reads or saves it. Frozen by `agent-instructions-v1`.
 */
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
  // `readJson` has already run the body through the agent-instructions wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  requireListedAgent(instructions, agentId);
  try {
    if (url.pathname === AGENT_INSTRUCTIONS_ROUTES.read) return json(200, await instructions.read(agentId));
    return json(200, await instructions.save(parseSaveAgentInstructionsInput(body)));
  } catch (error) {
    // Another device can delete the agent while the save waits for the one before it.
    requireListedAgent(instructions, agentId);
    // A text that changed since the edit started, or a file that is too large, is a sentence for the
    // admin. Any other error is a host fault.
    if (error instanceof AgentInstructionsRefusedError) throw new HttpError(409, error.message);
    throw error;
  }
}
