import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  type ChannelMessage,
  type ChannelPage,
  type ChannelTask,
  type ChannelThread,
  type ConversationQuestionPrompt,
  channelRoutineRequest,
  channelRoutingConversationEvent,
} from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import type { ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { coordinatorText } from "@openbot/ui/features/channels/coordinator-text";
import { toAgentMessage, toAgentMessages } from "../../app-message-projection";

export function channelMessageHasContent(entry: ChannelMessage): boolean {
  return Boolean(entry.message.text.trim() || entry.message.attachments?.length || entry.message.questionPrompt);
}

function channelConversationMessage(entry: ChannelMessage): AgentMessage {
  const member = entry.author.kind === "member";
  const row = toAgentMessage(entry.message, member ? undefined : entry.author.id);
  const routing = channelRoutingConversationEvent(entry.message);
  if (routing)
    return {
      ...row,
      id: entry.id,
      kind: "action-marker",
      actionMarker: {
        kind: "channel-routing",
        action: routing.action,
        agentIds: [routing.agentId],
        timestamp: entry.message.createdAt,
      },
    };
  if (member)
    return { ...row, id: entry.id, author: "you", senderMember: { id: entry.author.id, name: entry.author.name } };
  return { ...row, id: entry.id, author: "agent", senderAgentId: entry.author.id };
}

function foldedEntry(entry: ChannelMessage): boolean {
  return entry.message.author === "assistant" && entry.message.itemType === "commentary";
}

function channelRoutineRow(row: AgentMessage, entry: ChannelMessage, tasks: readonly ChannelTask[]): AgentMessage {
  const run = channelRoutineRequest(entry, tasks);
  if (!run) return row;
  return {
    ...row,
    kind: "action-marker",
    actionMarker: { kind: "routine-run", sourceAgentId: null, ...run, timestamp: entry.message.createdAt },
  };
}

function localizedCoordinatorEntry(entry: ChannelMessage, localize: (text: string) => string): ChannelMessage {
  const text = coordinatorText(entry.author, entry.message.text, localize);
  return text === entry.message.text ? entry : { ...entry, message: { ...entry.message, text } };
}

export function channelConversationRows(
  sourceEntries: readonly ChannelMessage[],
  tasks: readonly ChannelTask[],
  localize: (text: string) => string,
): AgentMessage[] {
  const entries = sourceEntries.map((entry) => localizedCoordinatorEntry(entry, localize));
  const rows = toAgentMessages(
    entries.map((entry) => ({ ...entry.message, id: entry.id })),
    undefined,
    (message, index) => {
      const entry = entries[index];
      return entry ? channelRoutineRow(channelConversationMessage(entry), entry, tasks) : toAgentMessage(message);
    },
  );
  const turnAuthors = new Map<string, string>();
  for (const entry of entries)
    if (entry.message.turnId && foldedEntry(entry) && entry.author.kind !== "member")
      turnAuthors.set(entry.message.turnId, entry.author.id);
  return joinRoutingRows(
    rows.map((row) => {
      const author = row.kind === "thinking" && row.turnId ? turnAuthors.get(row.turnId) : undefined;
      return author ? { ...row, senderAgentId: author } : row;
    }),
  );
}

function joinRoutingRows(rows: AgentMessage[]): AgentMessage[] {
  const joined: AgentMessage[] = [];
  for (const row of rows) {
    const marker = row.actionMarker?.kind === "channel-routing" ? row.actionMarker : undefined;
    const previous = joined.at(-1);
    const open = previous?.actionMarker?.kind === "channel-routing" ? previous.actionMarker : undefined;
    if (!marker || !previous || !open || open.action !== marker.action) {
      joined.push(row);
      continue;
    }
    const agentIds = [...open.agentIds, ...marker.agentIds.filter((id) => !open.agentIds.includes(id))];
    joined[joined.length - 1] = { ...previous, actionMarker: { ...open, agentIds, timestamp: marker.timestamp } };
  }
  return joined;
}

export function channelWorkingTurns(page: ChannelPage, stopped: Set<string>): string[] {
  const tasks = new Map(page.tasks.map((task) => [task.id, task] as const));
  const turns = new Set<string>();
  const newest = new Map<string, string>();
  for (const entry of page.messages) {
    const turnId = entry.message.turnId;
    if (!turnId || !foldedEntry(entry)) continue;
    turns.add(turnId);
    const task = entry.taskId ? tasks.get(entry.taskId) : undefined;
    if (task?.state !== "running" || task.ownerAgentId !== entry.author.id) stopped.add(turnId);
    else if (!stopped.has(turnId)) newest.set(entry.author.id, turnId);
  }
  for (const turnId of stopped) if (!turns.has(turnId)) stopped.delete(turnId);
  return [...newest.values()];
}

export function firstUnreadChannelMessageId(
  entries: readonly ChannelMessage[],
  unreadCount: number,
  isOwnSender: (memberId: string) => boolean,
): string | null {
  if (unreadCount <= 0) return null;
  const shown = entries.filter((entry) => !foldedEntry(entry));
  let remaining = unreadCount;
  for (let index = shown.length - 1; index >= 0; index -= 1) {
    const entry = shown[index];
    if (!entry) continue;
    const message = channelConversationMessage(entry);
    const own = message.author === "you" && (!message.senderMember || isOwnSender(message.senderMember.id));
    if (own || message.actionMarker || message.kind === "plan" || message.itemType === "subagents") continue;
    remaining -= 1;
    if (remaining === 0) return entry.id;
  }
  return shown[0]?.id ?? null;
}

export function channelWorkers(
  page: ChannelPage,
  agents: readonly AgentProfile[],
  fallbackName: string,
  pausedAgentIds: ReadonlySet<string>,
): ChannelWorker[] {
  const ids = new Set<string>();
  const active = new Set<string>();
  for (const task of page.tasks) {
    if (task.state === "running" && task.ownerAgentId) ids.add(task.ownerAgentId);
    if (task.state === "queued" || task.state === "running" || task.state === "waiting") active.add(task.id);
  }
  for (const entry of page.messages)
    if (
      entry.message.status === "streaming" &&
      entry.author.kind !== "member" &&
      (entry.taskId === null || active.has(entry.taskId))
    )
      ids.add(entry.author.id);
  const lead = page.channel.leadAgentId;
  if (
    lead &&
    !pausedAgentIds.has(lead) &&
    page.tasks.some((task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting"))
  )
    ids.add(lead);
  return [...ids].map((id) => {
    const agent = agents.find((candidate) => candidate.id === id);
    const authored = page.messages.find((entry) => entry.author.id === id);
    return { id, name: agent?.name ?? authored?.author.name ?? fallbackName, ...(agent ? { agent } : {}) };
  });
}

export function stoppedChannelTasks(page: ChannelPage): (ChannelTask & { runAgentIds: string[] })[] {
  if (page.channel.archived) return [];
  const roots = new Map<string, ChannelTask>();
  for (const task of page.tasks) {
    if (!((task.state === "paused" || task.state === "failed") && task.error)) continue;
    const known = roots.get(task.rootTaskId);
    if (!known || task.id === task.rootTaskId) roots.set(task.rootTaskId, task);
  }
  return [...roots.values()].map((root) => ({
    ...root,
    runAgentIds: [
      ...new Set(
        page.tasks.flatMap((task) =>
          task.rootTaskId === root.rootTaskId && task.ownerAgentId ? [task.ownerAgentId] : [],
        ),
      ),
    ],
  }));
}

export function activeChannelRuns(page: ChannelPage): string[] {
  if (page.channel.archived) return [];
  const byId = new Map(page.tasks.map((task) => [task.id, task]));
  const active = (task: ChannelTask | undefined) =>
    task?.state === "queued" || task?.state === "running" || task?.state === "waiting";
  const activeParent = (task: ChannelTask) => {
    const parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
    return active(parent) ? parent : undefined;
  };
  const runs = new Set<string>();
  for (const task of page.tasks) {
    if (!active(task)) continue;
    let top = task;
    for (let parent = activeParent(top); parent; parent = activeParent(top)) top = parent;
    runs.add(top.id);
  }
  return [...runs];
}

export function waitingChannelPrompt(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  waiting: readonly { agentId: string; threadId: string; requestId: string | number }[],
): { entry: ChannelMessage; prompt: ConversationQuestionPrompt } | null {
  if (page.channel.archived) return null;
  for (let index = page.messages.length - 1; index >= 0; index -= 1) {
    const entry = page.messages[index];
    const prompt = entry?.message.questionPrompt;
    if (
      entry &&
      prompt &&
      entry.author.kind !== "member" &&
      !prompt.resolution &&
      waiting.some(
        (request) =>
          request.agentId === entry.author.id &&
          String(request.requestId) === String(prompt.requestId) &&
          channelOwnsRequest(page, threads, request),
      )
    )
      return { entry, prompt };
  }
  return null;
}

export function liveChannelPrompt<Request extends { agentId: string; threadId: string }>(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  waiting: readonly Request[],
): Request | undefined {
  if (page.channel.archived || !threads) return undefined;
  return waiting.findLast((request) =>
    threads.some((thread) => thread.agentId === request.agentId && thread.threadId === request.threadId),
  );
}

function channelOwnsRequest(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  request: { agentId: string; threadId: string },
): boolean {
  if (page.channel.archived) return false;
  if (threads)
    return threads.some((thread) => thread.agentId === request.agentId && thread.threadId === request.threadId);
  return page.tasks.some((task) => task.ownerAgentId === request.agentId && task.state === "running");
}

export function channelApproval(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  approvals: readonly AgentApproval[],
): AgentApproval | undefined {
  return approvals.findLast((approval) => channelOwnsRequest(page, threads, approval));
}

export function channelBrowserTakeover(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  takeovers: readonly BrowserTakeoverRequest[],
): BrowserTakeoverRequest | undefined {
  return takeovers.findLast((request) => channelOwnsRequest(page, threads, request));
}

export function sentChannelMessageId(
  page: ChannelPage,
  sequenceBefore: number,
  text: string,
  isOwnSender: (memberId: string) => boolean,
): string | null {
  const own = page.messages.filter(
    (entry) => entry.sequence > sequenceBefore && entry.author.kind === "member" && isOwnSender(entry.author.id),
  );
  return (own.find((entry) => entry.message.text === text) ?? own[0])?.id ?? null;
}
