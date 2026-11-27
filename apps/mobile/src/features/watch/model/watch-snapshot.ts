import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { coordinatorText } from "@openbot/contracts/coordinator-text";
import type { ChannelSummary, ConversationMessage, SidebarLayoutSnapshot, SidebarPin } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import {
  WATCH_AGENT_LIMIT,
  WATCH_APPROVAL_LIMIT,
  WATCH_CHANNEL_MEMBERS,
  WATCH_HIDDEN_LIMIT,
  WATCH_PROTOCOL_VERSION,
  WATCH_REPLY_LIMIT,
  type WatchAgent,
  type WatchChannel,
  type WatchFaces,
  type WatchQuestion,
  type WatchSnapshot,
  type WatchWait,
  watchChannelsWithinLimit,
  watchText,
} from "@openbot/contracts/watch-protocol";
import { feedbackApproval } from "@openbot/team-client/feedback-approval";
import { approvalCommandText, approvalTitle, shortPath } from "@/features/chat/model/approval-text";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { MobileConversation } from "@/features/workspace/model/conversation-store";
import type { LiveWorkspaceState } from "@/features/workspace/model/live-workspace-store";
import { approvalIsPartial, type PendingApproval } from "@/features/workspace/model/pending-approvals";
import { mobileSidebarItems } from "@/features/workspace/model/sidebar-layout";
import type { MobileThreadWait } from "@/features/workspace/model/thread-waits";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import type { MobileText } from "@/shared/lib/text";

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

function watchTexts(t: MobileText["t"], waiting: number): Record<string, string> {
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

export interface WatchSnapshotInput {
  servers: readonly MobileServer[];
  agents: readonly MobileAgent[];
  hidden: (serverId: string) => readonly string[];
  hiddenChannels: (serverId: string) => readonly string[];
  pins: (serverId: string) => readonly SidebarPin[];
  layout: (serverId: string) => SidebarLayoutSnapshot | null;
  paused: boolean;
  live: LiveWorkspaceState;
  conversation: (agentId: string) => MobileConversation | undefined;
  avatar: (agent: MobileAgent) => string | undefined;
  faces: (agent: MobileAgent) => WatchFaces | undefined;
  channels: (serverId: string) => readonly ChannelSummary[];
  online: (server: MobileServer) => boolean;
  watchKey: (serverId: string) => string | undefined;
  account: string | undefined;
  text: MobileText;
  accent: string;
}

function approvalWait(approval: PendingApproval, t: MobileText["t"], sourceText: MobileText["sourceText"]): WatchWait {
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
    why: watchText(approval.reason ? sourceText(approval.reason) : null),
    whole: !approvalIsPartial(approval) && whole.length <= WATCH_APPROVAL_LIMIT,
  };
}

function questionWait(wait: MobileThreadWait, conversation: MobileConversation | undefined): WatchWait {
  const prompt = conversation?.messages.find(
    (message) =>
      String(message.questionPrompt?.requestId) === String(wait.requestId) &&
      message.questionPrompt?.resolution === null,
  )?.questionPrompt;
  const questions = prompt?.questions ?? [];
  if (questions.length === 0) return { kind: "phone", reason: "question", text: null };
  const secret = questions.find((question) => question.isSecret);
  if (secret) {
    return { kind: "phone", reason: "question", text: watchText(secret.question) ?? watchText(secret.header) };
  }
  return {
    kind: "question",
    requestId: String(wait.requestId),
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

function lastReply(messages: readonly ConversationMessage[] | undefined): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.author === "assistant" || message.author === "agent") && message.text.trim()) {
      return watchText(message.text, WATCH_REPLY_LIMIT);
    }
  }
  return null;
}

function agentWait(
  agent: MobileAgent,
  approvals: readonly PendingApproval[],
  waits: readonly MobileThreadWait[],
  conversation: MobileConversation | undefined,
  text: MobileText,
): WatchWait | null {
  const approval = approvals.find((item) => item.agentId === agent.id);
  if (approval) return approvalWait(approval, text.t, text.sourceText);
  const question = waits.find((wait) => wait.agentId === agent.id && wait.reason === "question");
  if (question) {
    return question.task ? { kind: "phone", reason: "question", text: null } : questionWait(question, conversation);
  }
  if (waits.some((wait) => wait.agentId === agent.id && wait.reason === "takeover")) {
    return { kind: "phone", reason: "takeover", text: null };
  }
  return null;
}

function waitingActivity(activity: MobileAgentActivity | undefined): WatchWait | null {
  if (activity?.phase !== "waiting") return null;
  return { kind: "phone", reason: activity.reason ?? "question", text: null };
}

function stateOf(wait: WatchWait | null, activity: MobileAgentActivity | undefined): WatchAgent["state"] {
  if (wait) return "waiting";
  return activity ? "working" : "idle";
}

interface PlacedAgent {
  agent: MobileAgent;
  folder: string | null;
  position: number;
}

interface PlacedChannel {
  channel: ChannelSummary;
  folder: string | null;
  position: number;
  pinned: boolean;
}

function appOrder(
  input: WatchSnapshotInput,
  server: MobileServer,
): { agents: PlacedAgent[]; channels: PlacedChannel[] } {
  const hidden = new Set(input.hidden(server.id));
  const hiddenChannels = new Set(input.hiddenChannels(server.id));
  const visible = input.agents.filter((agent) => agent.serverId === server.id && !hidden.has(agent.id));
  const open = input.channels(server.id).filter((channel) => !channel.archived && !hiddenChannels.has(channel.id));
  const agentsById = new Map(visible.map((agent) => [agent.id, agent]));
  const channelsById = new Map(open.map((channel) => [channel.id, channel]));
  const agents: PlacedAgent[] = [];
  const channels: PlacedChannel[] = [];
  let position = 0;
  for (const pin of input.pins(server.id)) {
    const agent = pin.kind === "agent" ? agentsById.get(pin.id) : undefined;
    const channel = pin.kind === "channel" ? channelsById.get(pin.id) : undefined;
    if (agent) agents.push({ agent, folder: null, position: position++ });
    if (channel) channels.push({ channel, folder: null, position: position++, pinned: true });
  }
  const pinnedAgents = new Set(agents.map((item) => item.agent.id));
  const pinnedChannels = new Set(channels.map((item) => item.channel.id));
  let folder: string | null = null;
  for (const item of mobileSidebarItems(
    input.layout(server.id),
    visible.filter((agent) => !pinnedAgents.has(agent.id)),
    open.filter((channel) => !pinnedChannels.has(channel.id)),
    undefined,
    input.text.t,
  )) {
    if (item.kind === "section") folder = item.name;
    if (item.kind === "agent") agents.push({ agent: item.agent, folder, position: position++ });
    if (item.kind === "channel") channels.push({ channel: item.channel, folder, position: position++, pinned: false });
  }
  return { agents, channels };
}

function watchChannel(input: WatchSnapshotInput, server: MobileServer, placed: PlacedChannel): WatchChannel {
  const { channel, folder, position, pinned } = placed;
  const members = channel.members.map((member) => member.agentId);
  const lead = input.agents.find((agent) => agent.serverId === server.id && agent.id === members[0]);
  const last = channel.lastMessage;
  return {
    serverId: server.id,
    id: channel.id,
    name: channel.name,
    server: server.name,
    color: lead ? avatarHeadColor(lead.avatarSeed, lead.avatarHue, lead.avatarColor) : input.accent,
    members: members.slice(0, WATCH_CHANNEL_MEMBERS),
    ...(pinned ? { pinned } : {}),
    ...(folder ? { folder } : {}),
    position,
    unread: channel.unreadCount,
    working: channel.activeTasks > 0,
    updated: formatUpdatedAt(last?.at ?? channel.createdAt, input.text.format) || null,
    author: last?.authorName ?? null,
    reply: last
      ? watchText(
          markdownPreviewText(coordinatorText(last.author, last.text, input.text.sourceText)),
          WATCH_REPLY_LIMIT,
        )
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

export function buildWatchSnapshot(input: WatchSnapshotInput): WatchSnapshot {
  const { servers, live, text } = input;
  const listed: WatchAgent[] = [];
  const channels: WatchChannel[] = [];
  for (const server of servers) {
    const pinned = new Set(input.pins(server.id).flatMap((pin) => (pin.kind === "agent" ? [pin.id] : [])));
    const approvals = live.approvalRequests[server.id] ?? [];
    const waits = live.threadWaitsByServer[server.id] ?? [];
    const activities = live.activityByServer[server.id] ?? {};
    const placed = appOrder(input, server);
    channels.push(...watchChannelsWithinLimit(placed.channels.map((item) => watchChannel(input, server, item))));
    for (const { agent, folder, position } of placed.agents) {
      const conversation = input.conversation(agent.id);
      const activity = activities[agent.id];
      const wait = agentWait(agent, approvals, waits, conversation, text) ?? waitingActivity(activity);
      const state = stateOf(wait, activity);
      const avatar = input.avatar(agent);
      const faces = input.faces(agent);
      listed.push({
        serverId: server.id,
        id: agent.id,
        name: agent.name,
        server: server.name,
        color: avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor),
        ...(avatar ? { avatar } : {}),
        ...(faces ? { faces } : {}),
        pinned: pinned.has(agent.id),
        ...(folder ? { folder } : {}),
        position,
        unread: live.unreadAgentIds.includes(agent.id) ? Math.max(1, live.unreadCounts[agent.id] ?? 1) : 0,
        state,
        detail: watchText(state === "working" ? (activity?.detail ?? null) : agent.preview, 160),
        updated: agent.updatedLabel || null,
        turnId: activity?.turnId ?? null,
        reply: lastReply(conversation?.messages) ?? watchText(agent.preview, WATCH_REPLY_LIMIT),
        wait,
      });
    }
  }
  const shown = withinLimit(listed).slice(0, WATCH_AGENT_LIMIT);
  const waiting = shown.filter((agent) => agent.state === "waiting").length;
  return {
    version: WATCH_PROTOCOL_VERSION,
    state: "ready",
    generatedAt: Date.now(),
    ...(input.account ? { account: input.account } : {}),
    live: servers.some(input.online),
    paused: input.paused,
    accent: input.accent,
    language: text.locale,
    text: watchTexts(text.t, waiting),
    servers: servers.map((server) => {
      const watchKey = input.watchKey(server.id);
      const hiddenAgents = input.hidden(server.id).slice(0, WATCH_HIDDEN_LIMIT);
      const hiddenChannels = input.hiddenChannels(server.id).slice(0, WATCH_HIDDEN_LIMIT);
      return {
        id: server.id,
        name: server.name,
        online: input.online(server),
        ...(watchKey ? { watchKey } : {}),
        ...(hiddenAgents.length > 0 ? { hiddenAgents } : {}),
        ...(hiddenChannels.length > 0 ? { hiddenChannels } : {}),
      };
    }),
    agents: shown,
    channels,
  };
}

export function questionsToLoad(input: Pick<WatchSnapshotInput, "servers" | "live" | "conversation">) {
  const missing: { serverId: string; agentId: string }[] = [];
  for (const server of input.servers) {
    for (const wait of input.live.threadWaitsByServer[server.id] ?? []) {
      if (wait.reason !== "question" || wait.task) continue;
      const loaded = input
        .conversation(wait.agentId)
        ?.messages.some((message) => String(message.questionPrompt?.requestId) === String(wait.requestId));
      if (!loaded) missing.push({ serverId: server.id, agentId: wait.agentId });
    }
  }
  return missing;
}
