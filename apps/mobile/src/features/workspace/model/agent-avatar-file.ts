import { File } from "expo-file-system";
import { renderBloubAvatar } from "@/features/live-activity/model/live-activity-bloub";
import { savedAgentAvatar } from "./agent-avatar-cache";
import type { MobileAgent } from "./workspace-types";

export type AvatarFileAgent = Pick<MobileAgent, "serverId" | "id" | "avatarUrl" | "avatarSeed" | "avatarHue">;

/** FNV-1a, so that a file name changes when its picture changes. */
function nameHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The agent's photo when this phone has saved it, else its bloub drawn at `pixels`, as a file that a
 * native extension or service can read. The name changes when the picture changes.
 */
export function agentAvatarFile(agent: AvatarFileAgent, pixels: number): { name: string; write: (file: File) => void } {
  const photo = agent.avatarUrl ? savedAgentAvatar(agent.serverId, agent.id, agent.avatarUrl) : null;
  if (photo) {
    const source = new File(photo);
    return { name: `${nameHash(photo)}${source.extension}`, write: (file) => source.copySync(file) };
  }
  return {
    name: `${nameHash(`${agent.avatarSeed}|${agent.avatarHue}`)}.png`,
    write: (file) => {
      const image = renderBloubAvatar(agent.avatarSeed, agent.avatarHue, "idle", pixels);
      if (image) file.writeSync(image.slice(image.indexOf(",") + 1), { encoding: "base64" });
    },
  };
}
