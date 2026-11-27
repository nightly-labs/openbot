import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { type Directory, File } from "expo-file-system";
import { nameHash, PLUSH_STYLE, renderPlushPicture } from "@/features/agents/model/plush/plush-picture";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { savedAgentAvatar } from "./agent-avatar-cache";
import type { MobileAgent } from "./workspace-types";

export type AvatarFileAgent = Pick<
  MobileAgent,
  "serverId" | "id" | "avatarUrl" | "avatarSeed" | "avatarHue" | "avatarColor"
>;

interface AvatarFile {
  name: string;
  write: (file: File, wanted: () => boolean) => Promise<void> | null;
}

export function agentAvatarFile(agent: AvatarFileAgent, pixels: number, mood: AvatarMood = "idle"): AvatarFile {
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
    name: `${nameHash(`${PLUSH_STYLE}|${agent.avatarSeed}|${agent.avatarHue}${agent.avatarColor ? `|${agent.avatarColor}` : ""}${mood === "idle" ? "" : `|${mood}`}`)}.png`,
    write: async (file, wanted) => {
      const data = await renderPlushPicture({
        seed: agent.avatarSeed,
        hue: agent.avatarHue,
        color: agent.avatarColor,
        mood,
        pixels,
        saturation: 1,
      });
      if (wanted() && !file.exists) file.writeSync(data, { encoding: "base64" });
    },
  };
}

const wantedNames = new Map<string, ReadonlySet<string>>();
const writing = new Set<string>();

export function syncAvatarFolder(
  folder: Directory,
  named: ReadonlySet<string>,
  agents: readonly AvatarFileAgent[],
  pixels: number,
  label: string,
  moods: readonly AvatarMood[] = ["idle"],
): void {
  folder.create({ intermediates: true, idempotent: true });
  wantedNames.set(folder.uri, named);
  const fail = (error: unknown) => supportLog.add("warn", "app", `${label} not saved: ${supportLogValue(error)}`);
  for (const agent of agents)
    for (const mood of moods) {
      const source = agentAvatarFile(agent, pixels, mood);
      const file = new File(folder, source.name);
      if (!named.has(source.name) || file.exists || writing.has(file.uri)) continue;
      try {
        const written = source.write(
          file,
          () => folder.exists && wantedNames.get(folder.uri)?.has(source.name) === true,
        );
        if (!written) continue;
        writing.add(file.uri);
        void written.catch(fail).finally(() => writing.delete(file.uri));
      } catch (error) {
        fail(error);
      }
    }
  for (const entry of folder.list()) if (!named.has(entry.name)) entry.delete();
}
