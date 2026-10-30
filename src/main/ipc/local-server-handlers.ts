// Servers that the desktop app starts on this computer. See `../local-servers/local-servers.ts`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { LocalServers } from "../local-servers/local-servers";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { requireString } from "./validation";

export interface LocalServerIpcDependencies {
  /** Null in a local server, in server mode and on a hosted server. */
  localServers: LocalServers | null;
}

export function localServerIpcHandlers({
  localServers,
}: LocalServerIpcDependencies): Pick<IpcGroupHandlers, "localServers"> {
  const available = (): LocalServers => {
    if (!localServers) throw new Error("This process has no servers of its own.");
    return localServers;
  };
  return {
    localServers: {
      create: payloadHandler(
        (value) => requireString(value, "name", INPUT_LIMITS.serverName),
        (name) => runCauseEffect(available().create(name)),
      ),
      restart: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) => runCauseEffect(available().restart(serverId)),
      ),
      delete: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) => runCauseEffect(available().delete(serverId)),
      ),
    },
  };
}
