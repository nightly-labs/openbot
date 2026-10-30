/*
 * A channel page as the data of the conversation view: its rows, the agents that work, the work that
 * stopped, and the requests that wait for the reader. Each one is a function of the page, so the
 * desktop and the browser client build the same view from it.
 */

import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  type ChannelMessage,
  type ChannelPage,
  type ChannelTask,
  type ChannelThread,
  type ConversationQuestionPrompt,
  channelRoutingConversationEvent,
} from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import type { ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { toAgentMessage, toAgentMessages } from "../../app-message-projection";

/** A row with no text, no attachment and no question has nothing to draw. */
export function channelMessageHasContent(entry: ChannelMessage): boolean {
  return Boolean(entry.message.text.trim() || entry.message.attachments?.length || entry.message.questionPrompt);
}

/**
 * One channel message as a row of the conversation view. A person's message is a `you` row with its
 * sender, so the view puts the reader's own on the right and names the other people. An agent's or
 * the coordinator's message names its author by `senderAgentId`. A routing receipt is an activity
 * row, like the "Messaged" marker of an agent chat: it has no bubble and does not count as new.
 */
function channelConversationMessage(entry: ChannelMessage): AgentMessage {
  const member = entry.author.kind === "member";
  const row = toAgentMessage(entry.message, member ? undefined : entry.author.id);
  const routing = channelRoutingConversationEvent(entry.message);
  if (routing)
    return {
      ...row,
      id: entry.id,
      kind: "action-marker",
      actionMarker: { ...routing, kind: "channel-routing", timestamp: entry.message.createdAt },
    };
  if (member)
    return { ...row, id: entry.id, author: "you", senderMember: { id: entry.author.id, name: entry.author.name } };
  return { ...row, id: entry.id, author: "agent", senderAgentId: entry.author.id };
}

/** The thinking and the narration of a turn, which fold into the steps above its answer. */
function foldedEntry(entry: ChannelMessage): boolean {
  return entry.message.author === "assistant" && entry.message.itemType === "commentary";
}

/**
 * The rows of a channel page. The thinking and narration of a member's turn fold into one thinking
 * row, as in an agent chat, and show as the steps above the member's answer. Before, each part showed
 * as a message, and a model that streams its whole reasoning (DeepSeek through OpenCode) showed a
 * very long one.
 */
export function channelConversationRows(entries: readonly ChannelMessage[]): AgentMessage[] {
  return toAgentMessages(
    entries.map((entry) => ({ ...entry.message, id: entry.id })),
    undefined,
    (message, index) => {
      const entry = entries[index];
      return entry ? channelConversationMessage(entry) : toAgentMessage(message);
    },
  );
}

/**
 * The turns whose steps show under the activity line: the newest thinking turn of each member whose
 * task runs. A stop or a resume keeps the task id, so a turn whose task this view saw stop goes into
 * `stopped` and does not show again when the task starts a new turn. The set keeps only the turns of
 * the page.
 */
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

/**
 * The row the unread divider stands on, or `null` when the reader has seen everything.
 *
 * The count comes from the channel list, and it leaves out what the reader wrote, activity rows,
 * plans, subagents and the folded thinking, so the walk back leaves them out too. The page has no
 * read pointer of its own: its `throughSequence` is the newest message of the channel, not the
 * newest the reader saw. The walk goes over the stored entries, because a thinking row stands where
 * the first item of its turn is.
 */
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

/**
 * Everyone the channel waits on: the owner of a running task, the author of a message that is still
 * arriving, and the lead while it chooses an owner. They read as one row under the transcript,
 * because a channel runs several agents at once and a row for each would push the messages away.
 *
 * The lead's routing turn moves no task out of `queued` and writes no message of its own. Without
 * it the transcript stands still while the coordinator thinks, which reads as a dropped request.
 * Only `queued` and `waiting`: routing that ends without an owner leaves the task `paused` with the
 * coordinator's reason above the composer, and that notice is the indicator from then on. A lead that
 * the user hid routes nothing until the restore, so it is not shown as working.
 */
export function channelWorkers(
  page: ChannelPage,
  agents: readonly AgentProfile[],
  fallbackName: string,
  hiddenAgentIds: ReadonlySet<string>,
): ChannelWorker[] {
  const ids = new Set<string>();
  for (const task of page.tasks) if (task.state === "running" && task.ownerAgentId) ids.add(task.ownerAgentId);
  for (const entry of page.messages)
    if (entry.message.status === "streaming" && entry.author.kind !== "member") ids.add(entry.author.id);
  const lead = page.channel.leadAgentId;
  if (
    lead &&
    !hiddenAgentIds.has(lead) &&
    page.tasks.some((task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting"))
  )
    ids.add(lead);
  return [...ids].map((id) => {
    const agent = agents.find((candidate) => candidate.id === id);
    const authored = page.messages.find((entry) => entry.author.id === id);
    return { id, name: agent?.name ?? authored?.author.name ?? fallbackName, ...(agent ? { agent } : {}) };
  });
}

/**
 * The work that waits for the reader: one entry for each stopped run, not for each stopped task.
 *
 * A task the service stopped carries the reason, and an archived channel stops every task without
 * one, so the reason tells the two apart. A failed task belongs here too: its parent waits for it,
 * and only the reader starts it again. The assignment limit stops a whole tree at once, and `resume`
 * starts a task with everything under it, so the entry is the root.
 */
export function stoppedChannelTasks(page: ChannelPage): ChannelTask[] {
  if (page.channel.archived) return [];
  const roots = new Map<string, ChannelTask>();
  for (const task of page.tasks) {
    if (!((task.state === "paused" || task.state === "failed") && task.error)) continue;
    const known = roots.get(task.rootTaskId);
    if (!known || task.id === task.rootTaskId) roots.set(task.rootTaskId, task);
  }
  return [...roots.values()];
}

/**
 * The runs that Stop ends: the top active task above each task that is queued, running or waiting.
 * `stop` pauses the whole run below the task it names, so one command for each run is enough. The
 * climb ends at a parent that is not active: a stop would pause a failed parent and clear its
 * reason, and a completed or cancelled task cannot stop.
 */
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

/** The newest question of an agent that nobody answered yet. An archived channel takes no answer. */
export function waitingChannelPrompt(
  page: ChannelPage,
): { entry: ChannelMessage; prompt: ConversationQuestionPrompt } | null {
  if (page.channel.archived) return null;
  for (let index = page.messages.length - 1; index >= 0; index -= 1) {
    const entry = page.messages[index];
    const prompt = entry?.message.questionPrompt;
    if (entry && prompt && entry.author.kind !== "member" && !prompt.resolution) return { entry, prompt };
  }
  return null;
}

/**
 * Whether a request of an agent belongs to this channel. A host with channel-attention-v1 names the
 * thread of each member. An older host does not, so a request of a member whose task runs here is
 * taken as the channel's, as the channel view took it before.
 */
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

/** The newest approval that this channel's work waits for. */
export function channelApproval(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  approvals: readonly AgentApproval[],
): AgentApproval | undefined {
  return approvals.findLast((approval) => channelOwnsRequest(page, threads, approval));
}

/** The newest browser takeover that this channel's work waits for. */
export function channelBrowserTakeover(
  page: ChannelPage,
  threads: readonly ChannelThread[] | undefined,
  takeovers: readonly BrowserTakeoverRequest[],
): BrowserTakeoverRequest | undefined {
  return takeovers.findLast((request) => channelOwnsRequest(page, threads, request));
}

/**
 * The id of the message a send stored. The command answers with the channel, not the message, so
 * the id is read from the page after it: the reader's first message after the sequence the page had
 * before the send. The same text picks it out when the reader sent two at once; a message with files
 * can have other text, so the first message after the sequence is the fallback.
 */
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
