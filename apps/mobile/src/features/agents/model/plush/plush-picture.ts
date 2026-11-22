import { avatarHeadColor, avatarStyleForSeed } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { ImageFormat, Skia } from "@shopify/react-native-skia";
import { Directory, File, Paths } from "expo-file-system";
import { drawFlat, flatGeometryKey, flatRestFrame } from "./flat-draw";
import { loadPlushArt } from "./plush-assets";
import { drawPlush } from "./plush-draw";
import { plushGeometry, plushRestFrame } from "./plush-frames";

export const PLUSH_STYLE = "plush-2";
const FOLDER = "plush-avatars-v1";
const MAX_FILES = 400;
const EVICT_EVERY = 50;

export interface PlushPictureSpec {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  mood: AvatarMood;
  pixels: number;
  saturation: number;
}

export function nameHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function plushPictureName(spec: PlushPictureSpec): string {
  const key =
    avatarStyleForSeed(spec.seed) === "flat"
      ? flatGeometryKey(spec.seed, spec.mood)
      : plushGeometry(spec.seed, spec.mood).key;
  const color = avatarHeadColor(spec.seed, spec.hue, spec.color);
  return `${nameHash(`${PLUSH_STYLE}|${key}|${color}|${spec.pixels}|${spec.saturation}`)}.png`;
}

export async function renderPlushPicture(spec: PlushPictureSpec): Promise<string> {
  const color = avatarHeadColor(spec.seed, spec.hue, spec.color);
  const surface = Skia.Surface.Make(spec.pixels, spec.pixels);
  if (!surface) throw new Error("The plush surface is unavailable.");
  if (avatarStyleForSeed(spec.seed) === "flat") {
    drawFlat(surface.getCanvas(), flatRestFrame(spec.seed, spec.mood), color, spec.pixels, spec.saturation);
  } else {
    const geometry = plushGeometry(spec.seed, spec.mood);
    const art = await loadPlushArt(geometry.shape, color, spec.pixels);
    drawPlush(surface.getCanvas(), plushRestFrame(geometry), art, spec.pixels, spec.saturation);
  }
  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG);
}

const folder = () => new Directory(Paths.cache, FOLDER);
const saved = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();
let writtenSinceEvict: number | null = null;

function evict(directory: Directory) {
  writtenSinceEvict = 0;
  const files = directory
    .list()
    .flatMap((entry) => (entry instanceof File ? [entry] : []))
    .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
  for (const file of files.slice(0, Math.max(0, files.length - MAX_FILES))) {
    saved.delete(file.name);
    file.delete();
  }
}

export function savedPlushPicture(spec: PlushPictureSpec): string | null {
  const name = plushPictureName(spec);
  const known = saved.get(name);
  if (known) return known;
  try {
    const file = new File(folder(), name);
    if (!file.exists) return null;
    saved.set(name, file.uri);
    return file.uri;
  } catch {
    return null;
  }
}

const nextIdle = () => new Promise<void>((resolve) => requestIdleCallback(() => resolve()));

export function loadPlushPicture(spec: PlushPictureSpec): Promise<string | null> {
  const name = plushPictureName(spec);
  const known = savedPlushPicture(spec);
  if (known) return Promise.resolve(known);
  const current = pending.get(name);
  if (current) return current;
  const loading = queue
    .then(nextIdle)
    .then(async () => {
      const data = await renderPlushPicture(spec);
      const directory = folder();
      directory.create({ intermediates: true, idempotent: true });
      if (writtenSinceEvict === null || writtenSinceEvict >= EVICT_EVERY) evict(directory);
      writtenSinceEvict = (writtenSinceEvict ?? 0) + 1;
      const file = new File(directory, name);
      file.writeSync(data, { encoding: "base64" });
      saved.set(name, file.uri);
      return file.uri;
    })
    .catch(() => null)
    .finally(() => pending.delete(name));
  queue = loading;
  pending.set(name, loading);
  return loading;
}
