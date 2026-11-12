/**
 * The pictures of a joined server's agents that this browser already loaded, kept in its Cache
 * storage. The saved workspace frame names each picture by the host's `openbot-avatar:` URL, which
 * only the host can answer. With a copy, the frame shows the picture while the host is offline,
 * such as during its restart for an update.
 *
 * A copy is of one account, one server and one agent, and a new picture replaces it. The copies are
 * deleted with the frames: on sign-out, when the server leaves the list, and when the host ends
 * access. A browser with no Cache storage, or that blocks it, keeps no copy.
 */

const PICTURE_CACHE = "openbot-agent-pictures-v1";
const PICTURE_PATH = "/openbot-agent-pictures/";
/** The host's URL of the saved picture. A different URL is a different picture. */
const SOURCE_HEADER = "X-OpenBot-Picture-Source";

// A delete changes the mark of each server that loses its pictures, so a picture that was read from
// the host before the delete is not saved after it. A server that keeps its pictures keeps its
// mark: the refresh of the server list must not drop the saves that are in progress.
let signOuts = 0;
const serverDeletes = new Map<string, number>();

function mark(accountId: string, serverId: string): string {
  return `${signOuts}:${serverDeletes.get(serverPrefix(accountId, serverId)) ?? 0}`;
}

function changeMark(prefix: string): void {
  serverDeletes.set(prefix, (serverDeletes.get(prefix) ?? 0) + 1);
}

function accountPrefix(accountId: string): string {
  return `${PICTURE_PATH}${encodeURIComponent(accountId)}/`;
}

function serverPrefix(accountId: string, serverId: string): string {
  return `${accountPrefix(accountId)}${encodeURIComponent(serverId)}/`;
}

function pictureKey(accountId: string, serverId: string, agentId: string): string {
  return `${serverPrefix(accountId, serverId)}${encodeURIComponent(agentId)}`;
}

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(PICTURE_CACHE);
  } catch {
    return null;
  }
}

async function deleteWhere(remove: (path: string) => boolean): Promise<void> {
  try {
    const cache = await open();
    if (!cache) return;
    for (const request of await cache.keys()) if (remove(new URL(request.url).pathname)) await cache.delete(request);
  } catch {
    // Blocked storage holds no picture.
  }
}

/** The state before a read from the host. `saveAgentPicture` saves only while it is the same. */
export function agentPictureMark(accountId: string, serverId: string) {
  const prefix = serverPrefix(accountId, serverId);
  if (!serverDeletes.has(prefix)) serverDeletes.set(prefix, 0);
  return mark(accountId, serverId);
}

/** The saved picture of `source` as a data URL, or null. */
export async function readSavedAgentPicture(
  accountId: string,
  serverId: string,
  agentId: string,
  source: string,
): Promise<string | null> {
  try {
    const response = await (await open())?.match(pictureKey(accountId, serverId, agentId));
    if (!response || response.headers.get(SOURCE_HEADER) !== encodeURIComponent(source)) return null;
    const url = await response.text();
    return url.startsWith("data:image/") ? url : null;
  } catch {
    return null;
  }
}

export async function saveAgentPicture(
  accountId: string,
  serverId: string,
  agentId: string,
  source: string,
  url: string,
  savedMark: string,
): Promise<void> {
  try {
    const cache = await open();
    if (!cache || savedMark !== mark(accountId, serverId)) return;
    await cache.put(
      pictureKey(accountId, serverId, agentId),
      new Response(url, { headers: { [SOURCE_HEADER]: encodeURIComponent(source) } }),
    );
    // A delete that started during the write did not see this picture.
    if (savedMark !== mark(accountId, serverId)) await cache.delete(pictureKey(accountId, serverId, agentId));
  } catch {
    // A full or blocked storage keeps no copy; the host has the picture.
  }
}

/**
 * Deletes the pictures of an account. With `keepServerIds`, the pictures of those servers stay;
 * without an account, the pictures of every account go, as after a sign-out.
 */
export async function deleteSavedAgentPictures(
  accountId: string | null,
  keepServerIds: readonly string[] = [],
): Promise<void> {
  if (accountId === null) {
    signOuts += 1;
    return deleteWhere((path) => path.startsWith(PICTURE_PATH));
  }
  const kept = keepServerIds.map((serverId) => serverPrefix(accountId, serverId));
  for (const prefix of serverDeletes.keys())
    if (prefix.startsWith(accountPrefix(accountId)) && !kept.includes(prefix)) changeMark(prefix);
  return deleteWhere(
    (path) => path.startsWith(accountPrefix(accountId)) && !kept.some((prefix) => path.startsWith(prefix)),
  );
}

/** Deletes the pictures of one server, as when the host ends access. */
export async function deleteSavedServerPictures(accountId: string, serverId: string): Promise<void> {
  changeMark(serverPrefix(accountId, serverId));
  return deleteWhere((path) => path.startsWith(serverPrefix(accountId, serverId)));
}

/**
 * Deletes the pictures of the agents that the server no longer has, or that now have no picture.
 * The agents in `agentIds` keep their pictures and their saves in progress.
 */
export async function keepSavedAgentPictures(
  accountId: string,
  serverId: string,
  agentIds: readonly string[],
): Promise<void> {
  const kept = new Set(agentIds.map((agentId) => pictureKey(accountId, serverId, agentId)));
  return deleteWhere((path) => path.startsWith(serverPrefix(accountId, serverId)) && !kept.has(path));
}
