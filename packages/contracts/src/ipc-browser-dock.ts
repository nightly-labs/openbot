import { INPUT_LIMITS } from "./input-limits";
import { type AvatarHue, isAvatarHue } from "./ipc-agent-identity";
import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  isAgentApproval,
  isBrowserTakeoverRequest,
} from "./ipc-approvals";
import {
  integerInRange,
  isBoundedString,
  isFiniteNumber,
  isIdentifier,
  isNullableBoundedString,
  isRequestId,
} from "./ipc-bounded-values";
import { type AgentPromptQuestion, isAgentPromptQuestion } from "./ipc-conversation-messages";
import { MCP_TRANSPORTS, type McpServerConfig } from "./ipc-mcp-servers";
import { isQueueDelivery, isQueueHold, type QueueDelivery, type QueueHold } from "./ipc-queue";
import { INSTALLED_SKILL_ORIGINS, type InstalledSkill } from "./ipc-skills";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const BROWSER_DOCK_LIMITS = {
  skills: 500,
  skillText: 4_096,
  deliveries: 200,
  glass: 16,
  frameSize: 16_384,
  blur: 64,
  replyBody: INPUT_LIMITS.messageText,
  label: 600,
} as const;

export const BROWSER_DOCK_OVERLAY_WIDTH = 688;

export interface BrowserDockAgent {
  id: string;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
}

export type BrowserDockSkill = Pick<
  InstalledSkill,
  "skillId" | "slug" | "name" | "state" | "enabled" | "origin" | "description"
>;

export type BrowserDockMcpServer = Pick<
  McpServerConfig,
  "id" | "name" | "enabled" | "transport" | "command" | "args" | "url"
>;

export type BrowserDockIsland =
  | { kind: "activity"; control: "agent"; label: string }
  | { kind: "activity"; control: "user" | "request" }
  | { kind: "secret"; request: BrowserTakeoverRequest }
  | { kind: "prompt"; requestId: string | number; questions: AgentPromptQuestion[]; attempt: number }
  | { kind: "approval"; approval: AgentApproval; attempt: number }
  | { kind: "reply"; id: string; body: string; question?: boolean; answerInChat?: boolean };

export type BrowserDockSendShortcut = "enter" | "meta-enter" | "ctrl-enter";

export interface BrowserDockPresentation {
  agent: BrowserDockAgent;
  agents: BrowserDockAgent[];
  skills: BrowserDockSkill[];
  mcpServers: BrowserDockMcpServer[];
  draft: { text: string; revision: number };
  focusRequest: number;
  sendShortcut: BrowserDockSendShortcut;
  working: boolean;
  deliveries: QueueDelivery[];
  hold: QueueHold | null;
  editingDeliveryId: string | null;
  canSteer: boolean;
  steerSupported: boolean;
  canRunAsTask: boolean;
  island: BrowserDockIsland | null;
  handoffPending: boolean;
  canHandoff: boolean;
}

export type BrowserDockAction =
  | { type: "value-change"; text: string }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "steer"; deliveryId: string }
  | { type: "run-as-task"; deliveryId: string }
  | { type: "cancel"; deliveryId: string }
  | { type: "edit"; deliveryId: string }
  | { type: "cancel-edit" }
  | { type: "reorder"; deliveryIds: string[] }
  | { type: "handoff" }
  | { type: "dismiss-reply"; id: string }
  | { type: "answer-prompt"; requestId: string | number; answers: Record<string, string[]> }
  | { type: "respond-approval"; requestId: string | number; decision: "accept" | "decline" }
  | { type: "open-chat" }
  | { type: "select-agent"; agentId: string }
  | { type: "open-link"; url: string };

export interface BrowserDockGlass {
  left: number;
  bottom: number;
  width: number;
  height: number;
  radius: number;
  blur: number;
}

export interface BrowserDockAnchor {
  width: number;
}

export interface BrowserDockFrame {
  seq: number;
  height: number;
  glass: BrowserDockGlass[];
  anchor?: BrowserDockAnchor;
}

export function isBrowserDockPresentation(value: unknown): value is BrowserDockPresentation {
  return (
    isDynamicRecord(value) &&
    isBrowserDockAgent(value.agent) &&
    isList(value.agents, INPUT_LIMITS.agents, isBrowserDockAgent) &&
    isList(value.skills, BROWSER_DOCK_LIMITS.skills, isBrowserDockSkill) &&
    isList(value.mcpServers, INPUT_LIMITS.mcpServers, isBrowserDockMcpServer) &&
    isDraft(value.draft) &&
    isCount(value.focusRequest) &&
    isOneOf(["enter", "meta-enter", "ctrl-enter"] as const, value.sendShortcut) &&
    isBoolean(value.working) &&
    isList(value.deliveries, BROWSER_DOCK_LIMITS.deliveries, isQueueDelivery) &&
    (value.hold === null || isQueueHold(value.hold)) &&
    (value.editingDeliveryId === null || isIdentifier(value.editingDeliveryId)) &&
    isBoolean(value.canSteer) &&
    isBoolean(value.steerSupported) &&
    isBoolean(value.canRunAsTask) &&
    (value.island === null || isBrowserDockIsland(value.island)) &&
    isBoolean(value.handoffPending) &&
    isBoolean(value.canHandoff)
  );
}

export function isBrowserDockAction(value: unknown): value is BrowserDockAction {
  if (!isDynamicRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case "value-change":
    case "send":
      return isBoundedString(value.text, INPUT_LIMITS.messageText);
    case "steer":
    case "run-as-task":
    case "cancel":
    case "edit":
      return isIdentifier(value.deliveryId);
    case "reorder":
      return isList(value.deliveryIds, BROWSER_DOCK_LIMITS.deliveries, isIdentifier);
    case "dismiss-reply":
      return isIdentifier(value.id);
    case "answer-prompt":
      return isRequestId(value.requestId) && isPromptAnswers(value.answers);
    case "respond-approval":
      return isRequestId(value.requestId) && isOneOf(["accept", "decline"] as const, value.decision);
    case "select-agent":
      return isIdentifier(value.agentId);
    case "open-link":
      return isBoundedString(value.url, INPUT_LIMITS.browserUrl) && value.url.length > 0;
    case "stop":
    case "cancel-edit":
    case "handoff":
    case "open-chat":
      return true;
    default:
      return false;
  }
}

export function isBrowserDockFrame(value: unknown): value is BrowserDockFrame {
  return (
    isDynamicRecord(value) &&
    integerInRange(value.seq, 0, Number.MAX_SAFE_INTEGER) &&
    isSize(value.height) &&
    isList(value.glass, BROWSER_DOCK_LIMITS.glass, isGlass) &&
    (value.anchor === undefined || isAnchor(value.anchor))
  );
}

function isAnchor(value: unknown): value is BrowserDockAnchor {
  return isDynamicRecord(value) && isSize(value.width);
}

function isGlass(value: unknown): value is BrowserDockGlass {
  return (
    isDynamicRecord(value) &&
    isOffset(value.left) &&
    isOffset(value.bottom) &&
    isSize(value.width) &&
    isSize(value.height) &&
    isSize(value.radius) &&
    isFiniteNumber(value.blur) &&
    value.blur >= 0 &&
    value.blur <= BROWSER_DOCK_LIMITS.blur
  );
}

function isSize(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= BROWSER_DOCK_LIMITS.frameSize;
}

function isOffset(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -BROWSER_DOCK_LIMITS.frameSize && value <= BROWSER_DOCK_LIMITS.frameSize;
}

function isCount(value: unknown): value is number {
  return integerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isList<T>(value: unknown, maximum: number, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(isItem);
}

function isDraft(value: unknown): value is BrowserDockPresentation["draft"] {
  return isDynamicRecord(value) && isBoundedString(value.text, INPUT_LIMITS.messageText) && isCount(value.revision);
}

export function isPromptAnswers(value: unknown): value is Record<string, string[]> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > INPUT_LIMITS.promptQuestions) return false;
  let total = 0;
  for (const [questionId, answers] of entries) {
    if (
      !isBoundedString(questionId, INPUT_LIMITS.identifier) ||
      !Array.isArray(answers) ||
      answers.length > INPUT_LIMITS.promptAnswersPerQuestion
    ) {
      return false;
    }
    for (const answer of answers) {
      if (!isBoundedString(answer, INPUT_LIMITS.promptAnswerText)) return false;
      total += answer.length;
    }
  }
  return total <= INPUT_LIMITS.promptAnswersTotalText;
}

function isBrowserDockAgent(value: unknown): value is BrowserDockAgent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoundedString(value.avatarSeed, INPUT_LIMITS.identifier) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    isNullableBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)
  );
}

function isBrowserDockSkill(value: unknown): value is BrowserDockSkill {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.skillId, BROWSER_DOCK_LIMITS.skillText) &&
    isBoundedString(value.slug, BROWSER_DOCK_LIMITS.skillText) &&
    isBoundedString(value.name, BROWSER_DOCK_LIMITS.skillText) &&
    isOneOf(["installed", "update-available", "modified", "needs-repair"] as const, value.state) &&
    (value.enabled === undefined || isBoolean(value.enabled)) &&
    (value.origin === undefined || isOneOf(INSTALLED_SKILL_ORIGINS, value.origin)) &&
    (value.description === undefined || isBoundedString(value.description, BROWSER_DOCK_LIMITS.skillText))
  );
}

function isBrowserDockMcpServer(value: unknown): value is BrowserDockMcpServer {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.mcpServerName) &&
    isBoolean(value.enabled) &&
    isOneOf(MCP_TRANSPORTS, value.transport) &&
    isBoundedString(value.command, INPUT_LIMITS.mcpCommand) &&
    Array.isArray(value.args) &&
    value.args.length <= INPUT_LIMITS.mcpArgs &&
    value.args.every((arg) => isBoundedString(arg, INPUT_LIMITS.mcpArgValue)) &&
    isBoundedString(value.url, INPUT_LIMITS.mcpUrl)
  );
}

export function isBrowserDockIsland(value: unknown): value is BrowserDockIsland {
  if (!isDynamicRecord(value)) return false;
  switch (value.kind) {
    case "activity":
      if (value.control === "agent") return isBoundedString(value.label, BROWSER_DOCK_LIMITS.label);
      return value.control === "user" || value.control === "request";
    case "secret":
      return isBrowserTakeoverRequest(value.request);
    case "prompt":
      return (
        isRequestId(value.requestId) &&
        isList(value.questions, INPUT_LIMITS.promptQuestions, isAgentPromptQuestion) &&
        value.questions.length > 0 &&
        isCount(value.attempt)
      );
    case "approval":
      return isAgentApproval(value.approval) && isCount(value.attempt);
    case "reply":
      return (
        isIdentifier(value.id) &&
        isBoundedString(value.body, BROWSER_DOCK_LIMITS.replyBody) &&
        (value.question === undefined || isBoolean(value.question)) &&
        (value.answerInChat === undefined || isBoolean(value.answerInChat))
      );
    default:
      return false;
  }
}
