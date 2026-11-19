import type {
  AvatarHue,
  DynamicIslandAction,
  DynamicIslandAgentIdentity,
  DynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { DynamicIslandText } from "./dynamic-island-presentation";
import { signLiveActivityLink, verifyLiveActivityLink } from "./live-activity-seal";
import { liveActivityMarkdown } from "./live-activity-text";
import { hideRedactionMarks, messageSummary } from "./message-summary";

export interface AgentLiveActivityProps {
  mode: Exclude<DynamicIslandPresentation["mode"], "idle">;
  label: string;
  symbol: AgentLiveActivitySymbol;
  tint: string;
  title: string;
  detail: string;
  compact: string;
  compactTint: string;
  footer: string;
  detailLines: number;
  detailMarkdown: boolean;
  rows: Array<{ name: string; text: string }>;
  avatar: string;
  tapUrl: string;
  buttons: Array<{ label: string; url: string; prominent: boolean }>;
  agents: LiveActivityAgentRow[];
  agentCount: number;
  listUrl: string;
  moreLabel: string;
  appName: string;
  staleLabel: string;
  staleDetail: string;
}

export interface LiveActivityAgentRow {
  name: string;
  count: number;
  avatar: string;
  url: string;
}

export type LiveActivityAction = Extract<
  DynamicIslandAction,
  { type: "open-agent" | "open-failure" | "answer-prompt" | "respond-approval" }
>;

export interface LiveActivityButton {
  label: string;
  prominent: boolean;
  action: LiveActivityAction;
}

export interface LiveActivityUnreadAgent extends DynamicIslandAgentIdentity {
  serverId: string;
  count: number;
}

export type AgentLiveActivitySymbol =
  | "sparkles"
  | "message.fill"
  | "questionmark.bubble.fill"
  | "checkmark.shield.fill"
  | "macwindow"
  | "xmark.octagon.fill";

export type LiveActivityMood = "working" | "responded" | "failed" | "idle" | "waiting";

export interface LiveActivityViewInput {
  t: MobileTranslate;
  agentColor(seed: string, hue: AvatarHue | null): string;
  avatar(serverId: string, agent: DynamicIslandAgentIdentity, mood: LiveActivityMood): string;
  unreadAgents: readonly LiveActivityUnreadAgent[];
  actionKey: Uint8Array;
  threadId?: string | null;
  redact: (text: string) => string;
}

export const LIVE_ACTIVITY_URL = "openbot://live-activity";
export const LIVE_ACTIVITY_LIST_URL = `${LIVE_ACTIVITY_URL}?list=1`;
const THREAD_PARAM = "thread";

const TITLE_LIMIT = 80;
const DETAIL_LIMIT = 180;
const DETAIL_LEAD = 100;
const ROW_NAME_LIMIT = 40;
const ROW_TEXT_LIMIT = 100;
const ROW_LEAD = 60;
const WORKING_ROWS = 3;
const BUTTON_LIMIT = 24;
const APPROVAL_COMMAND_LIMIT = 140;

type LiveActivityExtras = Pick<AgentLiveActivityProps, "avatar" | "tapUrl" | "buttons" | "agents" | "agentCount">;
type LiveActivityTexts = "listUrl" | "moreLabel" | "appName" | "staleLabel" | "staleDetail";
type LiveActivityText = Pick<LiveActivityViewInput, "t" | "agentColor" | "redact">;
const SEVERAL_AGENTS_TINT = "#FFFFFF";
const AGENT_LIST_LINES = 3;
export const UNREAD_AGENT_ROWS = 4;

export function liveActivityView(
  presentation: DynamicIslandPresentation,
  input: LiveActivityViewInput,
): AgentLiveActivityProps | null {
  const buttons = liveActivityButtons(presentation, input.t, input.redact);
  const shown = liveActivityAgent(presentation);
  const allUnread =
    presentation.mode === "message" ? sortUnreadAgents(input.unreadAgents, presentation.message.agent.id) : [];
  const unread = allUnread.slice(0, UNREAD_AGENT_ROWS);
  const command = presentation.mode === "approval" ? (presentation.item.approval.command ?? undefined) : undefined;
  const threadId = input.threadId ?? null;
  return liveActivityProps(
    presentation,
    {
      avatar: shown ? input.avatar(presentation.serverId, shown, liveActivityMood(presentation)) : "",
      tapUrl:
        allUnread.length > 1 || !shown ? LIVE_ACTIVITY_LIST_URL : openUrl(presentation.serverId, shown.id, threadId),
      buttons: buttons.map((button) => ({
        label: button.label,
        prominent: button.prominent,
        url: liveActivityActionUrl(button.action, input.actionKey, command, threadId),
      })),
      agents: unread.map((agent) => ({
        name: agent.name,
        count: agent.count,
        avatar: input.avatar(agent.serverId, agent, "responded"),
        url: openUrl(agent.serverId, agent.id),
      })),
      agentCount: allUnread.length,
    },
    input,
  );
}

export function liveActivityProps(
  presentation: DynamicIslandPresentation,
  extras: LiveActivityExtras,
  text: LiveActivityText,
): AgentLiveActivityProps | null {
  const { t } = text;
  const content = liveActivityContent(presentation, text);
  const agents = extras.agents
    .slice(0, UNREAD_AGENT_ROWS)
    .map((agent) => ({ ...agent, name: limit(agent.name, ROW_NAME_LIMIT) }));
  const several = extras.agentCount > 1 && agents.length > 1;
  return (
    content && {
      ...content,
      ...extras,
      ...(several ? { compactTint: SEVERAL_AGENTS_TINT } : {}),
      agents: several ? agents : [],
      agentCount: several ? extras.agentCount : 0,
      listUrl: LIVE_ACTIVITY_LIST_URL,
      moreLabel:
        several && extras.agentCount > AGENT_LIST_LINES
          ? t("mobile.liveActivity.moreChats", { count: extras.agentCount - (AGENT_LIST_LINES - 1) })
          : "",
      appName: t("mobile.liveActivity.appName"),
      staleLabel: t("mobile.liveActivity.stale.label"),
      staleDetail: t("mobile.liveActivity.stale.detail"),
    }
  );
}

function liveActivityContent(
  presentation: DynamicIslandPresentation,
  { t, agentColor, redact }: LiveActivityText,
): Omit<AgentLiveActivityProps, keyof LiveActivityExtras | LiveActivityTexts> | null {
  const agentText = (source: string, lead: number, max: number) =>
    liveActivityMarkdown(messageSummary(redact(source), lead), max);
  const plain = (source: string, max: number) => limit(hideRedactionMarks(redact(source)), max);
  switch (presentation.mode) {
    case "idle":
      return null;
    case "working": {
      const rows = presentation.working.slice(0, WORKING_ROWS).map((item) => ({
        name: limit(item.agent.name, ROW_NAME_LIMIT),
        text: agentText(item.task, ROW_LEAD, ROW_TEXT_LIMIT),
      }));
      const first = presentation.working[0];
      return {
        mode: "working",
        label: t("mobile.liveActivity.badge.working"),
        symbol: "sparkles",
        tint: first ? agentColor(first.agent.avatarSeed, first.agent.avatarHue) : "#8E8E93",
        title: first ? limit(first.agent.name, TITLE_LIMIT) : t("mobile.liveActivity.appName"),
        detail: first ? agentText(first.task, DETAIL_LEAD, DETAIL_LIMIT) : "",
        compact:
          presentation.working.length > 1
            ? String(presentation.working.length)
            : t("mobile.liveActivity.badge.working"),
        compactTint:
          presentation.working.length > 1
            ? SEVERAL_AGENTS_TINT
            : first
              ? agentColor(first.agent.avatarSeed, first.agent.avatarHue)
              : "#8E8E93",
        footer: "",
        detailLines: 2,
        detailMarkdown: true,
        rows,
      };
    }
    case "message":
      return {
        mode: "message",
        label: t("mobile.liveActivity.badge.message"),
        symbol: "message.fill",
        tint: "#0A84FF",
        title: limit(presentation.message.agent.name, TITLE_LIMIT),
        detail: agentText(presentation.message.text, DETAIL_LEAD, DETAIL_LIMIT),
        compact: String(presentation.unreadCount),
        compactTint: agentColor(presentation.message.agent.avatarSeed, presentation.message.agent.avatarHue),
        footer: t("mobile.liveActivity.unread", { count: presentation.unreadCount }),
        detailLines: 2,
        detailMarkdown: true,
        rows: [],
      };
    case "question":
      return {
        mode: "question",
        label: t("mobile.liveActivity.badge.question"),
        symbol: "questionmark.bubble.fill",
        tint: "#0A84FF",
        title: plain(presentation.item.title, TITLE_LIMIT),
        detail: agentText(
          presentation.item.detail ??
            t("mobile.liveActivity.question.fallback", { name: presentation.item.agent.name }),
          DETAIL_LEAD,
          DETAIL_LIMIT,
        ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: agentColor(presentation.item.agent.avatarSeed, presentation.item.agent.avatarHue),
        footer: remaining(presentation.remainingCount, t),
        detailLines: 2,
        detailMarkdown: true,
        rows: [],
      };
    case "approval": {
      const { command, reason } = presentation.item.approval;
      return {
        mode: "approval",
        label: t("mobile.liveActivity.badge.approval"),
        symbol: "checkmark.shield.fill",
        tint: "#FF9F0A",
        title: plain(presentation.item.title, TITLE_LIMIT),
        detail: command
          ? plain(command, APPROVAL_COMMAND_LIMIT)
          : agentText(
              reason ?? presentation.item.detail ?? t("mobile.liveActivity.approval.fallback"),
              DETAIL_LEAD,
              DETAIL_LIMIT,
            ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: agentColor(presentation.item.agent.avatarSeed, presentation.item.agent.avatarHue),
        footer: remaining(presentation.remainingCount, t),
        detailLines: command ? 4 : 2,
        detailMarkdown: !command,
        rows: [],
      };
    }
    case "takeover":
      return {
        mode: "takeover",
        label: t("mobile.liveActivity.badge.takeover"),
        symbol: "macwindow",
        tint: "#FF9F0A",
        title: plain(presentation.item.title, TITLE_LIMIT),
        detail: agentText(
          presentation.item.detail ?? t("mobile.liveActivity.takeover.fallback"),
          DETAIL_LEAD,
          DETAIL_LIMIT,
        ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: agentColor(presentation.item.agent.avatarSeed, presentation.item.agent.avatarHue),
        footer: "",
        detailLines: 2,
        detailMarkdown: true,
        rows: [],
      };
    case "failed":
      return {
        mode: "failed",
        label: t("mobile.liveActivity.badge.failed"),
        symbol: "xmark.octagon.fill",
        tint: "#FF453A",
        title: plain(
          t("mobile.liveActivity.failed.title", { name: presentation.item.agent.name, title: presentation.item.title }),
          TITLE_LIMIT,
        ),
        detail: plain(presentation.item.detail ?? t("mobile.liveActivity.failed.fallback"), DETAIL_LIMIT),
        compact: t("mobile.liveActivity.badge.failed"),
        compactTint: "#FF453A",
        footer: "",
        detailLines: 2,
        detailMarkdown: false,
        rows: [],
      };
  }
}

export function liveActivityButtons(
  presentation: DynamicIslandPresentation,
  t: MobileTranslate,
  redact: (text: string) => string,
): LiveActivityButton[] {
  const { serverId } = presentation;
  if (presentation.mode === "approval") {
    const { item } = presentation;
    const respond = (decision: "accept" | "decline") => ({
      type: "respond-approval" as const,
      serverId,
      agentId: item.agent.id,
      requestId: item.requestId,
      decision,
    });
    const command = item.approval.command;
    const approvable =
      !item.truncated &&
      item.approval.kind === "command" &&
      command !== null &&
      redact(command) === command &&
      Array.from(command.replace(/\s+/gu, " ").trim()).length <= APPROVAL_COMMAND_LIMIT;
    return [
      { label: t("mobile.liveActivity.button.decline"), prominent: false, action: respond("decline") },
      ...(approvable
        ? [{ label: t("mobile.liveActivity.button.approve"), prominent: true, action: respond("accept") }]
        : []),
    ];
  }
  if (presentation.mode === "question") {
    const { item } = presentation;
    const [question, ...others] = item.questions;
    const options = question?.options ?? [];
    if (!question || others.length > 0 || question.isSecret || options.length === 0 || options.length > 3) return [];
    return options.map((option, index) => ({
      label: limit(option.label, BUTTON_LIMIT),
      prominent: index === 0,
      action: {
        type: "answer-prompt",
        serverId,
        agentId: item.agent.id,
        requestId: item.requestId,
        answers: { [question.id]: [option.label] },
      },
    }));
  }
  if (presentation.mode === "failed") {
    const action: LiveActivityAction = {
      type: "open-failure",
      serverId,
      agentId: presentation.item.agent.id,
      turnId: presentation.item.turnId,
    };
    return [{ label: t("mobile.liveActivity.button.openDetails"), prominent: true, action }];
  }
  return [];
}

export function liveActivityShorterProps(props: AgentLiveActivityProps): AgentLiveActivityProps[] {
  const withoutLists = { ...props, agents: [], agentCount: 0, moreLabel: "", rows: [] };
  return [props, withoutLists, { ...withoutLists, buttons: [], detail: "" }];
}

export function fitLiveActivityProps(props: AgentLiveActivityProps): AgentLiveActivityProps {
  const candidates = liveActivityShorterProps(props);
  return (
    candidates.find((candidate) => new TextEncoder().encode(JSON.stringify(candidate)).length <= LOCAL_PROPS_BYTES) ??
    candidates.at(-1) ??
    props
  );
}

const LOCAL_PROPS_BYTES = 3_000;

export function liveActivityIslandText(
  t: MobileTranslate,
  errorMessage: DynamicIslandText["errorMessage"] = (_error, fallback) => fallback,
): DynamicIslandText {
  return {
    taskWorking: t("mobile.liveActivity.island.taskWorking"),
    questionHeader: t("mobile.liveActivity.island.questionHeader"),
    questionText: t("mobile.liveActivity.island.questionText"),
    optionFallback: (number) => t("mobile.liveActivity.island.optionFallback", { number }),
    takeoverTitle: t("mobile.liveActivity.island.takeoverTitle"),
    takeoverDetail: t("mobile.liveActivity.island.takeoverDetail"),
    failureTitle: t("mobile.liveActivity.island.failureTitle"),
    failureDetail: t("mobile.liveActivity.island.failureDetail"),
    approvalCommand: t("mobile.liveActivity.island.approvalCommand"),
    approvalFileChange: t("mobile.liveActivity.island.approvalFileChange"),
    approvalPermissions: t("mobile.liveActivity.island.approvalPermissions"),
    errorMessage,
  };
}

export function liveActivityMood(presentation: DynamicIslandPresentation): LiveActivityMood {
  switch (presentation.mode) {
    case "working":
      return "working";
    case "message":
      return "responded";
    case "failed":
      return "failed";
    case "idle":
      return "idle";
    default:
      return "waiting";
  }
}

export const LIVE_ACTIVITY_MOODS: readonly LiveActivityMood[] = ["working", "responded", "failed", "waiting"];

export function liveActivityAgent(presentation: DynamicIslandPresentation): DynamicIslandAgentIdentity | null {
  switch (presentation.mode) {
    case "idle":
      return null;
    case "working":
      return presentation.working[0]?.agent ?? null;
    case "message":
      return presentation.message.agent;
    default:
      return presentation.item.agent;
  }
}

export function liveActivityBloubFile(seed: string, hue: AvatarHue | null, mood: LiveActivityMood): string {
  return `avatar-${liveActivityFileName(["bloub", seed, String(hue ?? ""), mood])}.png`;
}

export function liveActivityFileName(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9]/gu, (character) => `_${character.codePointAt(0)?.toString(16)}_`))
    .join("-");
}

export function liveActivityActionUrl(
  action: LiveActivityAction,
  key: Uint8Array,
  command?: string,
  threadId: string | null = null,
): string {
  const payload = JSON.stringify(command === undefined ? { action } : { action, command });
  const params = new URLSearchParams({ action: payload, sig: signLiveActivityLink(payload, key) });
  if (threadId) params.set(THREAD_PARAM, threadId);
  return `${LIVE_ACTIVITY_URL}?${params}`;
}

export type LiveActivityLink =
  | { type: "list" }
  | { type: "open"; serverId: string; agentId: string; threadId: string | null }
  | { type: "action"; action: LiveActivityAction; command: string | null; threadId: string | null };

export function readLiveActivityLink(url: string, keyFor: (serverId: string) => Uint8Array | null): LiveActivityLink {
  const params = new URL(url).searchParams;
  const serverId = params.get("server");
  const agentId = params.get("agent");
  const threadId = params.get(THREAD_PARAM) || null;
  if (serverId && agentId) return { type: "open", serverId, agentId, threadId };
  const payload = params.get("action");
  const signature = params.get("sig");
  if (payload === null || signature === null) return { type: "list" };
  const link = signedPayload(payload, threadId);
  const key = link.type === "action" ? keyFor(link.action.serverId) : null;
  return key && verifyLiveActivityLink(payload, signature, key) ? link : { type: "list" };
}

function signedLink(value: unknown, threadId: string | null): LiveActivityLink {
  if (!isDynamicRecord(value) || !isLiveActivityAction(value.action)) return { type: "list" };
  return {
    type: "action",
    action: value.action,
    command: isString(value.command) ? value.command : null,
    threadId,
  };
}

function signedPayload(payload: string, threadId: string | null): LiveActivityLink {
  try {
    return signedLink(JSON.parse(payload), threadId);
  } catch {
    return { type: "list" };
  }
}

function isLiveActivityAction(value: unknown): value is LiveActivityAction {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || !("serverId" in value) || !("agentId" in value)) return false;
  return (
    ["open-agent", "open-failure", "answer-prompt", "respond-approval"].includes(String(value.type)) &&
    typeof value.serverId === "string" &&
    typeof value.agentId === "string"
  );
}

function openUrl(serverId: string, agentId: string, threadId: string | null = null): string {
  const params = new URLSearchParams({ server: serverId, agent: agentId });
  if (threadId) params.set(THREAD_PARAM, threadId);
  return `${LIVE_ACTIVITY_URL}?${params}`;
}

function sortUnreadAgents(agents: readonly LiveActivityUnreadAgent[], firstId: string): LiveActivityUnreadAgent[] {
  return [...agents].sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId) || b.count - a.count);
}

function remaining(count: number, t: MobileTranslate): string {
  if (count <= 0) return "";
  return t("mobile.liveActivity.moreRequests", { count });
}

function limit(value: string, length: number): string {
  const characters = Array.from(value.replace(/\s+/gu, " ").trim());
  return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : characters.join("");
}
