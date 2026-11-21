import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ChannelFolderCalls } from "@openbot/ui/features/channels/ChannelFolders";

export type ChannelFoldersApi = Pick<
  OpenBotDesktopApi["agent"],
  "listChannelFolders" | "addChannelFolder" | "removeChannelFolder" | "browseChannelFolders"
>;

export type ChannelFoldersMode = "local" | "remote";

export function localChannelFolderCalls(
  api: ChannelFoldersApi & Pick<OpenBotDesktopApi["agent"], "chooseChannelFolder">,
): ChannelFolderCalls {
  return {
    list: (channelId) => api.listChannelFolders(channelId),
    choose: (channelId) => api.chooseChannelFolder(channelId),
    add: (channelId, path) => api.addChannelFolder({ channelId, path }),
    remove: (channelId, path) => api.removeChannelFolder({ channelId, path }),
  };
}

export function remoteChannelFolderCalls(
  api: ChannelFoldersApi,
  pick: (channelId: string) => Promise<string | null>,
): ChannelFolderCalls {
  const list = (channelId: string) => api.listChannelFolders(channelId);
  return {
    list,
    choose: async (channelId) => {
      const picked = await pick(channelId);
      if (picked === null) return { outcome: "cancelled", list: await list(channelId) };
      return api.addChannelFolder({ channelId, path: picked });
    },
    add: (channelId, path) => api.addChannelFolder({ channelId, path }),
    remove: (channelId, path) => api.removeChannelFolder({ channelId, path }),
  };
}
