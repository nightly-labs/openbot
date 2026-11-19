import { agentMentionRank } from "@openbot/contracts/agent-mention-rank";
import type {
  ChannelSummary,
  ConversationFileSearchResult,
  ConversationMessage,
  ConversationSearchResult,
  RoutineCalendarOwner,
  RoutineCalendarRoutine,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";

export const MOBILE_SEARCH_FILTERS = [
  "all",
  "agents",
  "channels",
  "messages",
  "files",
  "routines",
  "settings",
] as const;
export type MobileSearchFilter = (typeof MOBILE_SEARCH_FILTERS)[number];
type MobileSearchSectionKey = Exclude<MobileSearchFilter, "all">;

export type MobileSearchSettingId =
  | "profile"
  | "sessions"
  | "appearance"
  | "animations"
  | "language"
  | "haptics"
  | "notifications"
  | "liveActivities"
  | "privacy"
  | "conversations"
  | "hiddenChats"
  | "deletedChannels"
  | "support"
  | "about"
  | "serverOptions"
  | "serverMembers"
  | "serverRoutines"
  | "serverUsage";

export interface MobileSearchSetting {
  id: MobileSearchSettingId;
  title: string;
  detail: string;
}

export type MobileSearchResult =
  | { kind: "agent"; id: string; agent: MobileAgent }
  | { kind: "channel"; id: string; channel: ChannelSummary }
  | {
      kind: "message";
      id: string;
      agent: MobileAgent;
      message: ConversationMessage;
      text: string;
      from: MobileSearchMessageAuthor;
    }
  | { kind: "file"; id: string; agent: MobileAgent; file: ConversationFileSearchResult }
  | { kind: "setting"; id: string; setting: MobileSearchSetting }
  | {
      kind: "routine";
      id: string;
      routine: RoutineCalendarRoutine;
      owner:
        | { kind: "agent"; agent: MobileAgent; name: string }
        | { kind: "channel"; channel: ChannelSummary; name: string };
    };

type MobileSearchMessageAuthor = "agent" | "you" | { member: string };

export type MobileRemoteSearch<T> =
  | { status: "idle" }
  | {
      status: "loading" | "error" | "ready";
      items: T[];
      hasMore: boolean;
      pages?: number;
    };

interface MobileSearchSection {
  key: MobileSearchSectionKey;
  results: MobileSearchResult[];
  more: boolean;
}

export interface MobileSearchView {
  state: "results" | "loading" | "error" | "empty" | "hint";
  sections: MobileSearchSection[];
  loading: boolean;
  failed: boolean;
  canLoadMore: boolean;
  readOn: { messages: boolean; files: boolean };
}

const ALL_SECTION_LIMIT = 3;
const READ_ON_PAGE_LIMIT = 3;

export function normalizeMobileSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function mobileSearchSources(filter: MobileSearchFilter, query: string) {
  const typed = normalizeMobileSearchQuery(query) !== "";
  return {
    messages: typed && (filter === "all" || filter === "messages"),
    files: filter === "files" || (filter === "all" && typed),
    routines: filter === "routines" || (filter === "all" && typed),
  };
}

function matches(query: string, values: readonly (string | undefined)[]): boolean {
  return !query || values.some((value) => value !== undefined && normalizeMobileSearchQuery(value).includes(query));
}

function searchableMessageText(message: ConversationMessage): string {
  if (message.author === "assistant" && message.itemType === "commentary") return "";
  return markdownPreviewText(message.text);
}

export interface MobileSearchReader {
  memberId: string | null;
  accountUserId: string | null;
}

function messageAuthor(message: ConversationMessage, reader: MobileSearchReader): MobileSearchMessageAuthor {
  if (message.author !== "user") return "agent";
  const sender = message.senderMember;
  const other =
    sender !== undefined &&
    reader.memberId !== null &&
    sender.id !== reader.memberId &&
    sender.id !== `local-user:${reader.accountUserId ?? ""}`;
  return other ? { member: sender.name } : "you";
}

function remoteState<T>(search: MobileRemoteSearch<T>, rows: number) {
  if (search.status === "idle") return { loading: false, failed: false, hasMore: false, readOn: false };
  const readOn = search.status === "ready" && search.hasMore && rows === 0 && (search.pages ?? 1) < READ_ON_PAGE_LIMIT;
  return {
    loading: search.status === "loading" || readOn,
    failed: search.status === "error",
    hasMore: search.hasMore,
    readOn,
  };
}

export function mobileSearchView({
  query,
  filter,
  reader,
  agents,
  channels,
  settings,
  routines,
  messages,
  files,
}: {
  query: string;
  filter: MobileSearchFilter;
  reader: MobileSearchReader;
  agents: MobileAgent[];
  channels: ChannelSummary[];
  settings: MobileSearchSetting[];
  routines: { status: "idle" | "loading" | "error" | "ready"; items: RoutineCalendarRoutine[] };
  messages: MobileRemoteSearch<ConversationSearchResult>;
  files: MobileRemoteSearch<ConversationFileSearchResult>;
}): MobileSearchView {
  const normalized = normalizeMobileSearchQuery(query);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  const agentResults = agents
    .filter((agent) => matches(normalized, [agent.name, agent.title, agent.description, agent.preview]))
    .map((agent) => ({ agent, rank: agentMentionRank(agent, normalized) ?? Number.MAX_VALUE }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ agent }): MobileSearchResult => ({ kind: "agent", id: `agent:${agent.id}`, agent }));
  const channelResults = channels
    .filter((channel) => matches(normalized, [channel.name, channel.title]))
    .map((channel): MobileSearchResult => ({ kind: "channel", id: `channel:${channel.id}`, channel }));
  const settingResults = settings
    .filter((setting) => matches(normalized, [setting.title, setting.detail]))
    .map((setting): MobileSearchResult => ({ kind: "setting", id: `setting:${setting.id}`, setting }));
  const routineOwner = (owner: RoutineCalendarOwner) => {
    if (owner.kind === "agent") {
      const agent = agentsById.get(owner.agentId);
      return agent ? { kind: "agent" as const, agent, name: agent.name } : null;
    }
    const channel = channelsById.get(owner.channelId);
    return channel ? { kind: "channel" as const, channel, name: channel.name } : null;
  };
  const routineResults = routines.items.flatMap((routine): MobileSearchResult[] => {
    const owner = routineOwner(routine.owner);
    if (!owner || !matches(normalized, [routine.name, owner.name])) return [];
    return [{ kind: "routine", id: `routine:${routine.id}`, routine, owner }];
  });
  const messageResults =
    messages.status === "idle"
      ? []
      : messages.items.flatMap(({ agentId, message }): MobileSearchResult[] => {
          const agent = agentsById.get(agentId);
          const text = searchableMessageText(message);
          if (!agent || !text) return [];
          const from = messageAuthor(message, reader);
          return [{ kind: "message", id: `message:${agentId}:${message.id}`, agent, message, text, from }];
        });
  const fileResults =
    files.status === "idle"
      ? []
      : files.items.flatMap((file): MobileSearchResult[] => {
          const agent = agentsById.get(file.agentId);
          return agent
            ? [{ kind: "file", id: `file:${file.agentId}:${file.messageId}:${file.attachment.id}`, agent, file }]
            : [];
        });

  const messageState = remoteState(messages, messageResults.length);
  const fileState = remoteState(files, fileResults.length);
  const routinesLoading = routines.status === "loading";
  const routinesFailed = routines.status === "error";

  const full = (key: MobileSearchSectionKey, results: MobileSearchResult[]): MobileSearchSection => ({
    key,
    results,
    more: false,
  });
  const preview = (key: MobileSearchSectionKey, results: MobileSearchResult[], hasMore = false) => ({
    key,
    results: results.slice(0, ALL_SECTION_LIMIT),
    more: results.length > ALL_SECTION_LIMIT || hasMore,
  });
  let sections: MobileSearchSection[] = [];
  let loading = false;
  let failed = false;
  let canLoadMore = false;
  switch (filter) {
    case "agents":
      sections = [full("agents", agentResults)];
      break;
    case "channels":
      sections = [full("channels", channelResults)];
      break;
    case "messages":
      sections = [full("messages", messageResults)];
      loading = messageState.loading;
      failed = messageState.failed;
      canLoadMore = messages.status === "ready" && messageState.hasMore && !messageState.readOn;
      break;
    case "files":
      sections = [full("files", fileResults)];
      loading = fileState.loading;
      failed = fileState.failed;
      canLoadMore = files.status === "ready" && fileState.hasMore && !fileState.readOn;
      break;
    case "routines":
      sections = [full("routines", routineResults)];
      loading = routinesLoading;
      failed = routinesFailed;
      break;
    case "settings":
      sections = [full("settings", settingResults)];
      break;
    case "all":
      sections = normalized
        ? [
            preview("agents", agentResults),
            preview("channels", channelResults),
            preview("messages", messageResults, messageState.hasMore),
            preview("files", fileResults, fileState.hasMore),
            preview("routines", routineResults),
            preview("settings", settingResults),
          ]
        : [full("agents", agentResults), full("channels", channelResults)];
      loading = messageState.loading || fileState.loading || routinesLoading;
      failed = messageState.failed || fileState.failed || routinesFailed;
      break;
  }
  sections = sections.filter((section) => section.results.length > 0);
  const state =
    sections.length > 0 || canLoadMore
      ? "results"
      : loading
        ? "loading"
        : failed
          ? "error"
          : filter === "messages" && !normalized
            ? "hint"
            : "empty";
  return {
    state,
    sections,
    loading,
    failed,
    canLoadMore,
    readOn: { messages: messageState.readOn, files: fileState.readOn },
  };
}

export interface MobileSearchMatchPart {
  text: string;
  match: boolean;
}

export function mobileSearchMatchParts(text: string, query: string): MobileSearchMatchPart[] {
  const needle = normalizeMobileSearchQuery(query);
  const lowered = text.toLocaleLowerCase();
  if (!needle || lowered.length !== text.length) return [{ text, match: false }];
  const parts: MobileSearchMatchPart[] = [];
  let cursor = 0;
  let index = lowered.indexOf(needle);
  while (index >= 0) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lowered.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

export function mobileSearchSnippet(text: string, query: string, lead = 40): string {
  const needle = normalizeMobileSearchQuery(query);
  const lowered = text.toLocaleLowerCase();
  const index = needle && lowered.length === text.length ? lowered.indexOf(needle) : -1;
  if (index <= lead) return text;
  const start = index - lead;
  const wordStart = text.indexOf(" ", start);
  return `…${text.slice(wordStart >= 0 && wordStart < index ? wordStart + 1 : start)}`;
}
