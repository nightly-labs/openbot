import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const CONVERSATION_TRACE_STEP_KINDS = ["reasoning", "tool", "message"] as const;
export type ConversationTraceStepKind = (typeof CONVERSATION_TRACE_STEP_KINDS)[number];

export interface ConversationTraceStep {
  id: string;
  kind: ConversationTraceStepKind;
  text?: string | undefined;
  command?: string | undefined;
  recipientAgentIds?: string[] | undefined;
  startedAt: string;
  endedAt: string | null;
  failed?: true | undefined;
  error?: string | undefined;
}

export interface ConversationTurnTrace {
  startedAt: string;
  endedAt: string | null;
  steps: ConversationTraceStep[];
  tokens?: number | undefined;
  costUsd?: number | null | undefined;
}

export const CONVERSATION_TRACE_STEP_LIMIT = 500;
export const CONVERSATION_TRACE_TEXT_LIMIT = 500;
const TIME_LIMIT = 160;

export function isConversationTurnTrace(value: unknown): value is ConversationTurnTrace {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.startedAt, TIME_LIMIT) &&
    isNullableBoundedString(value.endedAt, TIME_LIMIT) &&
    Array.isArray(value.steps) &&
    value.steps.length <= CONVERSATION_TRACE_STEP_LIMIT &&
    value.steps.every(isConversationTraceStep) &&
    (value.tokens === undefined || isCount(value.tokens)) &&
    (value.costUsd === undefined || value.costUsd === null || isCost(value.costUsd))
  );
}

function isConversationTraceStep(value: unknown): value is ConversationTraceStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(CONVERSATION_TRACE_STEP_KINDS, value.kind) &&
    (value.text === undefined || isBoundedString(value.text, CONVERSATION_TRACE_TEXT_LIMIT)) &&
    (value.command === undefined || isBoundedString(value.command, CONVERSATION_TRACE_TEXT_LIMIT)) &&
    (value.error === undefined || isBoundedString(value.error, CONVERSATION_TRACE_TEXT_LIMIT)) &&
    (value.recipientAgentIds === undefined ||
      (Array.isArray(value.recipientAgentIds) &&
        value.recipientAgentIds.length <= INPUT_LIMITS.messageRecipients &&
        value.recipientAgentIds.every(isIdentifier))) &&
    isBoundedString(value.startedAt, TIME_LIMIT) &&
    isNullableBoundedString(value.endedAt, TIME_LIMIT) &&
    (value.failed === undefined || value.failed === true)
  );
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isCost(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}
