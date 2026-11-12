import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString } from "../ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeTeamProtocolV2Json } from "./v2";

/**
 * Frozen optional prompt-detail-v1 contract: the `detail` text under an agent question
 * (`AgentPromptQuestion.detail`). It adds `detail` beside the frozen keys of a question in each
 * question list that has a `requestId`:
 *
 * - the `questionPrompt` of each message in conversation responses, pages and events;
 * - the `prompt` event;
 * - each `pendingPrompts` item of the `runtime-snapshot` event.
 *
 * The host adds it after the frozen projection, only for a client that advertises this capability. A
 * question gets the detail of the source question with the same agent (when the prompt names one),
 * `requestId`, question `id` and question text. The frozen codecs leave it out in both directions, so a client copies it back from
 * the wire value after it decodes. A detail is a nonempty string of at most
 * `INPUT_LIMITS.promptQuestion` characters: the host leaves out any other value, and a client fails
 * closed on one. A protocol 9 capability only. Widening any of it needs a second capability string.
 */
export const TEAM_PROMPT_DETAIL_CAPABILITY = "prompt-detail-v1";

/** Deeper than any conversation snapshot, page or event of the Team API. */
const MAXIMUM_DEPTH = 12;

/**
 * A question in one prompt. Request ids of different agents can be equal, so the key has the agent of
 * the prompt when the prompt names it: `agentId` on this side of the codec, `botId` on the wire.
 */
function questionKey(prompt: DynamicRecord, question: DynamicRecord): string | undefined {
  const agentId = isString(prompt.agentId) ? prompt.agentId : isString(prompt.botId) ? prompt.botId : null;
  return isString(question.id) && isString(question.question)
    ? JSON.stringify([agentId, prompt.requestId, question.id, question.question])
    : undefined;
}

/** Calls `visit` with each question of each prompt in `value`: a record with a `requestId` and `questions`. */
function eachQuestion(
  value: unknown,
  visit: (prompt: DynamicRecord, question: DynamicRecord) => void,
  depth: number,
): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) eachQuestion(item, visit, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  if ((isString(value.requestId) || isNumber(value.requestId)) && Array.isArray(value.questions)) {
    for (const question of value.questions) if (isDynamicRecord(question)) visit(value, question);
  }
  for (const child of Object.values(value)) eachQuestion(child, visit, depth + 1);
}

function isPromptQuestionDetail(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.promptQuestion) && value.length > 0;
}

/** Calls `visit` with the question key and the present `detail` of each question in `source`. */
function eachDetail(source: unknown, visit: (key: string, detail: unknown) => void): void {
  eachQuestion(
    source,
    (prompt, question) => {
      const key = questionKey(prompt, question);
      if (key !== undefined && question.detail !== undefined) visit(key, question.detail);
    },
    0,
  );
}

/** The details of `source` that the contract permits. The host leaves out each other value. */
function permittedDetails(source: unknown): Map<string, string> {
  const details = new Map<string, string>();
  eachDetail(source, (key, detail) => {
    if (isPromptQuestionDetail(detail)) details.set(key, detail);
  });
  return details;
}

function apply(target: unknown, details: ReadonlyMap<string, string>): void {
  eachQuestion(
    target,
    (prompt, question) => {
      const key = questionKey(prompt, question);
      const detail = key === undefined ? undefined : details.get(key);
      if (detail !== undefined) Object.assign(question, { detail });
    },
    0,
  );
}

/**
 * Host side: sets `detail` on each question in `target` from the same question (see `questionKey`) in
 * `source`, the value before the protocol adapter projected it. `target` is a fresh encoder
 * result that its caller owns: it changes in place. A question that `target` does not send stays out.
 */
export function addPromptQuestionDetails(target: unknown, source: unknown): void {
  const details = permittedDetails(source);
  if (details.size > 0) apply(target, details);
}

/**
 * Host side: `encoded`, a Team API body or event as JSON text, with the question details of `source`,
 * the value before the protocol adapter projected it. Text without a question to change comes back
 * unchanged.
 */
export function withPromptQuestionDetails(encoded: string, source: unknown): string {
  const details = permittedDetails(source);
  if (details.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, details);
  return JSON.stringify(value);
}

/**
 * Client side: sets `detail` on each question of `decoded`, a fresh decoder result, from the same
 * question (see `questionKey`) in `wire`, the value that the host sent. It throws on a present detail
 * of a question that `decoded` has when the contract refuses the detail, so that the caller fails closed
 * with `protocol_error`. A wire question that the frozen codec dropped does not count.
 */
export function restorePromptQuestionDetails(decoded: unknown, wire: unknown): void {
  const kept = new Set<string>();
  eachQuestion(
    decoded,
    (prompt, question) => {
      const key = questionKey(prompt, question);
      if (key !== undefined) kept.add(key);
    },
    0,
  );
  if (kept.size === 0) return;
  const details = new Map<string, string>();
  // Each copy counts: a message can be in `messages` and in `references`.
  eachDetail(wire, (key, detail) => {
    if (!kept.has(key)) return;
    if (!isPromptQuestionDetail(detail)) throw new Error("Invalid prompt question detail.");
    details.set(key, detail);
  });
  if (details.size > 0) apply(decoded, details);
}
