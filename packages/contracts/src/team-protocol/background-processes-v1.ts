import type { BackgroundProcess } from "../ipc-app-auth";
import { isBackgroundProcess } from "../ipc-app-auth";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const BACKGROUND_PROCESSES_CAPABILITY = "background-processes-v1";

export const BACKGROUND_PROCESSES_ROUTES = {
  list: "/v1/admin/background-processes/list",
  stop: "/v1/admin/background-processes/stop",
} as const;

export const BACKGROUND_PROCESSES_LIMIT = 200;
export const BACKGROUND_PROCESS_COMMAND_LIMIT = 500;
export const BACKGROUND_PROCESS_PORTS_LIMIT = 64;

const port: AdminDecoder = (value) => {
  const decoded = count(value);
  if (typeof decoded !== "number" || decoded < 1 || decoded > 65_535) throw new Error("Invalid port.");
  return decoded;
};

const program = fields({
  id: identifier,
  pid: count,
  command: string(BACKGROUND_PROCESS_COMMAND_LIMIT),
  startedAt: count,
  ports: list(port, BACKGROUND_PROCESS_PORTS_LIMIT),
  agentId: nullable(identifier),
});

export const BACKGROUND_PROCESSES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    BACKGROUND_PROCESSES_ROUTES.list,
    adminRoute(empty, fields({ processes: nullable(list(program, BACKGROUND_PROCESSES_LIMIT)) })),
  ],
  [BACKGROUND_PROCESSES_ROUTES.stop, adminRoute(fields({ id: identifier }), empty)],
]);

export function decodeBackgroundProcessesResponse(value: unknown): BackgroundProcess[] | null {
  if (!isDynamicRecord(value)) throw new Error("Invalid programs.");
  const { processes } = value;
  if (processes === null) return null;
  if (!Array.isArray(processes) || !processes.every(isBackgroundProcess)) throw new Error("Invalid programs.");
  return processes;
}
