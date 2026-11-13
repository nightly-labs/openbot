// Frozen optional routine-run-command-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can get the command that runs one routine of an agent from a script on the host, as
// Routines > Copy run command does on this computer. The command reads the address and the token of
// the host's automation server from their files on the host when it runs, so the token is never in
// the answer, and the command works only in a shell on the host. The answer names the host's own
// automation folder. The host refuses an agent without Local scripts (`allowAutomation`) and a routine
// that is gone. A member cannot use the route; `requireAdmin` on the host is the only gate, the same
// gate as the Local scripts switch of `agent-host-settings-v1`. Widening any of it needs a second
// capability string.
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";

export const ROUTINE_RUN_COMMAND_CAPABILITY = "routine-run-command-v1";

export const ROUTINE_RUN_COMMAND_ROUTES = {
  command: "/v1/admin/routines/run-command",
} as const;

/** The most characters of one run command. The host's folder path is part of it. */
export const ROUTINE_RUN_COMMAND_LIMIT = 4096;

export const ROUTINE_RUN_COMMAND_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    ROUTINE_RUN_COMMAND_ROUTES.command,
    adminRoute(
      fields({ agentId: identifier, routineId: identifier }),
      fields({ command: string(ROUTINE_RUN_COMMAND_LIMIT) }),
    ),
  ],
]);

/** The run command that a host answers. The transport has already run it through the codec above. */
export function decodeRoutineRunCommandResponse(value: unknown): string {
  if (!isDynamicRecord(value) || typeof value.command !== "string") throw new Error("Invalid run command.");
  return value.command;
}
