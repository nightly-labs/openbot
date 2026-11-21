import { parseBrowseChannelFoldersInput, parseChannelFolderInput } from "@openbot/contracts/ipc";
import {
  CHANNEL_FOLDERS_CAPABILITY,
  CHANNEL_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/channel-folders-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { type BrowserWindow, dialog } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ChannelFolders } from "../channel-folders";
import {
  decodeRemoteAgentFolderBrowse,
  decodeRemoteChannelFolderChange,
  decodeRemoteChannelFolderList,
} from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { parseChannelId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface ChannelFolderRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export interface ChannelFolderIpcDependencies {
  folders: ChannelFolders;
  remoteServers: ChannelFolderRemoteServers;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function channelFolderIpcHandlers({
  folders,
  remoteServers,
  getMainWindow,
  translate,
}: ChannelFolderIpcDependencies): Pick<IpcGroupHandlers, "channelFolders"> {
  function remote<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, CHANNEL_FOLDERS_CAPABILITY))
      throw new Error(sourceText("error.team.channelFoldersUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  let picking = false;

  async function pick(title: string): Promise<string | undefined> {
    if (picking) return undefined;
    picking = true;
    const parent = getMainWindow();
    const options = { title, properties: ["openDirectory" as const, "createDirectory" as const] };
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
      () => {
        picking = false;
      },
    );
    return result.canceled ? undefined : result.filePaths[0];
  }

  return {
    channelFolders: {
      listChannelFolders: scopedHandler(parseChannelId, {
        local: (channelId) => folders.list(channelId),
        remote: (channelId, serverId) =>
          remote(serverId, CHANNEL_FOLDERS_ROUTES.read, decodeRemoteChannelFolderList, { channelId }),
      }),
      chooseChannelFolder: payloadHandler(parseChannelId, async (channelId) => {
        const channel = folders.requireChannel(channelId);
        const picked = await pick(translate("dialog.chooseChannelFolder", { channel: channel.name }));
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(channelId) };
        return folders.add(channelId, picked);
      }),
      addChannelFolder: scopedHandler(parseChannelFolderInput, {
        local: ({ channelId, path }) => folders.add(channelId, path),
        remote: (input, serverId) =>
          remote(serverId, CHANNEL_FOLDERS_ROUTES.add, decodeRemoteChannelFolderChange, input),
      }),
      removeChannelFolder: scopedHandler(parseChannelFolderInput, {
        local: ({ channelId, path }) => folders.remove(channelId, path),
        remote: (input, serverId) =>
          remote(serverId, CHANNEL_FOLDERS_ROUTES.remove, decodeRemoteChannelFolderChange, input),
      }),
      browseChannelFolders: scopedHandler(parseBrowseChannelFoldersInput, {
        local: () => {
          throw new Error(sourceText("error.team.folderUnavailable"));
        },
        remote: (input, serverId) =>
          remote(serverId, CHANNEL_FOLDERS_ROUTES.browse, decodeRemoteAgentFolderBrowse, input),
      }),
    },
  };
}
