export interface OutsideTarget {
  agentId: string;
  serverId: string | null;
  threadId: string | null;
}

export interface SideThreadDestination {
  type: "thread";
  serverId: string;
  agentId: string;
  taskId: string;
}

export type OutsideDestination =
  | { type: "chat"; agentId: string }
  | { type: "channel"; serverId: string; channelId: string }
  | SideThreadDestination;

interface ChannelThreads {
  id: string;
  archived?: boolean | undefined;
  threads?: readonly { threadId: string }[] | undefined;
}

interface SideThread {
  id: string;
  threadId: string;
}

export interface OutsideTargetSources {
  channels(serverId: string): Promise<readonly ChannelThreads[]>;
  knownThreads(serverId: string, agentId: string): readonly SideThread[] | undefined;
  loadThreads(serverId: string, agentId: string): Promise<readonly SideThread[]>;
}

export async function outsideDestination(
  target: OutsideTarget,
  sources: Pick<OutsideTargetSources, "channels" | "knownThreads">,
): Promise<OutsideDestination> {
  const { agentId, serverId, threadId } = target;
  const chat: OutsideDestination = { type: "chat", agentId };
  if (!serverId || !threadId) return chat;
  const known = knownSideThread(target, sources);
  if (known) return known;
  const channel = (await sources.channels(serverId)).find(
    (item) => !item.archived && item.threads?.some((thread) => thread.threadId === threadId),
  );
  if (channel) return { type: "channel", serverId, channelId: channel.id };
  return knownSideThread(target, sources) ?? chat;
}

export async function sideThreadDestination(
  target: OutsideTarget,
  sources: Pick<OutsideTargetSources, "loadThreads">,
  timeoutMs: number,
): Promise<SideThreadDestination | null> {
  const { agentId, serverId, threadId } = target;
  if (!serverId || !threadId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const threads = await Promise.race([sources.loadThreads(serverId, agentId).catch(() => null), late]);
    const thread = threads?.find((item) => item.threadId === threadId);
    return thread ? { type: "thread", serverId, agentId, taskId: thread.id } : null;
  } finally {
    clearTimeout(timer);
  }
}

export function knownSideThread(
  target: OutsideTarget,
  sources: Pick<OutsideTargetSources, "knownThreads">,
): SideThreadDestination | null {
  const { agentId, serverId, threadId } = target;
  if (!serverId || !threadId) return null;
  const thread = sources.knownThreads(serverId, agentId)?.find((item) => item.threadId === threadId);
  return thread ? { type: "thread", serverId, agentId, taskId: thread.id } : null;
}

/**
 * Waits for a server whose compatibility check has not answered yet: the task capability is then
 * unknown, not missing. A tap on a cold start arrives before the check; the channel list waits for
 * its host the same way. True when the host serves agent tasks. Stops at once when the check has
 * answered (`online`) or the host is out of reach (`offline`, `error`), so a host without agent
 * tasks waits no longer than before.
 */
export async function waitTaskCapability(
  canUseTasks: () => boolean,
  serverState: () => "unknown" | "connecting" | "online" | "offline" | "error" | undefined,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => number = Date.now,
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (canUseTasks()) return true;
    const state = serverState();
    if (state === "online" || state === "offline" || state === "error") return false;
    if (now() >= deadline) return canUseTasks();
    await sleep(250);
  }
}
