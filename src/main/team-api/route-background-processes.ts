import {
  BACKGROUND_PROCESS_COMMAND_LIMIT,
  BACKGROUND_PROCESS_PORTS_LIMIT,
  BACKGROUND_PROCESSES_CAPABILITY,
  BACKGROUND_PROCESSES_LIMIT,
  BACKGROUND_PROCESSES_ROUTES,
} from "@openbot/contracts/team-protocol/background-processes-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiBackgroundProcesses } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * The programs that the host's agents left running, and Stop on one of them, from a joined server.
 * Only an owner or admin can use them. The command line is redacted where the list is made, as for
 * Settings > Agents on this computer. An agent that this peer cannot see is not named. Frozen by
 * `background-processes-v1`.
 */
export async function routeBackgroundProcesses(
  context: TeamApiRequestContext,
  processes: TeamApiBackgroundProcesses | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || (path !== BACKGROUND_PROCESSES_ROUTES.list && path !== BACKGROUND_PROCESSES_ROUTES.stop))
    return "unmatched";
  if (!processes || !capabilities.has(BACKGROUND_PROCESSES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.backgroundProcessesUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the background-processes wire codec.
  const body = await readJson(request);
  if (path === BACKGROUND_PROCESSES_ROUTES.list) {
    const listed = await runCauseEffect(processes.list());
    return json(200, {
      processes:
        listed === null
          ? null
          : listed.slice(0, BACKGROUND_PROCESSES_LIMIT).map((program) => ({
              ...program,
              command: program.command.slice(0, BACKGROUND_PROCESS_COMMAND_LIMIT),
              ports: program.ports.slice(0, BACKGROUND_PROCESS_PORTS_LIMIT),
              agentId: program.agentId !== null && hiddenAgentIds.has(program.agentId) ? null : program.agentId,
            })),
    });
  }
  await runCauseEffect(processes.stop(stringField(body, "id")));
  return json(200, {});
}
