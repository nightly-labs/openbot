import { type Directory, File } from "expo-file-system";
import { renderBloubAvatar } from "@/features/live-activity/model/live-activity-bloub";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
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

/**
 * Writes the pictures of `agents` that `named` holds and `folder` does not have, and deletes the
 * files that `named` does not hold. A picture that fails is logged as `label` and left out.
 */
export function syncAvatarFolder(
  folder: Directory,
  named: ReadonlySet<string>,
  agents: readonly AvatarFileAgent[],
  pixels: number,
  label: string,
): void {
  folder.create({ intermediates: true, idempotent: true });
  for (const agent of agents) {
    const source = agentAvatarFile(agent, pixels);
    const file = new File(folder, source.name);
    if (!named.has(source.name) || file.exists) continue;
    try {
      source.write(file);
    } catch (error) {
      supportLog.add("warn", "app", `${label} not saved: ${supportLogValue(error)}`);
    }
  }
  for (const entry of folder.list()) if (!named.has(entry.name)) entry.delete();
}
