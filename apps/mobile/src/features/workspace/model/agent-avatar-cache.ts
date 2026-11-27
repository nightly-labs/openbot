import { AVATAR_MIME_TYPES, avatarFileExtension, isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { Directory, File, Paths } from "expo-file-system";

const ROOT = "agent-avatars-v1";
const CHANNELS = "_channels";
const MAX_BYTES = 20 * 1024 * 1024;

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_");
const agentFolder = (serverId: string, agentId: string) =>
  new Directory(Paths.cache, ROOT, segment(serverId), segment(agentId));
const channelFolder = (serverId: string, channelId: string) =>
  new Directory(Paths.cache, ROOT, segment(serverId), CHANNELS, segment(channelId));
const version = (avatarUrl: string) => new URL(avatarUrl).searchParams.get("v");
const filesIn = (folder: Directory): File[] =>
  folder.list().flatMap((entry) => (entry instanceof Directory ? filesIn(entry) : [entry]));

function evict() {
  const files = filesIn(new Directory(Paths.cache, ROOT)).sort(
    (a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0),
  );
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (total <= MAX_BYTES) return;
    total -= file.size;
    file.delete();
  }
}

export function savedAgentAvatar(serverId: string, agentId: string, avatarUrl: string): string | null {
  return savedImage(() => agentFolder(serverId, agentId), avatarUrl);
}

export function savedChannelImage(serverId: string, channelId: string, imageUrl: string): string | null {
  return savedImage(() => channelFolder(serverId, channelId), imageUrl);
}

export function saveChannelImage(serverId: string, channelId: string, imageUrl: string, dataUrl: string): string {
  return saveImage(() => channelFolder(serverId, channelId), imageUrl, dataUrl);
}

function savedImage(folderOf: () => Directory, url: string): string | null {
  try {
    const v = version(url);
    if (!v) return null;
    const folder = folderOf();
    for (const type of AVATAR_MIME_TYPES) {
      const file = new File(folder, `${segment(v)}.${avatarFileExtension(type)}`);
      if (file.exists) return file.uri;
    }
  } catch {}
  return null;
}

export function saveAgentAvatar(serverId: string, agentId: string, avatarUrl: string, dataUrl: string): string {
  const uri = saveImage(() => agentFolder(serverId, agentId), avatarUrl, dataUrl);
  if (uri !== dataUrl && savedAgentAvatarNotice === null)
    savedAgentAvatarNotice = setTimeout(noticeSavedAgentAvatars, SAVED_NOTICE_DELAY_MS);
  return uri;
}

const SAVED_NOTICE_DELAY_MS = 1_000;
let savedAgentAvatars = 0;
let savedAgentAvatarNotice: ReturnType<typeof setTimeout> | null = null;
const savedAgentAvatarListeners = new Set<() => void>();

function noticeSavedAgentAvatars() {
  savedAgentAvatarNotice = null;
  savedAgentAvatars += 1;
  for (const listener of savedAgentAvatarListeners) listener();
}

export function subscribeSavedAgentAvatars(listener: () => void): () => void {
  savedAgentAvatarListeners.add(listener);
  return () => savedAgentAvatarListeners.delete(listener);
}

export function savedAgentAvatarCount() {
  return savedAgentAvatars;
}

function saveImage(folderOf: () => Directory, url: string, dataUrl: string): string {
  const match = /^data:([a-z/]+);base64,(.+)$/u.exec(dataUrl);
  const v = version(url);
  if (!v || !match?.[1] || !match[2] || !isAvatarMimeType(match[1])) return dataUrl;
  try {
    const folder = folderOf();
    folder.create({ intermediates: true, idempotent: true });
    const name = `${segment(v)}.${avatarFileExtension(match[1])}`;
    const temporary = new File(folder, `${name}.tmp`);
    temporary.writeSync(match[2], { encoding: "base64" });
    const file = new File(folder, name);
    temporary.moveSync(file, { overwrite: true });
    for (const entry of folder.list()) if (entry.name !== name) entry.delete();
    evict();
    return file.uri;
  } catch {
    return dataUrl;
  }
}

export async function agentAvatarDataUrl(uri: string): Promise<string> {
  if (uri.startsWith("data:")) return uri;
  const file = new File(uri);
  const type = AVATAR_MIME_TYPES.find((candidate) => file.name.endsWith(`.${avatarFileExtension(candidate)}`));
  if (!type) throw new Error("The agent avatar has an unknown type.");
  return `data:${type};base64,${await file.base64()}`;
}

export function deleteServerAvatars(serverId: string): void {
  try {
    const folder = new Directory(Paths.cache, ROOT, segment(serverId));
    if (folder.exists) folder.delete();
  } catch {}
}

export function deleteAgentAvatars(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {}
}
