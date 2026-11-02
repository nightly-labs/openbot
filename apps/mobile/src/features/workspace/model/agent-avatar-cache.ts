import { AVATAR_MIME_TYPES, avatarFileExtension, isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { Directory, File, Paths } from "expo-file-system";

/**
 * The agent photos, kept on this phone between launches, so a photo shows without a request to the
 * host. The host gives each upload a new version `v` in the photo URL, so a saved file never becomes
 * stale. A file is at `<server>/<agent>/<v>.<extension>`. `Paths.cache` is `Library/Caches` on iOS,
 * and the system can delete it when the device is low on storage.
 */
const ROOT = "agent-avatars-v1";
const MAX_BYTES = 20 * 1024 * 1024;

const segment = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_");
const agentFolder = (serverId: string, agentId: string) =>
  new Directory(Paths.cache, ROOT, segment(serverId), segment(agentId));
const version = (avatarUrl: string) => new URL(avatarUrl).searchParams.get("v");
const filesIn = (folder: Directory): File[] =>
  folder.list().flatMap((entry) => (entry instanceof Directory ? filesIn(entry) : [entry]));

/** The oldest photos go first when the photos use more than `MAX_BYTES`. */
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

/** The saved photo as a `file://` URI, or `null` when this phone has no copy of this version. */
export function savedAgentAvatar(serverId: string, agentId: string, avatarUrl: string): string | null {
  try {
    const v = version(avatarUrl);
    if (!v) return null;
    const folder = agentFolder(serverId, agentId);
    for (const type of AVATAR_MIME_TYPES) {
      const file = new File(folder, `${segment(v)}.${avatarFileExtension(type)}`);
      if (file.exists) return file.uri;
    }
  } catch {
    // The photo loads from the host again.
  }
  return null;
}

/**
 * Saves a photo that the host sent as a data URL, and returns its `file://` URI. The older versions
 * of the agent's photo go. When the phone cannot save it, the data URL comes back unchanged.
 */
export function saveAgentAvatar(serverId: string, agentId: string, avatarUrl: string, dataUrl: string): string {
  const match = /^data:([a-z/]+);base64,(.+)$/u.exec(dataUrl);
  const v = version(avatarUrl);
  if (!v || !match?.[1] || !match[2] || !isAvatarMimeType(match[1])) return dataUrl;
  try {
    const folder = agentFolder(serverId, agentId);
    folder.create({ intermediates: true, idempotent: true });
    const name = `${segment(v)}.${avatarFileExtension(match[1])}`;
    // A crash during the write leaves only the temporary file, and the next save of this agent deletes it.
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

/** The photo as a data URL. The Live Activity writes the photo into the App Group from a data URL. */
export async function agentAvatarDataUrl(uri: string): Promise<string> {
  if (uri.startsWith("data:")) return uri;
  const file = new File(uri);
  const type = AVATAR_MIME_TYPES.find((candidate) => file.name.endsWith(`.${avatarFileExtension(candidate)}`));
  if (!type) throw new Error("The agent avatar has an unknown type.");
  return `data:${type};base64,${await file.base64()}`;
}

/** Deletes the photos of a server that this account no longer has. */
export function deleteServerAvatars(serverId: string): void {
  try {
    const folder = new Directory(Paths.cache, ROOT, segment(serverId));
    if (folder.exists) folder.delete();
  } catch {
    // The size limit deletes them later.
  }
}

/** Deletes the photos of all servers, such as on sign out. */
export function deleteAgentAvatars(): void {
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {
    // The size limit deletes them later.
  }
}
