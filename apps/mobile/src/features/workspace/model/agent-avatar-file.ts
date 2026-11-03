import { type Directory, File } from "expo-file-system";
import { nameHash, PLUSH_STYLE, renderPlushPicture } from "@/features/agents/model/plush/plush-picture";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { savedAgentAvatar } from "./agent-avatar-cache";
import type { MobileAgent } from "./workspace-types";

export type AvatarFileAgent = Pick<MobileAgent, "serverId" | "id" | "avatarUrl" | "avatarSeed" | "avatarHue">;

interface AvatarFile {
  name: string;
  /**
   * Writes the picture, or starts to draw it. A drawn plush is written later, and only while `wanted`
   * is true; its promise ends when it is written.
   */
  write: (file: File, wanted: () => boolean) => Promise<void> | null;
}

/**
 * The agent's photo when this phone has saved it, else its plush drawn at `pixels`, as a file that a
 * native extension or service can read. The name changes when the picture changes.
 */
export function agentAvatarFile(agent: AvatarFileAgent, pixels: number): AvatarFile {
  const photo = agent.avatarUrl ? savedAgentAvatar(agent.serverId, agent.id, agent.avatarUrl) : null;
  if (photo) {
    const source = new File(photo);
    return {
      name: `${nameHash(photo)}${source.extension}`,
      write: (file) => {
        source.copySync(file);
        return null;
      },
    };
  }
  return {
    name: `${nameHash(`${PLUSH_STYLE}|${agent.avatarSeed}|${agent.avatarHue}`)}.png`,
    write: async (file, wanted) => {
      const data = await renderPlushPicture({
        seed: agent.avatarSeed,
        hue: agent.avatarHue,
        mood: "idle",
        pixels,
        saturation: 1,
      });
      if (wanted() && !file.exists) file.writeSync(data, { encoding: "base64" });
    },
  };
}

/** The names that each folder must hold, from its latest sync. */
const wantedNames = new Map<string, ReadonlySet<string>>();
/** The files that are being drawn. */
const writing = new Set<string>();

/**
 * Writes the pictures of `agents` that `named` holds and `folder` does not have, and deletes the
 * files that `named` does not hold. A picture that fails is logged as `label` and left out. A plush
 * picture is drawn in the background; its file shows up when it is drawn.
 */
export function syncAvatarFolder(
  folder: Directory,
  named: ReadonlySet<string>,
  agents: readonly AvatarFileAgent[],
  pixels: number,
  label: string,
): void {
  folder.create({ intermediates: true, idempotent: true });
  wantedNames.set(folder.uri, named);
  const fail = (error: unknown) => supportLog.add("warn", "app", `${label} not saved: ${supportLogValue(error)}`);
  for (const agent of agents) {
    const source = agentAvatarFile(agent, pixels);
    const file = new File(folder, source.name);
    if (!named.has(source.name) || file.exists || writing.has(file.uri)) continue;
    try {
      // Sign-out deletes the folder; a picture drawn after it is not written.
      const written = source.write(file, () => folder.exists && wantedNames.get(folder.uri)?.has(source.name) === true);
      if (!written) continue;
      writing.add(file.uri);
      void written.catch(fail).finally(() => writing.delete(file.uri));
    } catch (error) {
      fail(error);
    }
  }
  for (const entry of folder.list()) if (!named.has(entry.name)) entry.delete();
}
