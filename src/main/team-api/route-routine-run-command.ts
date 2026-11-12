import {
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireListedAgent, requireVisibleBodyAgent, stringField } from "./request-helpers";

/**
 * The command that runs one routine from a script on this computer, from a joined server, as
 * Routines > Copy run command has it here. The command works only in a shell on this computer, and
 * it reads the token from its file when it runs. Only an owner or admin gets it: the same people who
 * turn on Local scripts for the agent. The agent service refuses an agent without Local scripts and a
 * routine that is gone. Frozen by `routine-run-command-v1`.
 */
export async function routeRoutineRunCommand(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== ROUTINE_RUN_COMMAND_ROUTES.command) return "unmatched";
  const routines = admin?.routineRunCommand;
  if (!routines || !capabilities.has(ROUTINE_RUN_COMMAND_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineRunCommandUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the routine-run-command wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const input = { agentId: stringField(body, "agentId"), routineId: stringField(body, "routineId") };
  requireListedAgent(routines, input.agentId);
  try {
    return json(200, { command: routines.automationRunCommand(input) });
  } catch (error) {
    // Local scripts off, or a routine that is gone: a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}
