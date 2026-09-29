import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentApproval,
  type AgentEvent,
  DYNAMIC_ISLAND_MAX_COUNT,
  type DynamicIslandAgentIdentity,
  type DynamicIslandApprovalItem,
  type DynamicIslandFailureItem,
  type DynamicIslandPresentation,
  type DynamicIslandPromptItem,
  type DynamicIslandQuestionItem,
  type DynamicIslandTakeoverItem,
  type QueueSnapshot,
} from "@openbot/contracts/ipc";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;
type BrowserTakeoverEvent = Extract<AgentEvent, { type: "browser-takeover-requested" }>;
type AttentionCandidate =
  | { mode: "approval"; item: DynamicIslandApprovalItem }
  | { mode: "takeover"; item: DynamicIslandTakeoverItem }
  | { mode: "question"; item: DynamicIslandPromptItem }
  | { mode: "failed"; item: DynamicIslandFailureItem };

/**
 * The island text in the interface language. Each app builds it from its own catalog, so
 * `team-client` stays free of UI, catalogs, and application state.
 */
export interface DynamicIslandText {
  taskWorking: string;
  questionHeader: string;
  questionText: string;
  optionFallback: (number: number) => string;
  takeoverTitle: string;
  takeoverDetail: string;
  failureTitle: string;
  failureDetail: string;
  approvalCommand: string;
  approvalFileChange: string;
  approvalPermissions: string;
  /** `userErrorMessage` in the interface language. `fallback` is already translated. */
  errorMessage: (error: unknown, fallback: string) => string;
}

export interface DynamicIslandPresentationInput {
  serverId: string;
  agents: DynamicIslandAgentSource[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  unreadReplies: Record<string, number>;
  unreadMessageIds?: Record<string, string | null>;
  liveMessages: Record<string, DynamicIslandMessageSource[]>;
  pendingPrompts: Record<string, PromptEvent | BrowserTakeoverEvent | undefined>;
  pendingApprovals: Record<string, AgentApproval | undefined>;
  failedTurns: Record<string, string | undefined>;
}

export interface DynamicIslandAgentSource {
  id: string;
  name: string;
  avatarSeed: string;
  avatarHue: DynamicIslandAgentIdentity["avatarHue"];
  avatarUrl: string | null;
  notifications: boolean;
  preview?: string;
  updatedAt?: string | null;
}

export interface DynamicIslandMessageSource {
  id: string;
  author: string;
  body: string;
  time: string;
  createdAt?: string;
}

export function selectDynamicIslandPresentation(
  presentations: readonly DynamicIslandPresentation[],
  attentionCount = presentations.reduce((total, presentation) => total + presentationAttentionCount(presentation), 0),
): DynamicIslandPresentation {
  const selected = presentations.reduce<DynamicIslandPresentation | undefined>(
    (current, presentation) =>
      !current || presentationPriority(presentation.mode) < presentationPriority(current.mode) ? presentation : current,
    undefined,
  );
  if (!selected) return { serverId: "local", mode: "idle" };
  if (selected.mode !== "approval" && selected.mode !== "question") return selected;
  return { ...selected, remainingCount: islandCount(attentionCount - 1) };
}

/** A count that main accepts. Main rejects a presentation with more than 10,000 unread replies, so the island stopped updating. */
function islandCount(count: number): number {
  return Math.min(DYNAMIC_ISLAND_MAX_COUNT, Math.max(0, count));
}

export function countDynamicIslandAttention(input: DynamicIslandPresentationInput, text: DynamicIslandText): number {
  const visibleAgents = input.agents.filter((agent) => agent.notifications);
  return collectAttention(input, new Map(visibleAgents.map((agent) => [agent.id, agent])), text).length;
}

export function createDynamicIslandPresentation(
  input: DynamicIslandPresentationInput,
  text: DynamicIslandText,
): DynamicIslandPresentation {
  const visibleAgents = input.agents.filter((agent) => agent.notifications);
  const agentsById = new Map(visibleAgents.map((agent) => [agent.id, agent]));
  const attentionItems = collectAttention(input, agentsById, text).sort(
    (left, right) => presentationPriority(left.mode) - presentationPriority(right.mode),
  );
  const attention = attentionItems[0];

  if (attention?.mode === "approval") {
    return {
      serverId: input.serverId,
      mode: "approval",
      item: attention.item,
      remainingCount: islandCount(attentionItems.length - 1),
    };
  }
  if (attention?.mode === "takeover") return { serverId: input.serverId, mode: "takeover", item: attention.item };
  if (attention?.mode === "question") {
    return {
      serverId: input.serverId,
      mode: "question",
      item: attention.item,
      remainingCount: islandCount(attentionItems.length - 1),
    };
  }
  if (attention?.mode === "failed") return { serverId: input.serverId, mode: "failed", item: attention.item };

  const working = visibleAgents
    .filter((agent) => isAgentWorking(agent.id, input))
    .slice(0, 3)
    .map((agent) => ({ agent: agentIdentity(agent), task: currentTask(agent.id, input.queues, text) }));
  if (working.length > 0) return { serverId: input.serverId, mode: "working", working };

  const message = latestUnreadMessage(input, visibleAgents);
  if (message) {
    return {
      serverId: input.serverId,
      mode: "message",
      unreadCount: islandCount(
        visibleAgents.reduce((total, agent) => total + Math.max(0, input.unreadReplies[agent.id] ?? 0), 0),
      ),
      message,
    };
  }
  return { serverId: input.serverId, mode: "idle" };
}

function latestUnreadMessage(input: DynamicIslandPresentationInput, agents: readonly DynamicIslandAgentSource[]) {
  return agents
    .filter((agent) => (input.unreadReplies[agent.id] ?? 0) > 0)
    .flatMap((agent) => {
      const message = [...(input.liveMessages[agent.id] ?? [])]
        .reverse()
        .find((candidate) => candidate.author === "agent");
      const messageId = message?.id ?? input.unreadMessageIds?.[agent.id];
      const text = message?.body.trim() || agent.preview?.trim();
      if (!messageId || !text) return [];
      const createdAt = message?.createdAt || agent.updatedAt || message?.time || new Date(0).toISOString();
      return [{ agent: agentIdentity(agent), messageId, text: truncate(text, 600), createdAt }];
    })
    .sort((left, right) => messageTimestamp(right.createdAt) - messageTimestamp(left.createdAt))[0];
}

function messageTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isAgentWorking(agentId: string, input: DynamicIslandPresentationInput): boolean {
  return Boolean(input.activeTurns[agentId]) || Boolean(runningDelivery(input.queues[agentId]));
}

function currentTask(agentId: string, queues: Record<string, QueueSnapshot>, text: DynamicIslandText): string {
  return truncate(runningDelivery(queues[agentId])?.text.trim() || text.taskWorking, 240);
}

function runningDelivery(snapshot: QueueSnapshot | undefined) {
  return snapshot?.deliveries.find((delivery) => delivery.status === "starting" || delivery.status === "running");
}

function collectAttention(
  input: DynamicIslandPresentationInput,
  agentsById: Map<string, DynamicIslandAgentSource>,
  text: DynamicIslandText,
): AttentionCandidate[] {
  const items: AttentionCandidate[] = [];
  for (const [agentId, approval] of Object.entries(input.pendingApprovals)) {
    const agent = agentsById.get(agentId);
    if (!agent || !approval) continue;
    items.push({
      mode: "approval",
      item: {
        requestId: approval.requestId,
        agent: agentIdentity(agent),
        title: approvalTitle(approval, text),
        detail: truncateNullable(approval.reason ?? approval.command),
        truncated:
          ("truncated" in approval && approval.truncated === true) ||
          [approval.command, approval.cwd, approval.reason, approval.grantRoot].some(
            (value) => value !== null && value.length > 600,
          ) ||
          Boolean(
            approval.permissions &&
              (approval.permissions.fileSystem.read.length > 3 ||
                approval.permissions.fileSystem.write.length > 3 ||
                [...approval.permissions.fileSystem.read, ...approval.permissions.fileSystem.write].some(
                  (path) => path.length > 600,
                )),
          ),
        approval: {
          kind: approval.kind,
          command: truncateNullable(approval.command),
          cwd: truncateNullable(approval.cwd),
          reason: truncateNullable(approval.reason),
          grantRoot: truncateNullable(approval.grantRoot),
          permissions: approval.permissions
            ? {
                fileSystem: {
                  read: approval.permissions.fileSystem.read.slice(0, 3).map((path) => truncate(path, 600)),
                  write: approval.permissions.fileSystem.write.slice(0, 3).map((path) => truncate(path, 600)),
                },
                network: approval.permissions.network,
              }
            : null,
        },
      },
    });
  }
  for (const [agentId, event] of Object.entries(input.pendingPrompts)) {
    const agent = agentsById.get(agentId);
    if (!agent || !event) continue;
    if (event.type === "prompt") {
      const questions = normalizeQuestions(event.questions, text);
      const question = questions[0];
      items.push({
        mode: "question",
        item: {
          requestId: event.requestId,
          agent: agentIdentity(agent),
          title: truncate(question?.header || text.questionHeader, 180),
          detail: truncateNullable(question?.question),
          questions,
        },
      });
      continue;
    }
    items.push({
      mode: "takeover",
      item: {
        requestId: event.request.requestId,
        agent: agentIdentity(agent),
        title: text.takeoverTitle,
        detail: text.takeoverDetail,
      },
    });
  }
  for (const [agentId, turnId] of Object.entries(input.failedTurns)) {
    const agent = agentsById.get(agentId);
    if (!agent || !turnId) continue;
    const delivery = input.queues[agentId]?.deliveries.find(
      (candidate) => candidate.status === "failed" && candidate.turnId === turnId,
    );
    items.push({
      mode: "failed",
      item: {
        turnId,
        agent: agentIdentity(agent),
        title: text.failureTitle,
        detail: failureDetail(delivery?.error, text),
      },
    });
  }
  return items;
}

function failureDetail(error: string | null | undefined, text: DynamicIslandText): string {
  return truncate(text.errorMessage(error, text.failureDetail), 600);
}

function truncate(value: string, length: number): string {
  return value.slice(0, length);
}

function normalizeQuestions(questions: PromptEvent["questions"], text: DynamicIslandText): DynamicIslandQuestionItem[] {
  return questions.slice(0, INPUT_LIMITS.promptQuestions).map((question, questionIndex) => ({
    id: normalizeTechnical(question.id, `question-${questionIndex + 1}`, INPUT_LIMITS.identifier),
    header: normalizeRequired(question.header, text.questionHeader, INPUT_LIMITS.promptHeader),
    question: normalizeRequired(question.question, text.questionText, INPUT_LIMITS.promptQuestion),
    isSecret: question.isSecret,
    options:
      question.options?.slice(0, INPUT_LIMITS.promptOptions).map((option, optionIndex) => {
        // The technical label is the answer the agent reads, so it stays in English.
        const fallback = `Option ${optionIndex + 1}`;
        const label = normalizeTechnical(option.label, fallback, INPUT_LIMITS.promptOptionLabel);
        const displayLabel = normalizeRequired(
          option.label,
          text.optionFallback(optionIndex + 1),
          INPUT_LIMITS.promptOptionLabel,
        );
        return {
          label,
          description: normalizeRequired(option.description, displayLabel, INPUT_LIMITS.promptOptionDescription),
        };
      }) ?? null,
  }));
}

function normalizeTechnical(value: string, fallback: string, length: number): string {
  return truncate(value || fallback, length);
}

function normalizeRequired(value: string, fallback: string, length: number): string {
  return truncate(value.trim() || fallback, length);
}

function truncateNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  return truncate(value, 600);
}

function approvalTitle(approval: AgentApproval, text: DynamicIslandText) {
  if (approval.kind === "command") return text.approvalCommand;
  if (approval.kind === "file-change") return text.approvalFileChange;
  return text.approvalPermissions;
}

function presentationPriority(mode: DynamicIslandPresentation["mode"]): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (mode === "question") return 0;
  if (mode === "approval") return 1;
  if (mode === "takeover") return 2;
  if (mode === "failed") return 3;
  if (mode === "working") return 4;
  if (mode === "message") return 5;
  return 6;
}

function presentationAttentionCount(presentation: DynamicIslandPresentation): number {
  if (presentation.mode === "approval" || presentation.mode === "question") return 1 + presentation.remainingCount;
  if (presentation.mode === "takeover" || presentation.mode === "failed") return 1;
  return 0;
}

function agentIdentity(agent: DynamicIslandAgentSource): DynamicIslandAgentIdentity {
  return {
    id: agent.id,
    name: agent.name,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
  };
}
