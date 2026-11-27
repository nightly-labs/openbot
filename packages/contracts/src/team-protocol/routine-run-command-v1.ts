import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";

export const ROUTINE_RUN_COMMAND_CAPABILITY = "routine-run-command-v1";

export const ROUTINE_RUN_COMMAND_ROUTES = {
  command: "/v1/admin/routines/run-command",
} as const;

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

export function decodeRoutineRunCommandResponse(value: unknown): string {
  if (!isDynamicRecord(value) || typeof value.command !== "string") throw new Error("Invalid run command.");
  return value.command;
}
