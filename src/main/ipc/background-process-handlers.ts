// The programs that agents left running on this computer, or on a joined server through
// `background-processes-v1`. See `../background-processes.ts`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  BACKGROUND_PROCESSES_CAPABILITY,
  BACKGROUND_PROCESSES_ROUTES,
  decodeBackgroundProcessesResponse,
} from "@openbot/contracts/team-protocol/background-processes-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type BackgroundProcessAgent, listBackgroundProcesses, stopBackgroundProcess } from "../background-processes";
import { acceptEmpty } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { requireString } from "./validation";

export interface BackgroundProcessIpcDependencies {
  platform: NodeJS.Platform;
  /** The local agents, read at each call, to name the agent that started a program. */
  agents: () => readonly BackgroundProcessAgent[];
  remoteServers: Pick<RemoteServerManager, "request" | "supportsCapability">;
}

export function backgroundProcessIpcHandlers({
  platform,
  agents,
  remoteServers,
}: BackgroundProcessIpcDependencies): Pick<IpcGroupHandlers, "backgroundProcesses"> {
  /** The renderer shows a joined server's programs only while the host serves `background-processes-v1`. */
  function requireRemoteSupport(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, BACKGROUND_PROCESSES_CAPABILITY))
      throw new Error(sourceText("error.team.backgroundProcessesUnsupported"));
  }
  return {
    backgroundProcesses: {
      list: scopedQueryHandler({
        local: () => runCauseEffect(listBackgroundProcesses(platform, agents())),
        remote: (serverId) => {
          requireRemoteSupport(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, BACKGROUND_PROCESSES_ROUTES.list, decodeBackgroundProcessesResponse, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      stop: scopedHandler((value) => requireString(value, "id", INPUT_LIMITS.identifier), {
        local: (id) => runCauseEffect(stopBackgroundProcess(platform, id)),
        // The background-processes-v1 codec has already checked the empty reply.
        remote: async (id, serverId) => {
          requireRemoteSupport(serverId);
          await runCauseEffect(
            remoteServers.request(serverId, BACKGROUND_PROCESSES_ROUTES.stop, acceptEmpty, {
              method: "POST",
              body: { id },
            }),
          );
        },
      }),
    },
  };
}
