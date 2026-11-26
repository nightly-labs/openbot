const PICTURE_CACHE = "openbot-agent-pictures-v1";
const PICTURE_PATH = "/openbot-agent-pictures/";
const SOURCE_HEADER = "X-OpenBot-Picture-Source";

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
  } catch {}
}

export function agentPictureMark(accountId: string, serverId: string) {
  const prefix = serverPrefix(accountId, serverId);
  if (!serverDeletes.has(prefix)) serverDeletes.set(prefix, 0);
  return mark(accountId, serverId);
}

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
    if (savedMark !== mark(accountId, serverId)) await cache.delete(pictureKey(accountId, serverId, agentId));
  } catch {}
}

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

export async function deleteSavedServerPictures(accountId: string, serverId: string): Promise<void> {
  changeMark(serverPrefix(accountId, serverId));
  return deleteWhere((path) => path.startsWith(serverPrefix(accountId, serverId)));
}

export async function keepSavedAgentPictures(
  accountId: string,
  serverId: string,
  agentIds: readonly string[],
): Promise<void> {
  const kept = new Set(agentIds.map((agentId) => pictureKey(accountId, serverId, agentId)));
  return deleteWhere((path) => path.startsWith(serverPrefix(accountId, serverId)) && !kept.has(path));
}
