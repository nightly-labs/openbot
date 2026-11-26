import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { WatchFaces } from "@openbot/contracts/watch-protocol";
import { File } from "expo-file-system";
import { type AvatarFileAgent, agentAvatarFile, syncAvatarFolder } from "@/features/workspace/model/agent-avatar-file";
import { appGroupDirectory } from "@/shared/lib/app-group";

const WATCH_PICTURE_FOLDER = "watch-pictures";
const WATCH_PICTURE_PIXELS = 108;
const WATCH_MOODS = ["idle", "waiting", "working"] as const satisfies readonly AvatarMood[];
const WATCH_FACE_MOODS = ["waiting", "working"] as const satisfies readonly (keyof WatchFaces)[];

function pictureName(agent: AvatarFileAgent, mood: AvatarMood): string {
  return agentAvatarFile(agent, WATCH_PICTURE_PIXELS, mood).name;
}

export function watchPictureFile(name: string): File | null {
  const folder = appGroupDirectory(WATCH_PICTURE_FOLDER);
  if (!folder) return null;
  const file = new File(folder, name);
  return file.exists ? file : null;
}

export function watchAvatar(agent: AvatarFileAgent): string | undefined {
  const name = pictureName(agent, "idle");
  return watchPictureFile(name) ? name : undefined;
}

export function watchFaces(agent: AvatarFileAgent): WatchFaces | undefined {
  const idle = pictureName(agent, "idle");
  const faces: WatchFaces = {};
  for (const mood of WATCH_FACE_MOODS) {
    const name = pictureName(agent, mood);
    if (name !== idle && watchPictureFile(name)) faces[mood] = name;
  }
  return faces.waiting || faces.working ? faces : undefined;
}

export function syncWatchPictures(agents: readonly AvatarFileAgent[]): void {
  const folder = appGroupDirectory(WATCH_PICTURE_FOLDER);
  if (!folder) return;
  const named = new Set(agents.flatMap((agent) => WATCH_MOODS.map((mood) => pictureName(agent, mood))));
  syncAvatarFolder(folder, named, agents, WATCH_PICTURE_PIXELS, "Watch avatar", WATCH_MOODS);
}
