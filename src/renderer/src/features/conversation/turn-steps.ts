import { analyticsTokens, type ConversationTurnTrace } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AgentMessage } from "@openbot/ui/data";
import type { AgentStep, AgentStepsFacts } from "@openbot/ui/features/conversation/AgentSteps";
import { silentAgentAnswer } from "@openbot/ui/features/conversation/new-message-tally";
import type { TraceSpan } from "@openbot/ui/features/conversation/TraceWaterfall";
import { createMemo } from "solid-js";
import type { TurnStepLines } from "./turn-step-lines";

const NO_STEPS: AgentStep[] = [];

export const SUBAGENT_SPAN_PREFIX = "subagent:";
const REPLY_SPAN_PREFIX = "reply:";

function sameSteps(left: readonly AgentStep[], right: readonly AgentStep[]): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const other = right[index];
      if (other?.id !== step.id || other.kind !== step.kind) return false;
      if (step.kind === "memory" && other.kind === "memory" && other.change.action !== step.change.action) return false;
      if (step.kind === "progress" && other.kind === "progress" && other.error !== step.error) return false;
      return stepText(other) === stepText(step);
    })
  );
}

function stepText(step: AgentStep): string {
  return step.kind === "memory" ? step.change.text : step.text;
}

function thoughtTitle(text: string): string {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line
    .replace(/^#+\s*/, "")
    .replaceAll("**", "")
    .slice(0, 120);
}

export interface TraceLabels {
  agent: string;
  thinking: string;
  answer: string;
  progress: (text: string) => string;
  message: (names: string) => string;
  subagent: (title: string) => string;
  reply: string;
  agentNames: (ids: readonly string[]) => string;
}

type TimedStep = { step: AgentStep; at: number };

function storedSpans(
  trace: ConversationTurnTrace,
  timed: readonly TimedStep[],
  turnEnd: number,
  subagentTitles: ReadonlyMap<string, string>,
  labels: TraceLabels,
): TraceSpan[] {
  const thoughts = new Map<string, string>();
  const lines: AgentStep[] = [];
  for (const { step } of timed) {
    if (step.kind === "thinking") thoughts.set(step.id, step.text);
    else if (step.kind === "progress") lines.push(step);
  }
  const spans: TraceSpan[] = [];
  const traceStart = Date.parse(trace.startedAt);
  let previousEnd = Number.isFinite(traceStart) ? traceStart : Number.NEGATIVE_INFINITY;
  for (const step of trace.steps) {
    const started = Date.parse(step.startedAt);
    if (!Number.isFinite(started)) continue;
    const ended = Date.parse(step.endedAt ?? "");
    const end = Math.max(started, Number.isFinite(ended) ? ended : turnEnd);
    const whole = step.kind !== "tool" && end === started;
    const start = whole && Number.isFinite(previousEnd) ? Math.min(previousEnd, started) : started;
    previousEnd = Math.max(previousEnd, end);
    const failed = step.failed === true;
    if (step.kind === "reasoning") {
      const title = thoughtTitle(thoughts.get(step.id) ?? "");
      spans.push({
        id: step.id,
        parentId: "turn",
        name: title || labels.thinking,
        kind: "model",
        icon: "thinking",
        failed,
        start,
        end,
      });
    } else if (step.kind === "tool") {
      const text = step.text ?? "";
      const line = lines.findIndex((candidate) => candidate.kind === "progress" && candidate.text === text);
      const id = line === -1 ? step.id : (lines.splice(line, 1)[0]?.id ?? step.id);
      const subagent = subagentTitles.get(step.id);
      const command = step.command?.trim().split("\n", 1)[0];
      const span: TraceSpan = { id, parentId: "turn", name: labels.progress(text), kind: "tool", failed, start, end };
      if (failed && step.error) span.error = step.error;
      if (step.recipientAgentIds?.length) {
        span.kind = "handoff";
        span.name = labels.message(labels.agentNames(step.recipientAgentIds));
      } else if (subagent !== undefined) {
        span.kind = "handoff";
        span.name = labels.subagent(subagent);
      } else if (command) {
        span.icon = "command";
        span.name = command;
      }
      spans.push(span);
    } else {
      spans.push({
        id: step.id,
        parentId: "turn",
        name: labels.answer,
        kind: "model",
        icon: "text",
        failed,
        start,
        end,
      });
    }
  }
  return spans;
}

function guessedSpans(timed: readonly TimedStep[], lastEnd: number, labels: TraceLabels): TraceSpan[] {
  const spans: TraceSpan[] = [];
  for (const [index, { step, at }] of timed.entries()) {
    const end = Math.max(at, timed[index + 1]?.at ?? lastEnd);
    if (step.kind === "thinking") {
      spans.push({
        id: step.id,
        parentId: "turn",
        name: thoughtTitle(step.text),
        kind: "model",
        icon: "thinking",
        start: at,
        end,
      });
    } else if (step.kind === "progress") {
      const span: TraceSpan = {
        id: step.id,
        parentId: "turn",
        name: labels.progress(step.text),
        kind: "tool",
        start: at,
        end,
      };
      if (step.error) {
        span.failed = true;
        span.error = step.error;
      }
      spans.push(span);
    }
  }
  return spans;
}

export function isTurnAnswer(message: AgentMessage): boolean {
  return message.author === "agent" && message.kind === "text" && !silentAgentAnswer(message);
}

export function createTurnSteps(deps: {
  messages: () => readonly AgentMessage[];
  lines: () => TurnStepLines | undefined;
  activeTurnId: () => string | null | undefined;
}) {
  const seenAt = new Map<string, number>();
  const lists = new Map<string, AgentStep[]>();
  const sources = createMemo(() => {
    const thinking = new Map<string, AgentMessage>();
    const memory = new Map<string, AgentMessage>();
    const subagents = new Map<string, AgentMessage>();
    const answers = new Map<string, string>();
    const silent = new Set<string>();
    const answerTimes = new Map<string, string>();
    const startTimes = new Map<string, string>();
    const traces = new Map<string, ConversationTurnTrace>();
    const sent = new Map<string, AgentMessage[]>();
    const replies = new Map<string, AgentMessage[]>();
    for (const message of deps.messages()) {
      const replyTo = message.exchange?.direction === "incoming" ? message.exchange.replyToMessageId : null;
      if (replyTo) replies.set(replyTo, [...(replies.get(replyTo) ?? []), message]);
      const turnId = message.turnId;
      if (!turnId) continue;
      if (message.exchange?.direction === "outgoing" && message.exchange.expectsReply !== false)
        sent.set(turnId, [...(sent.get(turnId) ?? []), message]);
      if (message.createdAt && !startTimes.has(turnId)) startTimes.set(turnId, message.createdAt);
      if (message.trace) traces.set(turnId, message.trace);
      if (message.kind === "thinking") thinking.set(turnId, message);
      else if (message.kind === "memory-changes") memory.set(turnId, message);
      else if (message.kind === "subagents") subagents.set(turnId, message);
      else if (isTurnAnswer(message) && !answers.has(turnId)) {
        answers.set(turnId, message.id);
        if (message.createdAt) answerTimes.set(turnId, message.createdAt);
      } else if (silentAgentAnswer(message)) silent.add(turnId);
    }
    const thoughtIds = new Set([...thinking.values()].flatMap((message) => message.itemIds ?? []));
    for (const id of seenAt.keys()) if (!thoughtIds.has(id)) seenAt.delete(id);
    const lines = deps.lines() ?? {};
    for (const turnId of lists.keys())
      if (!thinking.has(turnId) && !memory.has(turnId) && !lines[turnId] && !traces.has(turnId)) lists.delete(turnId);
    return { thinking, memory, subagents, answers, silent, answerTimes, startTimes, traces, sent, replies };
  });

  function timedSteps(turnId: string): TimedStep[] {
    const { thinking } = sources();
    const now = Date.now();
    const thoughts = thinking.get(turnId);
    const timed: TimedStep[] = [];
    for (const [index, text] of (thoughts?.items ?? []).entries()) {
      if (!markdownPreviewText(text)) continue;
      const id = thoughts?.itemIds?.[index] ?? `${thoughts?.id}:${index}`;
      const written = Date.parse(thoughts?.itemCreatedAt?.[index] ?? "");
      const at = Number.isFinite(written) ? written : (seenAt.get(id) ?? now);
      seenAt.set(id, at);
      timed.push({ step: { id, kind: "thinking", text }, at });
    }
    const lines = deps.lines()?.[turnId] ?? [];
    for (const line of lines) {
      timed.push({ step: { id: line.id, kind: "progress", text: line.text, error: line.error }, at: line.at });
    }
    if (lines.length === 0) {
      for (const step of sources().traces.get(turnId)?.steps ?? []) {
        const at = Date.parse(step.startedAt);
        if (step.kind !== "tool" || !step.text?.trim() || !Number.isFinite(at)) continue;
        timed.push({
          step: { id: `${turnId}:trace:${step.id}`, kind: "progress", text: step.text, error: step.error },
          at,
        });
      }
    }
    return timed.sort((left, right) => left.at - right.at);
  }

  function stepsOf(turnId: string | null | undefined): AgentStep[] {
    if (!turnId) return [];
    const { memory } = sources();
    const steps = timedSteps(turnId).map(({ step }) => step);
    const changes = memory.get(turnId);
    if (changes?.memoryChanges) {
      for (const [index, change] of changes.memoryChanges.entries())
        steps.push({ id: `${changes.id}:${index}`, kind: "memory", change });
    } else if (changes) {
      steps.push({ id: changes.id, kind: "memory-summary", text: changes.body });
    }
    const previous = lists.get(turnId);
    if (previous && sameSteps(previous, steps)) return previous;
    lists.set(turnId, steps);
    return steps;
  }

  function turnBounds(turnId: string) {
    const { subagents, answerTimes, startTimes, traces } = sources();
    const timed = timedSteps(turnId);
    const stored = traces.get(turnId);
    const answerAt = Date.parse(answerTimes.get(turnId) ?? "");
    const startAt = Date.parse(startTimes.get(turnId) ?? "");
    const ran = (subagents.get(turnId)?.subagents ?? []).map((subagent) => ({
      subagent,
      start: Date.parse(subagent.startedAt),
      end: subagent.endedAt === null ? null : Date.parse(subagent.endedAt),
    }));
    const starts = [startAt, ...timed.map(({ at }) => at), ...ran.map(({ start }) => start)].filter(Number.isFinite);
    if (starts.length === 0) return undefined;
    const lastStepAt = timed.at(-1)?.at ?? Number.NaN;
    const ends = [answerAt, lastStepAt, ...ran.map(({ end }) => end ?? Number.NaN)].filter(Number.isFinite);
    const storedStart = Date.parse(stored?.startedAt ?? "");
    const storedEnd = Date.parse(stored?.endedAt ?? "");
    const turnStart = Number.isFinite(storedStart)
      ? Math.min(storedStart, ...starts.filter((at) => at !== startAt))
      : Math.min(...starts);
    const turnEnd = Math.max(turnStart, ...ends, ...(Number.isFinite(storedEnd) ? [storedEnd] : []));
    return { timed, stored, ran, answerAt, turnStart, turnEnd };
  }

  const turnOfAnswer = createMemo(() => {
    const active = deps.activeTurnId();
    const { answers, silent, thinking } = sources();
    const turns = new Map<string, string>();
    for (const [turnId, messageId] of answers) if (turnId !== active) turns.set(messageId, turnId);
    for (const [turnId, message] of thinking)
      if (turnId !== active && !answers.has(turnId) && !silent.has(turnId)) turns.set(message.id, turnId);
    return turns;
  });

  return {
    activeSteps: createMemo(() => {
      const turnId = deps.activeTurnId();
      return turnId && sources().answers.has(turnId) ? NO_STEPS : stepsOf(turnId);
    }),
    workingSteps(turnIds: readonly string[]): AgentStep[] {
      const { answers } = sources();
      const turns = turnIds.filter((turnId) => !answers.has(turnId));
      return turns.length === 0 ? NO_STEPS : turns.flatMap(stepsOf);
    },
    stepsAbove(messageId: string | undefined): AgentStep[] | undefined {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const steps = stepsOf(turnId);
      return steps.length > 0 ? steps : undefined;
    },
    factsAbove(messageId: string | undefined): AgentStepsFacts | undefined {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const turn = turnId === undefined ? undefined : turnBounds(turnId);
      if (!turn) return undefined;
      const failedSteps = turn.stored?.steps.filter((step) => step.failed === true).length ?? 0;
      const failedSubagents = turn.ran.filter(({ subagent }) => subagent.status === "failed").length;
      return { durationMs: turn.turnEnd - turn.turnStart, failed: failedSteps + failedSubagents };
    },
    traceAbove(messageId: string | undefined, labels: TraceLabels): TraceSpan[] {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const turn = turnId === undefined ? undefined : turnBounds(turnId);
      if (!turnId || !turn) return [];
      const { sent, replies } = sources();
      const { timed, stored, ran, answerAt, turnStart, turnEnd } = turn;
      const spans: TraceSpan[] = [
        {
          id: "turn",
          parentId: null,
          name: labels.agent,
          kind: "model",
          icon: "agent",
          start: turnStart,
          end: turnEnd,
          ...(stored?.tokens === undefined
            ? {}
            : {
                tokens: analyticsTokens({ processedTokens: stored.tokens, cachedInput: stored.cachedInput ?? null }),
                ...(stored.cachedInput === undefined ? {} : { cachedInput: stored.cachedInput }),
              }),
          ...(typeof stored?.costUsd === "number" ? { costUsd: stored.costUsd } : {}),
        },
      ];
      const titles = new Map(ran.map(({ subagent }) => [subagent.id, subagent.title]));
      if (stored) spans.push(...storedSpans(stored, timed, turnEnd, titles, labels));
      else spans.push(...guessedSpans(timed, Number.isFinite(answerAt) ? answerAt : turnEnd, labels));
      for (const { subagent, start, end } of ran) {
        if (!Number.isFinite(start)) continue;
        const running = subagent.status === "running" && !stored;
        spans.push({
          id: `${SUBAGENT_SPAN_PREFIX}${subagent.id}`,
          parentId: "turn",
          name: subagent.title,
          ...(subagent.agentType ? { detail: subagent.agentType } : {}),
          kind: "model",
          icon: "agent",
          failed: subagent.status === "failed",
          start,
          end: end !== null && Number.isFinite(end) ? end : running ? null : turnEnd,
        });
      }
      for (const message of sent.get(turnId) ?? []) {
        const asked = Date.parse(message.createdAt ?? "");
        if (!message.exchange || !Number.isFinite(asked)) continue;
        for (const reply of replies.get(message.exchange.messageId) ?? []) {
          const answered = Date.parse(reply.createdAt ?? "");
          if (!reply.exchange || !Number.isFinite(answered)) continue;
          spans.push({
            id: `${REPLY_SPAN_PREFIX}${reply.id}`,
            parentId: "turn",
            name: labels.agentNames([reply.exchange.senderAgentId]),
            detail: labels.reply,
            kind: "waiting",
            icon: "agent",
            start: Math.min(asked, answered, turnEnd),
            end: Math.min(answered, turnEnd),
          });
        }
      }
      return spans;
    },
    stepsOfTurn(turnId: string | undefined): AgentStep[] {
      return stepsOf(turnId);
    },
  };
}
