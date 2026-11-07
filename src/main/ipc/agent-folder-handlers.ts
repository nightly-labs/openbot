// The folders an agent can change besides its workspace and the shared folder. For an agent on a
// joined server the host answers through `agent-folders-v1`, for an owner or admin. The native
// pickers show only this computer, so they stay local.

import { join } from "node:path";
import {
  type AgentExclusionChange,
  parseAddAgentFolderInput,
  parseAgentFolderInput,
  parseBrowseAgentFoldersInput,
  parseChooseAgentFolderInput,
} from "@openbot/contracts/ipc";
import { AGENT_FOLDERS_CAPABILITY, AGENT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/agent-folders-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentFolders } from "../agent-folders";
import {
  decodeRemoteAgentExclusionChange,
  decodeRemoteAgentFolderBrowse,
  decodeRemoteAgentFolderChange,
  decodeRemoteAgentFolderList,
} from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface AgentFolderRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export interface AgentFolderIpcDependencies {
  folders: AgentFolders;
  remoteServers: AgentFolderRemoteServers;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function agentFolderIpcHandlers({
  folders,
  remoteServers,
  getMainWindow,
  translate,
}: AgentFolderIpcDependencies): Pick<IpcGroupHandlers, "agentFolders"> {
  function remote<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, AGENT_FOLDERS_CAPABILITY))
      throw new Error(sourceText("error.team.agentFoldersUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  /** A second press on + while the picker is open does not open another one. */
  let picking = false;

  /** The picked folder, or undefined when the user cancels or a picker is already open. */
  async function pick(options: OpenDialogOptions): Promise<string | undefined> {
    if (picking) return undefined;
    picking = true;
    const parent = getMainWindow();
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
      () => {
        picking = false;
      },
    );
    return result.canceled ? undefined : result.filePaths[0];
  }

  return {
    agentFolders: {
      listAgentFolders: scopedHandler(parseAgentId, {
        local: (agentId) => folders.list(agentId),
        remote: (agentId, serverId) =>
          remote(serverId, AGENT_FOLDERS_ROUTES.read, decodeRemoteAgentFolderList, { agentId }),
      }),
      chooseAgentFolder: payloadHandler(parseChooseAgentFolderInput, async ({ agentId, replace }) => {
        const agent = folders.requireAgent(agentId);
        const picked = await pick({
          title: translate("dialog.chooseAgentFolder", { agent: agent.name }),
          properties: ["openDirectory", "createDirectory"],
          ...(replace === undefined ? {} : { defaultPath: join(replace, "..") }),
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.add(agentId, picked, replace);
      }),
      addAgentFolder: scopedHandler(parseAddAgentFolderInput, {
        local: ({ agentId, path, replace }) => folders.add(agentId, path, replace),
        remote: (input, serverId) => remote(serverId, AGENT_FOLDERS_ROUTES.add, decodeRemoteAgentFolderChange, input),
      }),
      chooseAgentExclusion: payloadHandler(parseAgentId, async (agentId): Promise<AgentExclusionChange> => {
        const agent = folders.requireAgent(agentId);
        // The picker opens in the first added folder, else in the workspace.
        const picked = await pick({
          title: translate("dialog.chooseAgentExclusion", { agent: agent.name }),
          properties: ["openDirectory"],
          defaultPath: agent.additionalFolders?.[0] ?? agent.workspacePath,
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.exclude(agentId, picked);
      }),
      addAgentExclusion: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.exclude(agentId, path),
        remote: (input, serverId) =>
          remote(serverId, AGENT_FOLDERS_ROUTES.exclude, decodeRemoteAgentExclusionChange, input),
      }),
      removeAgentExclusion: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.include(agentId, path),
        remote: (input, serverId) =>
          remote(serverId, AGENT_FOLDERS_ROUTES.include, decodeRemoteAgentExclusionChange, input),
      }),
      removeAgentFolder: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.remove(agentId, path),
        remote: (input, serverId) =>
          remote(serverId, AGENT_FOLDERS_ROUTES.remove, decodeRemoteAgentFolderChange, input),
      }),
      browseAgentFolders: scopedHandler(parseBrowseAgentFoldersInput, {
        // Only a joined server needs this list: this computer has the native folder picker.
        local: () => {
          throw new Error(sourceText("error.team.folderUnavailable"));
        },
        remote: (input, serverId) =>
          remote(serverId, AGENT_FOLDERS_ROUTES.browse, decodeRemoteAgentFolderBrowse, input),
      }),
    },
  };
}
