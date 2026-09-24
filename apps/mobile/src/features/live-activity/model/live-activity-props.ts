import type { DynamicIslandAgentIdentity, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { getBloubAvatarColor } from "../../agents/model/bloub-activity";
import { LIVE_ACTIVITY_LIST_URL, type LiveActivityAction } from "./live-activity-link";

/**
 * What the Live Activity shows. ActivityKit keeps the content state under 4 KB, so every text has a
 * limit, and the widget runtime reads only these plain values.
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
  /** The line under the content, such as `+2 more requests`. Empty when there is none. */
  footer: string;
  /** The most lines the detail can use. A command to approve shows in full. */
  detailLines: number;
  /** The agents that work now, for the `working` mode. */
  rows: Array<{ name: string; text: string }>;
  /** A `file://` URL of the agent photo in the App Group, or empty to show the symbol. */
  avatar: string;
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
}

export interface LiveActivityAgentRow {
  name: string;
  count: number;
  avatar: string;
  url: string;
}

export interface LiveActivityButton {
  label: string;
  prominent: boolean;
  action: LiveActivityAction;
}

export type AgentLiveActivitySymbol =
  | "sparkles"
  | "message.fill"
  | "questionmark.bubble.fill"
  | "checkmark.shield.fill"
  | "macwindow"
  | "xmark.octagon.fill";

const TITLE_LIMIT = 80;
const DETAIL_LIMIT = 180;
const ROW_NAME_LIMIT = 40;
const ROW_TEXT_LIMIT = 100;
const WORKING_ROWS = 3;
const BUTTON_LIMIT = 24;
/** About four Lock Screen lines. A longer command is not approved from a view that cuts it. */
const APPROVAL_COMMAND_LIMIT = 140;

type LiveActivityExtras = Pick<AgentLiveActivityProps, "avatar" | "buttons" | "agents" | "agentCount">;
/** The rows fit the expanded island, and all photos stay small next to the 4 KB state limit. */
export const UNREAD_AGENT_ROWS = 4;

/** Returns `null` when nothing needs the user: the activity ends then, as the island goes quiet. */
export function liveActivityProps(
  presentation: DynamicIslandPresentation,
  extras: LiveActivityExtras,
): AgentLiveActivityProps | null {
  const content = liveActivityContent(presentation);
  const agents = extras.agents
    .slice(0, UNREAD_AGENT_ROWS)
    .map((agent) => ({ ...agent, name: limit(agent.name, ROW_NAME_LIMIT) }));
  const several = extras.agentCount > 1 && agents.length > 1;
  return (
    content && {
      ...content,
      ...extras,
      agents: several ? agents : [],
      agentCount: several ? extras.agentCount : 0,
      listUrl: LIVE_ACTIVITY_LIST_URL,
    }
  );
}

function liveActivityContent(
  presentation: DynamicIslandPresentation,
): Omit<AgentLiveActivityProps, keyof LiveActivityExtras | "listUrl"> | null {
  switch (presentation.mode) {
    case "idle":
      return null;
    case "working": {
      const rows = presentation.working.slice(0, WORKING_ROWS).map((item) => ({
        name: limit(item.agent.name, ROW_NAME_LIMIT),
        text: limit(item.task, ROW_TEXT_LIMIT),
      }));
      const first = presentation.working[0];
      return {
        mode: "working",
        label: "Working",
        symbol: "sparkles",
        // Work is the normal state, not an alert. It takes the agent color, as the avatar shows it.
        tint: first ? getBloubAvatarColor(first.agent.avatarSeed, first.agent.avatarHue) : "#8E8E93",
        title: first ? limit(first.agent.name, TITLE_LIMIT) : "OpenBot",
        detail: first ? limit(first.task, DETAIL_LIMIT) : "",
        compact: presentation.working.length > 1 ? String(presentation.working.length) : "Working",
        footer: "",
        detailLines: 2,
        rows,
      };
    }
    case "message":
      return {
        mode: "message",
        label: "Message",
        symbol: "message.fill",
        tint: "#0A84FF",
        title: limit(presentation.message.agent.name, TITLE_LIMIT),
        detail: limit(presentation.message.text, DETAIL_LIMIT),
        compact: String(presentation.unreadCount),
        footer: `${presentation.unreadCount} unread`,
        detailLines: 2,
        rows: [],
      };
    case "question":
      return {
        mode: "question",
        label: "Questions",
        symbol: "questionmark.bubble.fill",
        tint: "#0A84FF",
        title: limit(presentation.item.title, TITLE_LIMIT),
        detail: limit(presentation.item.detail ?? `${presentation.item.agent.name} needs an answer.`, DETAIL_LIMIT),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        footer: remaining(presentation.remainingCount),
        detailLines: 2,
        rows: [],
      };
    case "approval": {
      const { command, reason } = presentation.item.approval;
      return {
        mode: "approval",
        label: "Approval",
        symbol: "checkmark.shield.fill",
        tint: "#FF9F0A",
        title: limit(presentation.item.title, TITLE_LIMIT),
        detail: limit(
          command ?? reason ?? presentation.item.detail ?? "Review the requested action before it runs.",
          command ? APPROVAL_COMMAND_LIMIT : DETAIL_LIMIT,
        ),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        footer: remaining(presentation.remainingCount),
        detailLines: command ? 4 : 2,
        rows: [],
      };
    }
    case "takeover":
      return {
        mode: "takeover",
        label: "Take over",
        symbol: "macwindow",
        tint: "#FF9F0A",
        title: limit(presentation.item.title, TITLE_LIMIT),
        detail: limit(presentation.item.detail ?? "Complete the browser step so the agent can continue.", DETAIL_LIMIT),
        compact: limit(presentation.item.agent.name, ROW_NAME_LIMIT),
        footer: "",
        detailLines: 2,
        rows: [],
      };
    case "failed":
      return {
        mode: "failed",
        label: "Failed",
        symbol: "xmark.octagon.fill",
        tint: "#FF453A",
        title: limit(`${presentation.item.agent.name}: ${presentation.item.title}`, TITLE_LIMIT),
        detail: limit(presentation.item.detail ?? "The task stopped before it could finish.", DETAIL_LIMIT),
        compact: "Failed",
        footer: "",
        detailLines: 2,
        rows: [],
      };
  }
}

/** What a tap on the activity does: it opens the chat of the agent it shows. */
export function liveActivityTapAction(presentation: DynamicIslandPresentation): LiveActivityAction | null {
  const agent = liveActivityAgent(presentation);
  return agent && { type: "open-agent", serverId: presentation.serverId, agentId: agent.id };
}

/**
 * The desktop island answers questions and approvals in place. The activity offers the same
 * answers when it shows everything the answer depends on, and the Open button covers the rest.
 */
export function liveActivityButtons(presentation: DynamicIslandPresentation): LiveActivityButton[] {
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
      { label: "Decline", prominent: false, action: respond("decline") },
      ...(approvable ? [{ label: "Approve", prominent: true, action: respond("accept") }] : []),
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
    // As on the desktop, opening the details clears the failure. It needs a button: the tap URL has
    // no token, so a tap cannot change host state.
    const action: LiveActivityAction = {
      type: "open-failure",
      serverId,
      agentId: presentation.item.agent.id,
      turnId: presentation.item.turnId,
    };
    return [{ label: "Open details", prominent: true, action }];
  }
  return [];
}

/** The bloub face for the state, as the app avatars show it. */
export function liveActivityMood(presentation: DynamicIslandPresentation) {
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

function remaining(count: number): string {
  if (count <= 0) return "";
  return `+${count} more ${count === 1 ? "request" : "requests"}`;
}

function limit(value: string, length: number): string {
  const characters = Array.from(value.replace(/\s+/gu, " ").trim());
  return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : characters.join("");
}
