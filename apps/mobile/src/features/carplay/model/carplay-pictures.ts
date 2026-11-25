import { Directory, File, Paths } from "expo-file-system";
import { nameHash } from "@/features/agents/model/plush/plush-picture";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { type AvatarFileAgent, agentAvatarFile, syncAvatarFolder } from "@/features/workspace/model/agent-avatar-file";
import { carPlayAgentKey } from "./carplay-home";

const PICTURE_FOLDER = "carplay-pictures";
const PICTURE_PIXELS = 192;

function pictureFolder(serverId?: string): Directory {
  const root = new Directory(Paths.cache, PICTURE_FOLDER);
  return serverId === undefined ? root : new Directory(root, nameHash(serverId));
}

function pictureFile(agent: AvatarFileAgent): File {
  return new File(pictureFolder(agent.serverId), agentAvatarFile(agent, PICTURE_PIXELS).name);
}

export function carPlayPicturePaths(agents: readonly AvatarFileAgent[]): ReadonlyMap<string, string> {
  return new Map(agents.map((agent) => [carPlayAgentKey(agent), pictureFile(agent).uri]));
}

export function saveCarPlayPictures(agents: readonly AvatarFileAgent[]): void {
  const byServer = new Map<string, AvatarFileAgent[]>();
  for (const agent of agents) byServer.set(agent.serverId, [...(byServer.get(agent.serverId) ?? []), agent]);
  for (const [serverId, serverAgents] of byServer) {
    try {
      syncAvatarFolder(
        pictureFolder(serverId),
        new Set(serverAgents.map((agent) => agentAvatarFile(agent, PICTURE_PIXELS).name)),
        serverAgents,
        PICTURE_PIXELS,
        "CarPlay picture",
      );
    } catch (error) {
      supportLog.add("warn", "app", `CarPlay pictures not saved: ${supportLogValue(error)}`);
    }
  }
}

function deleteFolder(folder: Directory): void {
  try {
    if (folder.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `CarPlay pictures not removed: ${supportLogValue(error)}`);
  }
}

export function deleteServerCarPlayPictures(serverId: string): void {
  deleteFolder(pictureFolder(serverId));
}

export function resetCarPlayPictures(): void {
  deleteFolder(pictureFolder());
}
