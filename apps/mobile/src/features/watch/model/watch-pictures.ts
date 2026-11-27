import { serverPlushHex } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { WatchFaces } from "@openbot/contracts/watch-protocol";
import { ClipOp, FilterMode, ImageFormat, MipmapMode, type SkImage, Skia } from "@shopify/react-native-skia";
import { type Directory, File } from "expo-file-system";
import { nameHash } from "@/features/agents/model/plush/plush-picture";
import { loadServerLogo, SERVER_AVATAR_CORNER_RATIO } from "@/features/servers/model/server-logo";
import { loadServerPlush } from "@/features/servers/model/server-plush";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { type AvatarFileAgent, agentAvatarFile, syncAvatarFolder } from "@/features/workspace/model/agent-avatar-file";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { appGroupDirectory } from "@/shared/lib/app-group";

const WATCH_PICTURE_FOLDER = "watch-pictures";
const WATCH_PICTURE_PIXELS = 108;
const WATCH_MOODS = ["idle", "waiting", "working"] as const satisfies readonly AvatarMood[];
const WATCH_FACE_MOODS = ["waiting", "working"] as const satisfies readonly (keyof WatchFaces)[];
const WATCH_SERVER_PICTURE_FOLDER = "watch-server-pictures";
const WATCH_SERVER_PICTURE_PIXELS = [192, 144, 108] as const;
const WATCH_SERVER_PICTURE_LIMIT = 40_000;
const WATCH_SERVER_PICTURE_RETRY_MS = 5 * 60_000;
const writingServerPictures = new Set<string>();
const failedServerPictures = new Map<string, number>();
let wantedServerPictures: ReadonlySet<string> = new Set();

function pictureName(agent: AvatarFileAgent, mood: AvatarMood): string {
  return agentAvatarFile(agent, WATCH_PICTURE_PIXELS, mood).name;
}

export function watchPictureFile(name: string): File | null {
  for (const folderName of [WATCH_PICTURE_FOLDER, WATCH_SERVER_PICTURE_FOLDER]) {
    const folder = appGroupDirectory(folderName);
    if (!folder) continue;
    const file = new File(folder, name);
    if (file.exists) return file;
  }
  return null;
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

type WatchServerPictureSource = Pick<MobileServer, "id" | "logoKey" | "appearance">;
type ServerSession = { apiUrl: string; sessionToken: string } | null;

function serverPictureName(server: WatchServerPictureSource): string {
  const look = server.logoKey
    ? `logo|${server.logoKey}`
    : `plush|${server.appearance?.shape ?? "squircle"}|${serverPlushHex(server.id, server.appearance?.color)}`;
  return `server-${nameHash(`${server.id}|${look}`)}.png`;
}

export function watchServerPicture(server: WatchServerPictureSource): string | undefined {
  const name = serverPictureName(server);
  return watchPictureFile(name) ? name : undefined;
}

function base64Part(uri: string): string {
  return uri.slice(uri.indexOf(",") + 1);
}

function roundedLogo(image: SkImage, pixels: number): string {
  const surface = Skia.Surface.Make(pixels, pixels);
  if (!surface) throw new Error("The server logo surface is unavailable.");
  const canvas = surface.getCanvas();
  const corner = pixels * SERVER_AVATAR_CORNER_RATIO;
  canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, pixels, pixels), corner, corner), ClipOp.Intersect, true);
  const side = Math.min(image.width(), image.height());
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect((image.width() - side) / 2, (image.height() - side) / 2, side, side),
    Skia.XYWHRect(0, 0, pixels, pixels),
    FilterMode.Linear,
    MipmapMode.Linear,
    paint,
  );
  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG);
}

async function serverPictureDrawer(
  server: WatchServerPictureSource,
  session: ServerSession,
): Promise<(pixels: number) => Promise<string>> {
  if (server.logoKey) {
    if (!session) throw new Error("The server logo needs a session.");
    const logo = await loadServerLogo(session, server.id, server.logoKey);
    const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64Part(logo)));
    if (!image) throw new Error("The server logo cannot be read.");
    return async (pixels) => roundedLogo(image, pixels);
  }
  const shape = server.appearance?.shape ?? "squircle";
  const hex = serverPlushHex(server.id, server.appearance?.color);
  return async (pixels) => base64Part(await loadServerPlush(shape, hex, pixels, 1));
}

async function writeServerPicture(
  folder: Directory,
  server: WatchServerPictureSource,
  session: ServerSession,
): Promise<boolean> {
  const name = serverPictureName(server);
  const file = new File(folder, name);
  if (file.exists || writingServerPictures.has(file.uri)) return false;
  if (Date.now() - (failedServerPictures.get(name) ?? 0) < WATCH_SERVER_PICTURE_RETRY_MS) return false;
  writingServerPictures.add(file.uri);
  try {
    const draw = await serverPictureDrawer(server, session);
    for (const pixels of WATCH_SERVER_PICTURE_PIXELS) {
      const data = await draw(pixels);
      if (data.length > WATCH_SERVER_PICTURE_LIMIT) continue;
      if (!folder.exists || file.exists || !wantedServerPictures.has(name)) return false;
      file.writeSync(data, { encoding: "base64" });
      failedServerPictures.delete(name);
      return true;
    }
    failedServerPictures.set(name, Date.now());
    return false;
  } catch (error) {
    failedServerPictures.set(name, Date.now());
    supportLog.add("warn", "app", `Watch server picture not saved: ${supportLogValue(error)}`);
    return false;
  } finally {
    writingServerPictures.delete(file.uri);
  }
}

export async function syncWatchServerPictures(
  servers: readonly WatchServerPictureSource[],
  session: ServerSession,
): Promise<boolean> {
  const folder = appGroupDirectory(WATCH_SERVER_PICTURE_FOLDER);
  if (!folder) return false;
  const named = new Set(servers.map(serverPictureName));
  wantedServerPictures = named;
  try {
    folder.create({ intermediates: true, idempotent: true });
    for (const entry of folder.list()) if (!named.has(entry.name)) entry.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Watch server pictures not synced: ${supportLogValue(error)}`);
    return false;
  }
  const written = await Promise.all(servers.map((server) => writeServerPicture(folder, server, session)));
  return written.some(Boolean);
}
