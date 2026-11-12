/**
 * What a notification or a Live Activity names: an agent, and the server and the thread of its event.
 * The thread is the agent's own chat, a side thread of the agent, or the execution thread of a channel.
 */
export interface OutsideTarget {
  agentId: string;
  serverId: string | null;
  threadId: string | null;
}

/** A side thread of an agent, as the thread screen opens it. `taskId` is its id in `agent-tasks-v1`. */
export interface SideThreadDestination {
  type: "thread";
  serverId: string;
  agentId: string;
  taskId: string;
}

/** The screen that shows the conversation of a target. */
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
  /**
   * The channels of a server once its list has loaded or failed, or after a short wait with what the
   * phone has. A tap at a cold start comes before the server connects.
   */
  channels(serverId: string): Promise<readonly ChannelThreads[]>;
  /** The side threads of the agent that the phone has read, or `undefined` when it has read none. */
  knownThreads(serverId: string, agentId: string): readonly SideThread[] | undefined;
  /** Reads the side threads of the agent from the host. It rejects when the host cannot give them. */
  loadThreads(serverId: string, agentId: string): Promise<readonly SideThread[]>;
}

/**
 * The destination that the phone can name without a request to the host: the channel of a channel
 * thread, a side thread that the phone has read, or else the agent's own chat. The phone does not
 * know the thread of an agent's own chat, so a side thread that it has not read yet also gives the
 * chat here. `sideThreadDestination` then asks the host.
 */
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
  // The list of side threads can arrive while the channels load.
  return knownSideThread(target, sources) ?? chat;
}

/**
 * The side thread of a target, read from the host, or `null` when its thread is not a side thread of
 * the agent or the host does not answer in `timeoutMs`. Use it after `outsideDestination` gave the
 * agent's chat.
 */
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
    // A host without side threads, or one that is offline, rejects: the agent's chat stays.
    const threads = await Promise.race([sources.loadThreads(serverId, agentId).catch(() => null), late]);
    const thread = threads?.find((item) => item.threadId === threadId);
    return thread ? { type: "thread", serverId, agentId, taskId: thread.id } : null;
  } finally {
    clearTimeout(timer);
  }
}

/** The side thread of a target among the threads that the phone has read, or `null`. */
export function knownSideThread(
  target: OutsideTarget,
  sources: Pick<OutsideTargetSources, "knownThreads">,
): SideThreadDestination | null {
  const { agentId, serverId, threadId } = target;
  if (!serverId || !threadId) return null;
  const thread = sources.knownThreads(serverId, agentId)?.find((item) => item.threadId === threadId);
  return thread ? { type: "thread", serverId, agentId, taskId: thread.id } : null;
}
