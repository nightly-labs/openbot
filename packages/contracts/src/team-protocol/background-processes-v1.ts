// Frozen optional background-processes-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list the programs that the host's agents left running, such as a dev server that an
// agent started with `nohup ... &`, and stop one of them with its children. These are the programs that
// Server Settings > Storage lists for this computer. Each program carries its id (the pid and the start time), its
// pid, its command line, its start time, the TCP ports that it listens on (at most 64), and the agent whose
// workspace holds its working folder. The host redacts the secrets of the command line and cuts it to
// 500 characters, and it never sends the environment of a program. The list has at most 200 programs;
// `processes` is null when the host cannot find such programs, as on Windows. A stop names a program
// by its id, and the host stops it only while that id names a left program, so a client cannot signal
// another process. A stop of a program that ended is not an error. `requireAdmin` on the host is the
// only gate. Widening any of it needs a second capability string.
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

/** The most programs that one list carries. */
export const BACKGROUND_PROCESSES_LIMIT = 200;
/** The most characters of a command line that cross. The host redacts it first. */
export const BACKGROUND_PROCESS_COMMAND_LIMIT = 500;
/** The most listening ports of one program that cross. */
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

/** The list a host answers, as the client type. The transport has already run it through the codec above. */
export function decodeBackgroundProcessesResponse(value: unknown): BackgroundProcess[] | null {
  if (!isDynamicRecord(value)) throw new Error("Invalid programs.");
  const { processes } = value;
  if (processes === null) return null;
  if (!Array.isArray(processes) || !processes.every(isBackgroundProcess)) throw new Error("Invalid programs.");
  return processes;
}
