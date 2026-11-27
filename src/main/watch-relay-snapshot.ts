import { createHash } from "node:crypto";
import { ARTICLE_GRADIENT_BRAND_HEXES } from "@openbot/brand/article-gradient";
import { avatarHeadColor, serverPlushHex } from "@openbot/brand/bloub-avatar";
import { coordinatorText } from "@openbot/contracts/coordinator-text";
import {
  type AgentApproval,
  type AgentRuntimePrompt,
  type AgentRuntimeSnapshot,
  type AgentSummary,
  type ChannelSummary,
  type ConversationReadState,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
  type SidebarPin,
  sidebarFolderParents,
  sidebarFolderPath,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import {
  WATCH_AGENT_LIMIT,
  WATCH_APPROVAL_LIMIT,
  WATCH_CHANNEL_MEMBERS,
  WATCH_PROTOCOL_VERSION,
  WATCH_REPLY_LIMIT,
  type WatchAgent,
  type WatchChannel,
  type WatchQuestion,
  type WatchSnapshot,
  type WatchWait,
  watchChannelsWithinLimit,
  watchText,
} from "@openbot/contracts/watch-protocol";
import { type AppFormat, createFormat } from "@openbot/i18n/format";
import {
  localizeSourceText,
  type MobileTranslate,
  mobileTranslateFor,
  resolveLocale,
  type TranslatedLocale,
} from "@openbot/i18n/mobile";
import { feedbackApproval } from "@openbot/team-client/feedback-approval";

const WATCH_TEXT_KEYS = [
  "mobile.watch.state.approval",
  "mobile.watch.state.question",
  "mobile.watch.state.takeover",
  "mobile.watch.state.working",
  "mobile.watch.state.idle",
  "mobile.watch.action.openOnPhone",
  "mobile.watch.action.dictate",
  "mobile.watch.action.message",
  "mobile.watch.action.listen",
  "mobile.watch.action.stop",
  "mobile.watch.action.send",
  "mobile.watch.action.again",
  "mobile.watch.action.retry",
  "mobile.watch.approval.tooLong",
  "mobile.watch.approval.onPhone",
  "mobile.watch.question.onPhone",
  "mobile.watch.takeover.onPhone",
  "mobile.watch.stop.detail",
  "mobile.watch.compose.newMessage",
  "mobile.watch.compose.answer",
  "mobile.watch.compose.review",
  "mobile.watch.done.allowed",
  "mobile.watch.done.denied",
  "mobile.watch.done.answered",
  "mobile.watch.done.stopped",
  "mobile.watch.done.onPhone",
  "mobile.watch.listen.reading",
  "mobile.watch.reply.none",
  "mobile.watch.offline.title",
  "mobile.watch.offline.detail",
  "mobile.watch.offline.unlock",
  "mobile.watch.list.pinned",
  "mobile.watch.settings.title",
  "mobile.watch.settings.theme",
  "mobile.watch.settings.themeDetail",
  "mobile.watch.question.private",
  "mobile.agent.list.waiting.title",
  "mobile.agent.list.unreadGroup.title",
  "mobile.server.drawer.title",
  "mobile.chat.question.next",
  "mobile.watch.disconnected.title",
  "mobile.watch.disconnected.detail",
  "mobile.watch.locked.title",
  "mobile.watch.locked.detail",
  "mobile.watch.empty",
  "mobile.watch.error.inactive",
  "mobile.watch.error.offline",
  "mobile.watch.error.failed",
  "mobile.watch.error.timeout",
  "mobile.watch.error.asleep",
  "mobile.watch.complication.clear",
  "mobile.chat.approval.allow",
  "mobile.chat.approval.deny",
  "common.cancel",
] as const;

const SHELL_WRAPPER = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh -l?c (?:'([^']*)'|"([^"\\$`]*)")$/su;
const HOME_FOLDER = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/u;
const AVATAR_EXTENSIONS: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg" };

export interface WatchText {
  locale: TranslatedLocale;
  t: MobileTranslate;
  format: AppFormat;
}

export function watchTextFor(language: string | undefined): WatchText {
  const locale = resolveLocale("system", language ?? "en");
  return { locale, t: mobileTranslateFor(locale), format: createFormat(locale) };
}

export interface WatchAvatarFile {
  path: string;
  mimeType: string;
  version: string;
}

export function watchAvatarName(agentId: string, avatar: WatchAvatarFile): string | null {
  const extension = AVATAR_EXTENSIONS[avatar.mimeType];
  if (!extension) return null;
  const hash = createHash("sha256").update(`${agentId}\n${avatar.version}`).digest("base64url").slice(0, 32);
  return `${hash}.${extension}`;
}

export interface HostWatchSnapshotInput {
  hostId: string;
  serverName: string;
  appearance: ServerAppearance | null;
  watchKey: string;
  agents: readonly AgentSummary[];
  runtime: AgentRuntimeSnapshot;
  prompts: readonly AgentRuntimePrompt[];
  wholeApproval: (requestId: string | number) => AgentApproval | undefined;
  reads: Readonly<Record<string, ConversationReadState>>;
  pins: readonly SidebarPin[];
  layout: SidebarLayoutSnapshot | null;
  channels: readonly ChannelSummary[];
  avatar: (agentId: string) => string | null;
  text: WatchText;
  now: number;
}

function watchTexts(t: MobileTranslate, waiting: number): Record<string, string> {
  const text: Record<string, string> = {};
  for (const key of WATCH_TEXT_KEYS) text[key] = t(key);
  text["mobile.watch.approval.where"] = t("mobile.watch.approval.where", { path: "{path}" });
  text["mobile.watch.stop.title"] = t("mobile.watch.stop.title", { name: "{name}" });
  text["mobile.watch.done.sent"] = t("mobile.watch.done.sent", { name: "{name}" });
  text["mobile.watch.updated"] = t("mobile.watch.updated", { time: "{time}" });
  text["mobile.chat.question.position"] = t("mobile.chat.question.position", {
    current: "{current}",
    total: "{total}",
  });
  text["mobile.watch.complication.waiting"] = t("mobile.watch.complication.waiting", { count: waiting });
  return text;
}

function approvalCommandText(command: string): string {
  const match = SHELL_WRAPPER.exec(command);
  return match?.[1] ?? match?.[2] ?? command;
}

function shortPath(path: string): string {
  return path.replace(HOME_FOLDER, "~");
}

function approvalTitle(approval: AgentApproval, t: MobileTranslate): string {
  if (approval.kind === "command") return t("mobile.chat.approval.title.command");
  if (approval.kind === "file-change") return t("mobile.chat.approval.title.fileChange");
  return t("mobile.chat.approval.title.permissions");
}

function approvalWait(approval: AgentApproval, partial: boolean, text: WatchText): WatchWait {
  const { t } = text;
  if (feedbackApproval(approval)) return { kind: "phone", reason: "approval", text: null };
  const lines: string[] = [];
  if (approval.command) lines.push(approvalCommandText(approval.command));
  if (approval.kind === "file-change") {
    lines.push(
      `${t("mobile.chat.approval.files")}: ${approval.grantRoot ? shortPath(approval.grantRoot) : t("mobile.chat.approval.agentWorkspace")}`,
    );
  }
  const permissions = approval.kind === "permissions" ? approval.permissions : null;
  if (permissions) {
    if (permissions.network) lines.push(t("mobile.chat.approval.network"));
    for (const path of permissions.fileSystem.read)
      lines.push(t("mobile.chat.approval.read", { path: shortPath(path) }));
    for (const path of permissions.fileSystem.write)
      lines.push(t("mobile.chat.approval.write", { path: shortPath(path) }));
  }
  const whole = lines.join("\n");
  const body = watchText(whole, WATCH_APPROVAL_LIMIT) ?? approvalTitle(approval, t);
  return {
    kind: "approval",
    requestId: String(approval.requestId),
    title: approvalTitle(approval, t),
    body,
    where: approval.command && approval.cwd ? shortPath(approval.cwd) : null,
    why: watchText(approval.reason ? localizeSourceText(approval.reason, text.locale) : null),
    whole: !partial && whole.length <= WATCH_APPROVAL_LIMIT,
  };
}

function questionWait(prompt: AgentRuntimePrompt): WatchWait {
  const questions = prompt.questions;
  if (questions.length === 0) return { kind: "phone", reason: "question", text: null };
  const secret = questions.find((question) => question.isSecret);
  if (secret) {
    return { kind: "phone", reason: "question", text: watchText(secret.question) ?? watchText(secret.header) };
  }
  return {
    kind: "question",
    requestId: String(prompt.requestId),
    questions: questions.slice(0, 10).map(
      (question): WatchQuestion => ({
        id: question.id,
        header: watchText(question.header, 80) ?? "",
        question: watchText(question.question) ?? question.header,
        options: (question.options ?? []).map((option) => option.label).slice(0, 8),
        multiSelect: question.multiSelect === true,
      }),
    ),
  };
}

function isTaskThread(agent: AgentSummary, threadId: string): boolean {
  return agent.threadId !== null && agent.threadId !== threadId;
}

interface AgentWait {
  wait: WatchWait;
  turnId: string;
}

function agentWait(agent: AgentSummary, input: HostWatchSnapshotInput): AgentWait | null {
  const { runtime } = input;
  const listed = runtime.pendingApprovals.find((item) => item.agentId === agent.id);
  if (listed) {
    const whole = input.wholeApproval(listed.requestId);
    return {
      wait: approvalWait(whole ?? listed, !whole && listed.truncated, input.text),
      turnId: listed.turnId,
    };
  }
  const prompt = input.prompts.find((item) => item.agentId === agent.id);
  if (prompt) {
    const task = prompt.detached === true || isTaskThread(agent, prompt.threadId);
    return {
      wait: task ? { kind: "phone", reason: "question", text: null } : questionWait(prompt),
      turnId: prompt.turnId,
    };
  }
  const takeover = runtime.pendingBrowserTakeovers.find((item) => item.agentId === agent.id);
  if (takeover) return { wait: { kind: "phone", reason: "takeover", text: null }, turnId: takeover.turnId };
  return null;
}

function activeTurnId(agentId: string, runtime: AgentRuntimeSnapshot): string | null {
  const turn = runtime.activeTurns.find((item) => item.agentId === agentId);
  if (turn) return turn.turnId;
  const work = runtime.work.find((item) => item.agentId === agentId && item.status !== "failed");
  return work ? work.turnId : null;
}

type SidebarChat =
  | { kind: "agent"; id: string; agent: AgentSummary }
  | { kind: "channel"; id: string; channel: ChannelSummary };

interface PlacedChat {
  chat: SidebarChat;
  folder: string | null;
}

interface PlacedAgent {
  agent: AgentSummary;
  folder: string | null;
  position: number;
}

interface PlacedChannel {
  channel: ChannelSummary;
  folder: string | null;
  position: number;
  pinned: boolean;
}

function sidebarOrder(
  layout: SidebarLayoutSnapshot | null,
  chats: readonly SidebarChat[],
  t: WatchText["t"],
): PlacedChat[] {
  const positions = new Map(layout?.agentOrder.map((id, index) => [id, index]));
  const placed = layout
    ? [...chats].sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size))
    : [...chats];
  if (!layout) return placed.map((chat) => ({ chat, folder: null }));
  const sections = new Set(layout.sections.map((section) => section.id));
  const groups = new Map<string, SidebarChat[]>();
  for (const chat of placed) {
    const assigned = layout.agentAssignments[chat.id];
    const sectionId = assigned && sections.has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(sectionId) ?? [];
    group.push(chat);
    groups.set(sectionId, group);
  }
  const parents = sidebarFolderParents(layout);
  return layout.order.flatMap((id) => {
    if (!sections.has(id) && id !== SIDEBAR_UNASSIGNED_SECTION_ID) return [];
    const folder = sections.has(id)
      ? sidebarFolderPath(layout, parents, id).join(" / ")
      : t("mobile.workspace.section.agents");
    return (groups.get(id) ?? []).map((chat) => ({ chat, folder }));
  });
}

function appOrder(input: HostWatchSnapshotInput): { agents: PlacedAgent[]; channels: PlacedChannel[] } {
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const channelsById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const agents: PlacedAgent[] = [];
  const channels: PlacedChannel[] = [];
  let position = 0;
  for (const pin of input.pins) {
    const agent = pin.kind === "agent" ? agentsById.get(pin.id) : undefined;
    const channel = pin.kind === "channel" ? channelsById.get(pin.id) : undefined;
    if (agent) agents.push({ agent, folder: null, position: position++ });
    if (channel) channels.push({ channel, folder: null, position: position++, pinned: true });
  }
  const pinnedAgents = new Set(agents.map((item) => item.agent.id));
  const pinnedChannels = new Set(channels.map((item) => item.channel.id));
  const chats: SidebarChat[] = [
    ...input.channels
      .filter((channel) => !pinnedChannels.has(channel.id))
      .map((channel): SidebarChat => ({ kind: "channel", id: channel.id, channel })),
    ...input.agents
      .filter((agent) => !pinnedAgents.has(agent.id))
      .map((agent): SidebarChat => ({ kind: "agent", id: agent.id, agent })),
  ];
  for (const { chat, folder } of sidebarOrder(input.layout, chats, input.text.t)) {
    if (chat.kind === "agent") agents.push({ agent: chat.agent, folder, position: position++ });
    else channels.push({ channel: chat.channel, folder, position: position++, pinned: false });
  }
  return { agents, channels };
}

function hostChannel(input: HostWatchSnapshotInput, placed: PlacedChannel): WatchChannel {
  const { channel, folder, position, pinned } = placed;
  const members = channel.members.map((member) => member.agentId);
  const lead = input.agents.find((agent) => agent.id === members[0]);
  const last = channel.lastMessage;
  const localize = (value: string) => localizeSourceText(value, input.text.locale);
  return {
    serverId: input.hostId,
    id: channel.id,
    name: channel.name,
    server: input.serverName,
    color: lead
      ? avatarHeadColor(lead.avatarSeed, lead.avatarHue, lead.avatarColor ?? null)
      : ARTICLE_GRADIENT_BRAND_HEXES["--openbot-accent"],
    members: members.slice(0, WATCH_CHANNEL_MEMBERS),
    ...(pinned ? { pinned } : {}),
    ...(folder ? { folder } : {}),
    position,
    unread: channel.unreadCount,
    working: channel.activeTasks > 0,
    updated: updatedLabel(last?.at ?? channel.createdAt, input.text.format, input.now),
    author: last?.authorName ?? null,
    reply: last
      ? watchText(markdownPreviewText(coordinatorText(last.author, last.text, localize)), WATCH_REPLY_LIMIT)
      : null,
  };
}

function withinLimit(agents: readonly WatchAgent[]): WatchAgent[] {
  const room = Math.max(0, WATCH_AGENT_LIMIT - agents.filter((agent) => agent.state === "waiting").length);
  let others = 0;
  return agents.filter((agent) => {
    if (agent.state === "waiting") return true;
    others += 1;
    return others <= room;
  });
}

function updatedLabel(value: string | null, format: AppFormat, now: number): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return format.date(date, { hour: "2-digit", minute: "2-digit" });
  }
  return date.getFullYear() === today.getFullYear()
    ? format.date(date, { month: "short", day: "numeric" })
    : format.date(date, { month: "short", day: "numeric", year: "numeric" });
}

export function buildHostWatchSnapshot(input: HostWatchSnapshotInput): WatchSnapshot {
  const { runtime, text } = input;
  const unreadCounts = new Map(
    Object.entries(input.reads).flatMap(([agentId, read]) =>
      read.unreadCount > 0 ? [[agentId, read.unreadCount] as const] : [],
    ),
  );
  const pinned = new Set(input.pins.flatMap((pin) => (pin.kind === "agent" ? [pin.id] : [])));
  const listed: WatchAgent[] = [];
  const placed = appOrder(input);
  for (const { agent, folder, position } of placed.agents) {
    const waiting = agentWait(agent, input);
    const turnId = waiting?.turnId ?? activeTurnId(agent.id, runtime);
    const state = waiting ? "waiting" : turnId ? "working" : "idle";
    const avatar = input.avatar(agent.id);
    const latest = runtime.latestMessages.find((message) => message.agentId === agent.id)?.text;
    listed.push({
      serverId: input.hostId,
      id: agent.id,
      name: agent.name,
      server: input.serverName,
      color: avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor ?? null),
      ...(avatar ? { avatar } : {}),
      pinned: pinned.has(agent.id),
      ...(folder ? { folder } : {}),
      position,
      unread: unreadCounts.get(agent.id) ?? 0,
      state,
      detail: watchText(state === "working" ? null : agent.preview, 160),
      updated: updatedLabel(agent.updatedAt, text.format, input.now),
      turnId,
      reply: watchText(latest, WATCH_REPLY_LIMIT) ?? watchText(agent.preview, WATCH_REPLY_LIMIT),
      wait: waiting?.wait ?? null,
    });
  }
  const shown = withinLimit(listed).slice(0, WATCH_AGENT_LIMIT);
  const waiting = shown.filter((agent) => agent.state === "waiting").length;
  return {
    version: WATCH_PROTOCOL_VERSION,
    state: "ready",
    generatedAt: input.now,
    live: true,
    paused: false,
    accent: ARTICLE_GRADIENT_BRAND_HEXES["--openbot-accent"],
    language: text.locale,
    text: watchTexts(text.t, waiting),
    servers: [
      {
        id: input.hostId,
        name: input.serverName,
        online: true,
        color: serverPlushHex(input.hostId, input.appearance?.color),
        shape: input.appearance?.shape ?? "squircle",
        watchKey: input.watchKey,
      },
    ],
    agents: shown,
    channels: watchChannelsWithinLimit(placed.channels.map((item) => hostChannel(input, item))),
  };
}

export function shrunkWatchSnapshots(snapshot: WatchSnapshot): WatchSnapshot[] {
  if (snapshot.state !== "ready") return [snapshot];
  const replies = (limit: number | null) =>
    snapshot.agents.map((agent) => ({
      ...agent,
      reply: limit === null ? null : watchText(agent.reply, limit),
      detail: limit === null ? null : agent.detail,
    }));
  const fewer = (count: number) => {
    const waiting = snapshot.agents.filter((agent) => agent.state === "waiting");
    const others = snapshot.agents.filter((agent) => agent.state !== "waiting").slice(0, count);
    const kept = new Set([...waiting, ...others].map((agent) => agent.id));
    return replies(null).filter((agent) => kept.has(agent.id));
  };
  return [
    snapshot,
    { ...snapshot, agents: replies(300) },
    { ...snapshot, agents: replies(null) },
    { ...snapshot, agents: fewer(20) },
    { ...snapshot, agents: fewer(5) },
    { ...snapshot, agents: fewer(0) },
  ];
}
