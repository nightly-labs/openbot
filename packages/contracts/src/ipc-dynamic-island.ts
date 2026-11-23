import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, type AvatarHue, isAvatarColor, isAvatarHue } from "./ipc-agent-identity";
import type { AgentApprovalKind, AgentApprovalPermissions } from "./ipc-approvals";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export interface DynamicIslandPreference {
  enabled: boolean;
  hapticsEnabled: boolean;
  idleVisible: boolean;
  additionalDisplaysEnabled: boolean;
  widthPercent: number;
  heightPercent: number;
  serverVisibility: Record<string, boolean>;
  newServersVisible: boolean;
}

export const DYNAMIC_ISLAND_SERVER_CHOICES_LIMIT = 256;

export const DYNAMIC_ISLAND_SIZE_LIMITS = {
  widthPercent: { min: 20, max: 130, step: 5 },
  heightPercent: { min: 75, max: 125, step: 5 },
} as const;

export const DYNAMIC_ISLAND_MAX_COUNT = 10_000;

export const DYNAMIC_ISLAND_DEFAULT_COMPACT_HEIGHT = 32;

export function dynamicIslandCompactHeight(notchHeight: number | undefined, heightPercent: number): number {
  const scaled = Math.round(((notchHeight ?? DYNAMIC_ISLAND_DEFAULT_COMPACT_HEIGHT) * heightPercent) / 100);
  return notchHeight === undefined ? scaled : Math.max(notchHeight, scaled);
}

export type SetDynamicIslandPreferenceInput = DynamicIslandPreference;

export const DEFAULT_DYNAMIC_ISLAND_PREFERENCE = {
  enabled: true,
  hapticsEnabled: true,
  idleVisible: true,
  additionalDisplaysEnabled: true,
  widthPercent: 100,
  heightPercent: 100,
  serverVisibility: {},
  newServersVisible: true,
} as const satisfies DynamicIslandPreference;

export function isDynamicIslandServerVisible(
  preference: Pick<DynamicIslandPreference, "serverVisibility" | "newServersVisible">,
  serverId: string,
): boolean {
  return Object.hasOwn(preference.serverVisibility, serverId)
    ? preference.serverVisibility[serverId] === true
    : preference.newServersVisible;
}

export interface DynamicIslandAgentIdentity {
  id: string;
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  avatarUrl: string | null;
}

export interface DynamicIslandWorkingItem {
  agent: DynamicIslandAgentIdentity;
  task: string;
  turnId: string | null;
}

export interface DynamicIslandMessageItem {
  agent: DynamicIslandAgentIdentity;
  messageId: string;
  text: string;
  createdAt: string;
}

export interface DynamicIslandQuestionItem {
  id: string;
  header: string;
  question: string;
  detail?: string;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
}

export interface DynamicIslandPromptItem {
  requestId: string | number;
  agent: DynamicIslandAgentIdentity;
  title: string;
  detail: string | null;
  questions: DynamicIslandQuestionItem[];
}

export interface DynamicIslandApprovalItem {
  requestId: string | number;
  agent: DynamicIslandAgentIdentity;
  title: string;
  detail: string | null;
  truncated: boolean;
  approval: {
    kind: AgentApprovalKind;
    command: string | null;
    cwd: string | null;
    reason: string | null;
    grantRoot: string | null;
    permissions: AgentApprovalPermissions | null;
  };
}

export interface DynamicIslandTakeoverItem {
  requestId: string | number;
  agent: DynamicIslandAgentIdentity;
  title: string;
  detail: string | null;
}

export interface DynamicIslandFailureItem {
  turnId: string;
  agent: DynamicIslandAgentIdentity;
  title: string;
  detail: string | null;
}

interface DynamicIslandPresentationBase {
  serverId: string;
}

export type DynamicIslandPresentation =
  | (DynamicIslandPresentationBase & { mode: "idle" })
  | (DynamicIslandPresentationBase & { mode: "working"; working: DynamicIslandWorkingItem[] })
  | (DynamicIslandPresentationBase & { mode: "message"; unreadCount: number; message: DynamicIslandMessageItem })
  | (DynamicIslandPresentationBase & {
      mode: "question";
      item: DynamicIslandPromptItem;
      remainingCount: number;
    })
  | (DynamicIslandPresentationBase & {
      mode: "approval";
      item: DynamicIslandApprovalItem;
      remainingCount: number;
    })
  | (DynamicIslandPresentationBase & { mode: "takeover"; item: DynamicIslandTakeoverItem })
  | (DynamicIslandPresentationBase & { mode: "failed"; item: DynamicIslandFailureItem });

export type DynamicIslandAction =
  | { type: "open-app" }
  | { type: "open-agent"; serverId: string; agentId: string }
  | { type: "open-message"; serverId: string; agentId: string; messageId: string }
  | { type: "send-message"; serverId: string; agentId: string; text: string; clientMessageId: string }
  | { type: "stop-agent"; serverId: string; agentId: string; turnId: string }
  | { type: "open-failure"; serverId: string; agentId: string; turnId: string }
  | { type: "dismiss-failure"; serverId: string; agentId: string; turnId: string }
  | { type: "review-attention"; serverId: string; agentId: string; requestId: string | number }
  | ({ type: "open-browser-takeover" } & BrowserTakeoverPage)
  | {
      type: "answer-prompt";
      serverId: string;
      agentId: string;
      requestId: string | number;
      answers: Record<string, string[]>;
    }
  | {
      type: "respond-approval";
      serverId: string;
      agentId: string;
      requestId: string | number;
      decision: "accept" | "decline";
    };

export interface BrowserTakeoverPage {
  serverId: string;
  agentId: string;
  tabId: string;
}

export interface SetDynamicIslandInteractiveInput {
  interactive: boolean;
  keyboard?: boolean;
}

export interface DynamicIslandNotchSize {
  width: number;
  height: number;
}

export type DynamicIslandGeometry = DynamicIslandNotchSize | null;

export const IDLE_DYNAMIC_ISLAND_PRESENTATION: DynamicIslandPresentation = { serverId: "local", mode: "idle" };

export function isDynamicIslandPreference(value: unknown): value is DynamicIslandPreference {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.enabled) &&
    isBoolean(value.hapticsEnabled) &&
    isBoolean(value.idleVisible) &&
    isBoolean(value.additionalDisplaysEnabled) &&
    isDynamicIslandSizePercent(value.widthPercent, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent) &&
    isDynamicIslandSizePercent(value.heightPercent, DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent) &&
    isDynamicIslandServerVisibility(value.serverVisibility) &&
    isBoolean(value.newServersVisible)
  );
}

export function isDynamicIslandServerVisibility(value: unknown): value is Record<string, boolean> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= DYNAMIC_ISLAND_SERVER_CHOICES_LIMIT &&
    entries.every(
      ([serverId, visible]) => serverId.length > 0 && serverId.length <= INPUT_LIMITS.identifier && isBoolean(visible),
    )
  );
}

export function isDynamicIslandSizePercent(
  value: unknown,
  limits: { min: number; max: number; step: number },
): value is number {
  return (
    isNumber(value) &&
    Number.isInteger(value) &&
    value >= limits.min &&
    value <= limits.max &&
    (value - limits.min) % limits.step === 0
  );
}

export function isDynamicIslandInteractive(value: unknown): value is SetDynamicIslandInteractiveInput {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.interactive) &&
    (value.keyboard === undefined || isBoolean(value.keyboard))
  );
}

export function isDynamicIslandNotchSize(value: unknown): value is DynamicIslandNotchSize {
  return isDynamicRecord(value) && isPositiveFiniteNumber(value.width) && isPositiveFiniteNumber(value.height);
}

export function isDynamicIslandPresentation(value: unknown): value is DynamicIslandPresentation {
  if (!isDynamicRecord(value) || !isShortString(value.serverId, 160)) return false;
  if (value.mode === "idle") return true;
  if (value.mode === "working") {
    return Array.isArray(value.working) && value.working.length <= 3 && value.working.every(isWorkingItem);
  }
  if (value.mode === "message") return isSafeCount(value.unreadCount) && isMessageItem(value.message);
  if (value.mode === "question") return isPromptItem(value.item) && isSafeCount(value.remainingCount);
  if (value.mode === "approval") return isApprovalItem(value.item) && isSafeCount(value.remainingCount);
  if (value.mode === "takeover") return isTakeoverItem(value.item);
  if (value.mode === "failed") return isFailureItem(value.item);
  return false;
}

export function isDynamicIslandAction(value: unknown): value is DynamicIslandAction {
  if (!isDynamicRecord(value) || !isString(value.type)) return false;
  if (value.type === "open-app") return true;
  if (!isShortString(value.serverId, 160) || !isShortString(value.agentId, 160)) return false;
  if (value.type === "open-agent") return true;
  if (value.type === "open-message") return isShortString(value.messageId, 160);
  if (value.type === "send-message") {
    return (
      isShortString(value.text, INPUT_LIMITS.directMessageText) &&
      value.text.trim().length > 0 &&
      isShortString(value.clientMessageId, INPUT_LIMITS.identifier)
    );
  }
  if (value.type === "stop-agent" || value.type === "open-failure" || value.type === "dismiss-failure") {
    return isShortString(value.turnId, 160);
  }
  if (value.type === "review-attention") {
    return isDynamicIslandRequestId(value.requestId);
  }
  if (value.type === "open-browser-takeover") return isShortString(value.tabId, 160);
  if (value.type === "respond-approval") {
    return isDynamicIslandRequestId(value.requestId) && (value.decision === "accept" || value.decision === "decline");
  }
  return (
    value.type === "answer-prompt" && isDynamicIslandRequestId(value.requestId) && isDynamicIslandAnswers(value.answers)
  );
}

export function isBrowserTakeoverPage(value: unknown): value is BrowserTakeoverPage {
  return (
    isDynamicRecord(value) &&
    isShortString(value.serverId, 160) &&
    isShortString(value.agentId, 160) &&
    isShortString(value.tabId, 160)
  );
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value > 0;
}

function isSafeCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= DYNAMIC_ISLAND_MAX_COUNT;
}

function isShortString(value: unknown, length: number): value is string {
  return isString(value) && value.length > 0 && value.length <= length;
}

function isNullableShortString(value: unknown, length: number): value is string | null {
  return value === null || isShortString(value, length);
}

function isAgentIdentity(value: unknown): value is DynamicIslandAgentIdentity {
  return (
    isDynamicRecord(value) &&
    isShortString(value.id, 160) &&
    isShortString(value.name, 120) &&
    isShortString(value.avatarSeed, 160) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarColor === undefined || value.avatarColor === null || isAvatarColor(value.avatarColor)) &&
    (value.avatarUrl === null || isShortString(value.avatarUrl, 2_048))
  );
}

function isWorkingItem(value: unknown): value is DynamicIslandWorkingItem {
  return (
    isDynamicRecord(value) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.task, 240) &&
    isNullableShortString(value.turnId, 160)
  );
}

function isMessageItem(value: unknown): value is DynamicIslandMessageItem {
  return (
    isDynamicRecord(value) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.messageId, 160) &&
    isShortString(value.text, 600) &&
    isShortString(value.createdAt, 80)
  );
}

function isPromptItem(value: unknown): value is DynamicIslandPromptItem {
  return (
    isDynamicRecord(value) &&
    isDynamicIslandRequestId(value.requestId) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.title, 180) &&
    isNullableShortString(value.detail, 600) &&
    Array.isArray(value.questions) &&
    value.questions.length <= INPUT_LIMITS.promptQuestions &&
    value.questions.every(isQuestionItem)
  );
}

function isApprovalItem(value: unknown): value is DynamicIslandApprovalItem {
  return (
    isDynamicRecord(value) &&
    isDynamicIslandRequestId(value.requestId) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.title, 180) &&
    isNullableShortString(value.detail, 600) &&
    isBoolean(value.truncated) &&
    isApproval(value.approval)
  );
}

function isTakeoverItem(value: unknown): value is DynamicIslandTakeoverItem {
  return (
    isDynamicRecord(value) &&
    isDynamicIslandRequestId(value.requestId) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.title, 180) &&
    isNullableShortString(value.detail, 600)
  );
}

function isFailureItem(value: unknown): value is DynamicIslandFailureItem {
  return (
    isDynamicRecord(value) &&
    isShortString(value.turnId, 160) &&
    isAgentIdentity(value.agent) &&
    isShortString(value.title, 180) &&
    isNullableShortString(value.detail, 600)
  );
}

function isQuestionItem(value: unknown): value is DynamicIslandQuestionItem {
  return (
    isDynamicRecord(value) &&
    isShortString(value.id, INPUT_LIMITS.identifier) &&
    isShortString(value.header, INPUT_LIMITS.promptHeader) &&
    isShortString(value.question, INPUT_LIMITS.promptQuestion) &&
    (value.detail === undefined || isShortString(value.detail, INPUT_LIMITS.promptQuestion)) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= INPUT_LIMITS.promptOptions &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isShortString(option.label, INPUT_LIMITS.promptOptionLabel) &&
            isShortString(option.description, INPUT_LIMITS.promptOptionDescription),
        )))
  );
}

function isApproval(value: unknown): value is DynamicIslandApprovalItem["approval"] {
  if (!isDynamicRecord(value)) return false;
  if (value.kind !== "command" && value.kind !== "file-change" && value.kind !== "permissions") return false;
  if (
    !isNullableShortString(value.command, 600) ||
    !isNullableShortString(value.cwd, 600) ||
    !isNullableShortString(value.reason, 600) ||
    !isNullableShortString(value.grantRoot, 600)
  ) {
    return false;
  }
  if (value.permissions === null) return true;
  if (!isDynamicRecord(value.permissions) || !isDynamicRecord(value.permissions.fileSystem)) return false;
  return (
    isBoolean(value.permissions.network) &&
    isShortStringList(value.permissions.fileSystem.read) &&
    isShortStringList(value.permissions.fileSystem.write)
  );
}

function isDynamicIslandRequestId(value: unknown): value is string | number {
  return isShortString(value, 160) || (isNumber(value) && Number.isSafeInteger(value));
}

function isShortStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 3 && value.every((item) => isShortString(item, 600));
}

function isDynamicIslandAnswers(value: unknown): value is Record<string, string[]> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > INPUT_LIMITS.promptQuestions) return false;
  let totalLength = 0;
  for (const [questionId, answers] of entries) {
    if (!isShortString(questionId, INPUT_LIMITS.identifier) || !Array.isArray(answers) || answers.length !== 1) {
      return false;
    }
    const [answer] = answers;
    if (!isShortString(answer, INPUT_LIMITS.directMessageText)) return false;
    totalLength += answer.length;
  }
  return totalLength <= INPUT_LIMITS.promptAnswersTotalText;
}
