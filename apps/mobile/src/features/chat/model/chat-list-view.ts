import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";
import { chatDayLabels } from "./chat-day-markers";
import {
  type ChatMarkerGroup,
  type ChatMessage,
  groupExchangeMarkers,
  groupRoutineRunMarkers,
  NO_CHANGED_INDEX,
  oneChangedIndex,
} from "./chat-messages";
import { startOfDay } from "./message-time";

export type ChatListRow = ChatMessage | ChatMarkerGroup;

export interface ChatListViewInput {
  messages: readonly ChatMessage[];
  shown: (message: ChatMessage) => boolean;
  focusMessageId: string | null;
  focusUnread: boolean;
  unreadMessageIds: ReadonlySet<string> | null;
  branchRowId: string | undefined;
  text: { t: MobileTranslate; format: AppFormat };
  hasOlder: boolean;
  viewableImage: (attachment: AttachmentSummary) => boolean;
}

export interface ChatListView {
  rows: ChatListRow[];
  dayLabels: ReadonlyMap<string, string>;
  images: AttachmentSummary[];
}

function listed(input: ChatListViewInput, message: ChatMessage): boolean {
  return (
    input.shown(message) ||
    (message.kind !== "thinking" && (message.id === input.focusMessageId || message.id === input.branchRowId))
  );
}

function listRows(input: ChatListViewInput): ChatListRow[] {
  const { messages, focusMessageId, focusUnread, unreadMessageIds, branchRowId } = input;
  return groupRoutineRunMarkers(groupExchangeMarkers(messages.filter((message) => listed(input, message))), {
    unreadMessageIds,
    focusMessageId: focusUnread ? null : focusMessageId,
    branchRowId: branchRowId ?? null,
  });
}

function listImages(rows: readonly ChatListRow[], viewable: ChatListViewInput["viewableImage"]): AttachmentSummary[] {
  return rows.flatMap((row) => (row.kind === "message" ? (row.attachments ?? []).filter(viewable) : []));
}

function listDayLabels(rows: readonly ChatListRow[], input: ChatListViewInput, now: Date) {
  return chatDayLabels(rows, input.text, { hasOlder: input.hasOlder, now });
}

function fullView(input: ChatListViewInput, now: Date): ChatListView {
  const rows = listRows(input);
  return { rows, dayLabels: listDayLabels(rows, input, now), images: listImages(rows, input.viewableImage) };
}

interface ViewEntry {
  input: ChatListViewInput;
  day: string;
  view: ChatListView;
}

const RECENT_VIEWS = 4;
const recentViews: ViewEntry[] = [];

const UNGROUPED_KINDS: ReadonlySet<ChatMessage["kind"]> = new Set([
  "message",
  "thinking",
  "plan",
  "subagents",
  "memory-changes",
  "question",
  "no-answer",
  "app-suggestion",
  "mcp-sign-in",
]);

function sameSettings(before: ChatListViewInput, after: ChatListViewInput): boolean {
  return (
    before.shown === after.shown &&
    before.focusMessageId === after.focusMessageId &&
    before.focusUnread === after.focusUnread &&
    before.unreadMessageIds === after.unreadMessageIds &&
    before.branchRowId === after.branchRowId &&
    before.text.t === after.text.t &&
    before.text.format === after.text.format &&
    before.hasOlder === after.hasOlder &&
    before.viewableImage === after.viewableImage
  );
}

function rowCreatedAt(row: ChatMessage): string | undefined {
  return "createdAt" in row ? row.createdAt : undefined;
}

function rowAttachments(row: ChatMessage): readonly AttachmentSummary[] | undefined {
  return row.kind === "message" ? row.attachments : undefined;
}

function streamedView(entry: ViewEntry, input: ChatListViewInput, now: Date): ChatListView | null {
  const index = oneChangedIndex(entry.input.messages, input.messages);
  if (index === null) return null;
  if (index === NO_CHANGED_INDEX) return entry.view;
  const before = entry.input.messages[index];
  const after = input.messages[index];
  if (!before || !after || before.id !== after.id || before.kind !== after.kind || !UNGROUPED_KINDS.has(after.kind))
    return null;
  const shown = listed(input, after);
  if (shown !== listed(entry.input, before)) return null;
  if (!shown) return entry.view;
  const position = entry.view.rows.indexOf(before);
  if (position < 0) return null;
  const rows = entry.view.rows.slice();
  rows[position] = after;
  return {
    rows,
    dayLabels: rowCreatedAt(before) === rowCreatedAt(after) ? entry.view.dayLabels : listDayLabels(rows, input, now),
    images:
      rowAttachments(before) === rowAttachments(after) ? entry.view.images : listImages(rows, input.viewableImage),
  };
}

export function chatListView(input: ChatListViewInput, now = new Date()): ChatListView {
  const day = `${startOfDay(now)}:${now.getTimezoneOffset()}`;
  const entry = recentViews.find((item) => item.day === day && sameSettings(item.input, input));
  const view = (entry && streamedView(entry, input, now)) ?? fullView(input, now);
  if (entry) recentViews.splice(recentViews.indexOf(entry), 1);
  recentViews.unshift({ input, day, view });
  recentViews.length = Math.min(recentViews.length, RECENT_VIEWS);
  return view;
}
