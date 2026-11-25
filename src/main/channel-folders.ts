import {
  CHANNEL_FOLDER_LIMIT,
  type Channel,
  type ChannelFolderChange,
  type ChannelFolderList,
  channelFolderCoverage,
  folderInside,
} from "@openbot/contracts/ipc";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import type { ChannelStore } from "../backend/channel-store";
import { runCauseEffect } from "../backend/effect-boundary";
import { type AgentFolders, isDirectory, isProtectedFolder, realFolder } from "./agent-folders";
import { oneAtATimePerKey } from "./ipc/one-at-a-time";

export interface ChannelFoldersDependencies {
  service: Pick<AgentService, "listAgents" | "sharedRoot"> & {
    channels: { store: Pick<ChannelStore, "get" | "exists">; setFolders: ChannelService["setFolders"] };
  };
  userDataPath: string;
  browse: AgentFolders["browse"];
}

export function createChannelFolders({ service, userDataPath, browse }: ChannelFoldersDependencies) {
  const oneAtATime = oneAtATimePerKey();

  function requireChannel(channelId: string): Channel {
    return service.channels.store.get(channelId);
  }

  async function list(channel: Channel): Promise<ChannelFolderList> {
    const folders = channel.folders ?? [];
    const found = await Promise.all(folders.map(isDirectory));
    return { folders: folders.map((path, index) => ({ path, found: found[index] === true })) };
  }

  async function save(channelId: string, folders: string[]): Promise<ChannelFolderList> {
    return list(await runCauseEffect(service.channels.setFolders(channelId, folders)));
  }

  async function memberRoots(channel: Channel): Promise<string[]> {
    const members = new Set(channel.members.map((member) => member.agentId));
    const workspaces = service
      .listAgents()
      .filter((agent) => members.has(agent.id))
      .map((agent) => agent.workspacePath);
    return Promise.all([service.sharedRoot, ...workspaces].map(realFolder));
  }

  async function addNow(channelId: string, picked: string): Promise<ChannelFolderChange> {
    const channel = requireChannel(channelId);
    const current = channel.folders ?? [];
    if (!(await isDirectory(picked)))
      return { outcome: "refused", path: picked, refusal: "missing", list: await list(channel) };
    const path = await realFolder(picked);
    const folder = channelFolderCoverage(path, current);
    if (folder) return { outcome: "covered", path, folder, list: await list(channel) };
    if (await isProtectedFolder(path, await memberRoots(channel), service.sharedRoot, userDataPath))
      return { outcome: "refused", path, refusal: "protected", list: await list(channel) };
    const kept = current.filter((existing) => !folderInside(path, existing));
    if (kept.length >= CHANNEL_FOLDER_LIMIT)
      return { outcome: "refused", path, refusal: "limit", list: await list(channel) };
    return {
      outcome: "added",
      path,
      replaced: current.filter((existing) => !kept.includes(existing)),
      list: await save(channelId, [...kept, path]),
    };
  }

  return {
    requireChannel,
    hasChannel: (channelId: string) => service.channels.store.exists(channelId),
    list: (channelId: string) => list(requireChannel(channelId)),
    add: (channelId: string, picked: string) => oneAtATime(channelId, () => addNow(channelId, picked)),
    remove: (channelId: string, path: string) =>
      oneAtATime(channelId, async (): Promise<ChannelFolderChange> => {
        const channel = requireChannel(channelId);
        const folders = channel.folders ?? [];
        if (!folders.includes(path)) return { outcome: "removed", path, list: await list(channel) };
        return {
          outcome: "removed",
          path,
          list: await save(
            channelId,
            folders.filter((folder) => folder !== path),
          ),
        };
      }),
    browse,
  };
}

export type ChannelFolders = ReturnType<typeof createChannelFolders>;
