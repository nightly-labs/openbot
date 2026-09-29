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

/**
 * What the iOS Live Activity shows. The phone builds it while it runs, and its host builds the same
 * while iOS suspends the phone, so both read this module. ActivityKit keeps the content state under
 * 4 KB, so every text has a limit, and the widget runtime reads only these plain values.
 */
export interface AgentLiveActivityProps {
  mode: Exclude<DynamicIslandPresentation["mode"], "idle">;
  label: string;
  symbol: AgentLiveActivitySymbol;
  tint: string;
  title: string;
  detail: string;
  /** The short text in the compact island, beside the symbol. */
  compact: string;
  /**
   * The color of the state line and the compact text. One agent's work or reply takes the agent
   * color, and several agents are white, which the light Lock Screen shows dark. Other states keep
   * their state color.
   */
  compactTint: string;
  /** The line under the content, such as `+2 more requests`. Empty when there is none. */
  footer: string;
  /** The most lines the detail can use. A command to approve shows in full. */
  detailLines: number;
  /**
   * Whether `detail` is inline Markdown, as a reply or a question is. A command or an error shows
   * as written, so its `*` and `_` stay.
   */
  detailMarkdown: boolean;
  /** The agents that work now, for the `working` mode. Each `text` is inline Markdown. */
  rows: Array<{ name: string; text: string }>;
  /** The file name of the agent picture in the App Group, or empty to show the symbol. */
  avatar: string;
  /** Opens the chat the activity shows, or the chat list. It changes no host state. */
  tapUrl: string;
  /** The Lock Screen and expanded island show these. Each opens the app, which then does its action. */
  buttons: Array<{ label: string; url: string; prominent: boolean }>;
  /**
   * The agents with unread replies when there is more than one. The activity shows their photos and
   * a row for each, and each row opens that chat. Empty for one agent.
   */
  agents: LiveActivityAgentRow[];
  /** All agents with unread replies, also the ones `agents` leaves out. 0 for one agent. */
  agentCount: number;
  /** Opens the chat list, for the agents the view has no room for. */
  listUrl: string;
  /** The last list line, such as `+3 more`, when not all agents fit. Empty when all fit. */
  moreLabel: string;
  /** Texts the widget shows. It cannot translate, so they come in the interface language. */
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

/** What a button does after the app opens. */
export type LiveActivityAction = Extract<
  DynamicIslandAction,
  { type: "open-agent" | "open-failure" | "answer-prompt" | "respond-approval" }
>;

export interface LiveActivityButton {
  label: string;
  prominent: boolean;
  action: LiveActivityAction;
}

/** An agent with unread replies, with its count from the host read state. */
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

/** The bloub face for a state, as the app avatars show it. */
export type LiveActivityMood = "working" | "responded" | "failed" | "idle" | "waiting";

export interface LiveActivityViewInput {
  t: MobileTranslate;
  /** The bloub color of an agent, which the working state takes. */
  agentColor(seed: string, hue: AvatarHue | null): string;
  /** The file name of the agent picture for `mood`, or empty when there is none. */
  avatar(serverId: string, agent: DynamicIslandAgentIdentity, mood: LiveActivityMood): string;
  /** The agents with unread replies, in any order. */
  unreadAgents: readonly LiveActivityUnreadAgent[];
  /** Signs the button links. */
  actionKey: Uint8Array;
}

/**
 * ActivityKit fixes the URL of an activity when it starts, but the activity shows different chats
 * over its life. So the activity sets its tap link from the props, and each link says what it opens.
 */
export const LIVE_ACTIVITY_URL = "openbot://live-activity";
/** Opens the chat list. It starts no action, so it needs no signature. */
export const LIVE_ACTIVITY_LIST_URL = `${LIVE_ACTIVITY_URL}?list=1`;

const TITLE_LIMIT = 80;
const DETAIL_LIMIT = 180;
const ROW_NAME_LIMIT = 40;
const ROW_TEXT_LIMIT = 100;
const WORKING_ROWS = 3;
const BUTTON_LIMIT = 24;
/** About four Lock Screen lines. A longer command is not approved from a view that cuts it. */
const APPROVAL_COMMAND_LIMIT = 140;

type LiveActivityExtras = Pick<AgentLiveActivityProps, "avatar" | "tapUrl" | "buttons" | "agents" | "agentCount">;
type LiveActivityTexts = "listUrl" | "moreLabel" | "appName" | "staleLabel" | "staleDetail";
type LiveActivityText = Pick<LiveActivityViewInput, "t" | "agentColor">;
/** A count for several agents. The island is always black, so white reads there. */
const SEVERAL_AGENTS_TINT = "#FFFFFF";
/** The list has 3 lines. When more agents have replies, 2 lines show agents and the last one opens the list. */
const AGENT_LIST_LINES = 3;
/** The rows fit the expanded island, and all photos stay small next to the 4 KB state limit. */
export const UNREAD_AGENT_ROWS = 4;

/** Returns `null` when nothing needs the user: the activity ends then, as the island goes quiet. */
export function liveActivityView(
  presentation: DynamicIslandPresentation,
  input: LiveActivityViewInput,
): AgentLiveActivityProps | null {
  const buttons = liveActivityButtons(presentation, input.t);
  const shown = liveActivityAgent(presentation);
  const allUnread =
    presentation.mode === "message" ? sortUnreadAgents(input.unreadAgents, presentation.message.agent.id) : [];
  const unread = allUnread.slice(0, UNREAD_AGENT_ROWS);
  const command = presentation.mode === "approval" ? (presentation.item.approval.command ?? undefined) : undefined;
  return liveActivityProps(
    presentation,
    {
      avatar: shown ? input.avatar(presentation.serverId, shown, liveActivityMood(presentation)) : "",
      // Several chats have replies, so a tap opens the agent list and the user chooses one.
      tapUrl: allUnread.length > 1 || !shown ? LIVE_ACTIVITY_LIST_URL : openUrl(presentation.serverId, shown.id),
      buttons: buttons.map((button) => ({
        label: button.label,
        prominent: button.prominent,
        url: liveActivityActionUrl(button.action, input.actionKey, command),
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
  { t, agentColor }: LiveActivityText,
): Omit<AgentLiveActivityProps, keyof LiveActivityExtras | LiveActivityTexts> | null {
  switch (presentation.mode) {
    case "idle":
      return null;
    case "working": {
      const rows = presentation.working.slice(0, WORKING_ROWS).map((item) => ({
        name: limit(item.agent.name, ROW_NAME_LIMIT),
        text: liveActivityMarkdown(item.task, ROW_TEXT_LIMIT),
      }));
      const first = presentation.working[0];
      return {
        mode: "working",
        label: t("mobile.liveActivity.badge.working"),
        symbol: "sparkles",
        // Work is the normal state, not an alert. It takes the agent color, as the avatar shows it.
        tint: first ? agentColor(first.agent.avatarSeed, first.agent.avatarHue) : "#8E8E93",
        title: first ? limit(first.agent.name, TITLE_LIMIT) : t("mobile.liveActivity.appName"),
        detail: first ? liveActivityMarkdown(first.task, DETAIL_LIMIT) : "",
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
        detail: liveActivityMarkdown(presentation.message.text, DETAIL_LIMIT),
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
        title: limit(presentation.item.title, TITLE_LIMIT),
        detail: liveActivityMarkdown(
          presentation.item.detail ??
            t("mobile.liveActivity.question.fallback", { name: presentation.item.agent.name }),
          DETAIL_LIMIT,
        ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: "#0A84FF",
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
        title: limit(presentation.item.title, TITLE_LIMIT),
        // The command shows as the host runs it. The reason is the agent's text.
        detail: command
          ? limit(command, APPROVAL_COMMAND_LIMIT)
          : liveActivityMarkdown(
              reason ?? presentation.item.detail ?? t("mobile.liveActivity.approval.fallback"),
              DETAIL_LIMIT,
            ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: "#FF9F0A",
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
        title: limit(presentation.item.title, TITLE_LIMIT),
        detail: liveActivityMarkdown(
          presentation.item.detail ?? t("mobile.liveActivity.takeover.fallback"),
          DETAIL_LIMIT,
        ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        compactTint: "#FF9F0A",
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
        title: limit(
          t("mobile.liveActivity.failed.title", { name: presentation.item.agent.name, title: presentation.item.title }),
          TITLE_LIMIT,
        ),
        detail: limit(presentation.item.detail ?? t("mobile.liveActivity.failed.fallback"), DETAIL_LIMIT),
        compact: t("mobile.liveActivity.badge.failed"),
        compactTint: "#FF453A",
        footer: "",
        detailLines: 2,
        detailMarkdown: false,
        rows: [],
      };
  }
}

/**
 * The desktop island answers questions and approvals in place. The activity offers the same
 * answers when it shows everything the answer depends on, and the Open button covers the rest.
 */
export function liveActivityButtons(presentation: DynamicIslandPresentation, t: MobileTranslate): LiveActivityButton[] {
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
    // Several questions need steps, and a secret needs the keyboard. The chat asks those.
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
    // As on the desktop, opening the details clears the failure. It needs a button: the tap link has
    // no signature, so a tap cannot change host state.
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

/** The island text in the phone language, for the coordinator that feeds `liveActivityView`. */
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

/** The bloub face for the state, as the app avatars show it. */
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

/** The faces the activity can show. The phone draws each of them before the host can ask for it. */
export const LIVE_ACTIVITY_MOODS: readonly LiveActivityMood[] = ["working", "responded", "failed", "waiting"];

/** The agent whose photo and chat the activity shows. */
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

/** The file name of a drawn bloub. The phone writes it and the host names it, so both use this. */
export function liveActivityBloubFile(seed: string, hue: AvatarHue | null, mood: LiveActivityMood): string {
  return `avatar-${liveActivityFileName(["bloub", seed, String(hue ?? ""), mood])}.png`;
}

/** A file name part that is different for each different list of parts. */
export function liveActivityFileName(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9]/gu, (character) => `_${character.codePointAt(0)?.toString(16)}_`))
    .join("-");
}

/** The link of a button. `command` is the command an Approve button runs, which the app shows again. */
export function liveActivityActionUrl(action: LiveActivityAction, key: Uint8Array, command?: string): string {
  const payload = JSON.stringify(command === undefined ? { action } : { action, command });
  return `${LIVE_ACTIVITY_URL}?${new URLSearchParams({ action: payload, sig: signLiveActivityLink(payload, key) })}`;
}

export type LiveActivityLink =
  | { type: "list" }
  | { type: "open"; serverId: string; agentId: string }
  | { type: "action"; action: LiveActivityAction; command: string | null };

/**
 * Reads a Live Activity link. Any app can open an `openbot://` link, so a link that changes host
 * state counts only with a valid signature. Without `key`, or with a wrong signature, it opens the list.
 */
export function readLiveActivityLink(url: string, key: Uint8Array | null): LiveActivityLink {
  const params = new URL(url).searchParams;
  const serverId = params.get("server");
  const agentId = params.get("agent");
  if (serverId && agentId) return { type: "open", serverId, agentId };
  const payload = params.get("action");
  const signature = params.get("sig");
  if (!key || payload === null || signature === null || !verifyLiveActivityLink(payload, signature, key)) {
    return { type: "list" };
  }
  return signedLink(JSON.parse(payload));
}

/** The host or this app signed the link, so its action has the shape that one of them built. */
function signedLink(value: unknown): LiveActivityLink {
  if (!isDynamicRecord(value) || !isLiveActivityAction(value.action)) return { type: "list" };
  return { type: "action", action: value.action, command: isString(value.command) ? value.command : null };
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

function openUrl(serverId: string, agentId: string): string {
  return `${LIVE_ACTIVITY_URL}?${new URLSearchParams({ server: serverId, agent: agentId })}`;
}

/** The agent the island shows first, then the most unread. */
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
