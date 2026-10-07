import {
  type BrowseWorkingDirectoryInput,
  parseBrowseWorkingDirectory,
  parseSetWorkingDirectory,
  type SetWorkingDirectoryInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_WORKING_DIRECTORY_CAPABILITY,
  AGENT_WORKING_DIRECTORY_ROUTES as routes,
} from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import { sourceText } from "@openbot/i18n/source";
import { dialog } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentWorkingDirectory } from "../agent-working-directory";
import { decodeHostDirectoryFromHost, decodeWorkingDirectorySettingsFromHost } from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";
import { requireString } from "./validation";

export function workingDirectoryIpcHandlers(
  service: AgentWorkingDirectory,
  remoteServers: Pick<RemoteServerManager, "supportsCapability" | "request">,
): Pick<IpcGroupHandlers, "workingDirectory"> {
  function remote<T>(
    serverId: string,
    path: string,
    body: { agentId: string } | SetWorkingDirectoryInput | BrowseWorkingDirectoryInput,
    decoder: ResponseDecoder<T>,
  ) {
    if (!remoteServers.supportsCapability(serverId, AGENT_WORKING_DIRECTORY_CAPABILITY))
      throw new Error(sourceText("error.agent.workingDirectoryUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    workingDirectory: {
      getWorkingDirectory: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => service.read(agentId),
        remote: (agentId, serverId) =>
          remote(serverId, routes.settings, { agentId }, decodeWorkingDirectorySettingsFromHost),
      }),
      setWorkingDirectory: scopedHandler(parseSetWorkingDirectory, {
        local: (input) => runCauseEffect(service.update(input)),
        remote: (input, serverId) => remote(serverId, routes.update, input, decodeWorkingDirectorySettingsFromHost),
      }),
      browseWorkingDirectory: scopedHandler(parseBrowseWorkingDirectory, {
        local: (input) => runCauseEffect(service.browse(input)),
        remote: (input, serverId) => remote(serverId, routes.browse, input, decodeHostDirectoryFromHost),
      }),
      chooseWorkingDirectory: payloadHandler(
        (value) => requireString(value, "agentId"),
        async (agentId) => {
          const result = await dialog.showOpenDialog({
            properties: ["openDirectory"],
            defaultPath: service.read(agentId).effectivePath,
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
      ),
    },
  };
}
