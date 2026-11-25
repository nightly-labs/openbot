import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString } from "../ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_PROMPT_DETAIL_CAPABILITY = "prompt-detail-v1";

const MAXIMUM_DEPTH = 12;

type QuestionVisitor = (key: string, question: DynamicRecord) => void;

function isPromptQuestionDetail(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.promptQuestion) && value.length > 0;
}

function visitQuestions(prefix: readonly unknown[], questions: unknown, visit: QuestionVisitor): void {
  if (!Array.isArray(questions)) return;
  for (const question of questions) {
    if (isDynamicRecord(question) && isString(question.id)) visit(JSON.stringify([...prefix, question.id]), question);
  }
}

function promptPrefix(prompt: DynamicRecord): readonly unknown[] | undefined {
  if (!isString(prompt.requestId) && !isNumber(prompt.requestId)) return undefined;
  const agentId = isString(prompt.agentId) ? prompt.agentId : isString(prompt.botId) ? prompt.botId : null;
  return ["prompt", agentId, prompt.threadId ?? null, prompt.turnId ?? null, prompt.requestId];
}

function eachQuestion(value: unknown, visit: QuestionVisitor, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) eachQuestion(item, visit, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const messagePrompt = isString(value.id) && isDynamicRecord(value.questionPrompt) ? value.questionPrompt : null;
  if (messagePrompt) visitQuestions(["message", value.id], messagePrompt.questions, visit);
  else {
    const prefix = Array.isArray(value.questions) ? promptPrefix(value) : undefined;
    if (prefix) visitQuestions(prefix, value.questions, visit);
  }
  for (const child of Object.values(value)) {
    if (child !== messagePrompt) eachQuestion(child, visit, depth + 1);
  }
}

function collect(source: unknown): Map<string, string> {
  const details = new Map<string, string>();
  eachQuestion(
    source,
    (key, question) => {
      if (isPromptQuestionDetail(question.detail)) details.set(key, question.detail);
    },
    0,
  );
  return details;
}

function apply(target: unknown, details: ReadonlyMap<string, string>): void {
  eachQuestion(
    target,
    (key, question) => {
      const detail = details.get(key);
      if (detail !== undefined) Object.assign(question, { detail });
    },
    0,
  );
}

export function addPromptQuestionDetails(target: unknown, source: unknown): void {
  const details = collect(source);
  if (details.size > 0) apply(target, details);
}

export function withPromptQuestionDetails(encoded: string, source: unknown): string {
  const details = collect(source);
  if (details.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, details);
  return JSON.stringify(value);
}
