/*
 * The channel transcript as rows, away from the component that draws it.
 *
 * A channel message carries an author of its own kind, a sequence number and a status. A row of the
 * shared chat needs an `AgentMessage`, an author with a profile, and the answers to three questions
 * the reader sees: does this row repeat the name above it, does a new day start here, and where does
 * the unread part of the channel begin. All of that is a function of the page, so it is here and it
 * is tested as data.
 */

import type { ChannelMessage, ChannelPage } from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "../../data";
import type { ChatMessageAuthor } from "../conversation/ChatMessageRow";
import { type DayMarkerOptions, dayMarkerLabel } from "../conversation/chat-day-markers";

/**
 * How long a run of messages by one author stays one block. Beyond it the name and the face return,
 * because a reply an hour later is a new turn of the conversation, not a continuation.
 */
export const CHANNEL_GROUPING_WINDOW_MS = 5 * 60_000;

export interface ChannelTimelineEntry {
  id: string;
  sequence: number;
  authorId: string;
  author: ChatMessageAuthor;
  message: AgentMessage;
  /** False while the row continues a run by the same author: the run reads as one block. */
  showAuthor: boolean;
  /** The separator above the row, or `null` when the row stays on the day above it. */
  dayMarker: string | null;
  source: ChannelMessage;
}

/** A row with no text, no attachment and no question has nothing to draw. */
function hasContent(entry: ChannelMessage): boolean {
  return Boolean(entry.message.text.trim() || entry.message.attachments?.length || entry.message.questionPrompt);
}

function toAgentMessage(entry: ChannelMessage, own: boolean, options: DayMarkerOptions): AgentMessage {
  const message = entry.message;
  return {
    id: entry.id,
    author: own ? "you" : "agent",
    body: message.text,
    time: new Date(message.createdAt).toLocaleTimeString(options.locale, { hour: "numeric", minute: "2-digit" }),
    createdAt: message.createdAt,
    streaming: message.status === "streaming",
    status: message.status,
    itemType: message.itemType,
    senderAgentId: message.senderAgentId,
    replyToMessageId: message.replyToMessageId,
    attachments: message.attachments,
    imageGeneration: message.imageGeneration,
    questionPrompt: message.questionPrompt,
    turnId: message.turnId,
  };
}

/**
 * The rows of one channel page.
 *
 * `isOwnMessage` answers for the reader alone: a member id is the signed-in person or another
 * person of the team, and only the first stands on the right. A coordinator is an author with a
 * name, so it draws as an agent. An author the agent list no longer holds keeps its stored name and
 * seeds its face from its id, so two deleted agents do not share one face.
 */
export function channelTimelineEntries(
  page: ChannelPage,
  agents: AgentProfile[],
  isOwnMessage: (authorId: string) => boolean,
  options: DayMarkerOptions = {},
): ChannelTimelineEntry[] {
  const entries: ChannelTimelineEntry[] = [];
  let previous: ChannelTimelineEntry | undefined;
  for (const source of page.messages) {
    if (!hasContent(source)) continue;
    const own = source.author.kind === "member" && isOwnMessage(source.author.id);
    const agent = agents.find((candidate) => candidate.id === source.author.id);
    const author: ChatMessageAuthor = own
      ? { kind: "you", name: "You" }
      : { kind: "agent", name: source.author.name, agent, avatarSeed: agent ? undefined : source.author.id };
    const dayMarker = dayMarkerLabel(previous?.message.createdAt, source.message.createdAt, options);
    const sameAuthor = previous !== undefined && previous.authorId === source.author.id;
    const withinWindow =
      previous !== undefined &&
      new Date(source.message.createdAt).getTime() - new Date(previous.message.createdAt ?? "").getTime() <=
        CHANNEL_GROUPING_WINDOW_MS;
    const entry: ChannelTimelineEntry = {
      id: source.id,
      sequence: source.sequence,
      authorId: source.author.id,
      author,
      message: toAgentMessage(source, own, options),
      showAuthor: !(sameAuthor && withinWindow && dayMarker === null),
      dayMarker,
      source,
    };
    entries.push(entry);
    previous = entry;
  }
  return entries;
}

/**
 * The row the unread divider stands on, or `null` when the reader has seen everything.
 *
 * The count comes from the channel list, and it leaves out what the reader wrote, so the walk back
 * through the rows leaves it out too. The page carries no read pointer of its own: its
 * `throughSequence` is the newest message of the channel, not the newest the reader has seen.
 */
export function firstUnreadChannelMessageId(entries: ChannelTimelineEntry[], unreadCount: number): string | null {
  if (unreadCount <= 0) return null;
  let remaining = unreadCount;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.author.kind === "you") continue;
    remaining -= 1;
    if (remaining === 0) return entry.id;
  }
  return entries[0]?.id ?? null;
}
