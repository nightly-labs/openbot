import type { ConversationMessage, ConversationPlan, ConversationTraceStep } from "@openbot/contracts/ipc";
import { Schema } from "effect";

/**
 * The finish check: when a turn of the user's request ends and no other rule continues it, a short
 * call to the agent's own model, with no tools, reads the request and the turn and says whether the
 * request is done. It is the host's own check of each round, as in Grok's goal mode, so that the
 * user does not have to write "continue" when the agent stopped after a part of the work.
 * The verdict only starts a continuation; it never approves an action.
 */

/** The longest wait for a finish check. A check that takes longer does not continue the request. */
export const FINISH_CHECK_DEADLINE_MS = 30_000;

/** The text in the provider input that marks a finish check, for logs and test fakes. */
export const FINISH_CHECK_MARKER = "OpenBot finish check";

const REQUEST_CHARACTERS = 2_000;
const CONTEXT_MESSAGES = 6;
const CONTEXT_CHARACTERS = 600;
const ANSWER_CHARACTERS = 4_000;
const STEP_LINES = 40;
const STEP_CHARACTERS = 160;
/** The most characters of the missing work that goes to the agent in its note. */
const MISSING_CHARACTERS = 600;

/**
 * The model's answer. `done` and `user` and `blocked` end the request; only `continue` with a named
 * gap continues it. An answer that does not decode ends the request too.
 */
export const FinishCheckResult = Schema.Struct({
  verdict: Schema.Literals(["done", "continue", "user", "blocked"]),
  missing: Schema.optional(Schema.NullOr(Schema.String)),
});
export type FinishCheckResult = typeof FinishCheckResult.Type;

export interface FinishCheckInput {
  /** The messages of the request: what the user asked in this chain of turns, oldest first. */
  request: readonly string[];
  /** The chat messages before the request, oldest first, for a request such as "do it then". */
  context: readonly Pick<ConversationMessage, "author" | "text">[];
  /** The tool steps of the turn that just ended. */
  steps: readonly ConversationTraceStep[];
  plan: ConversationPlan | null;
  answer: string;
  /** The automatic continuations that the request had before this turn ended. */
  continuations: number;
}

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}… [${text.length - limit} more characters]`;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function stepLine(step: ConversationTraceStep): string {
  const what = oneLine(step.command ?? step.text ?? "tool");
  const outcome = step.failed ? ` (failed${step.error ? `: ${oneLine(step.error)}` : ""})` : "";
  return `- ${clip(what, STEP_CHARACTERS)}${clip(outcome, STEP_CHARACTERS)}`;
}

/**
 * The prompt of one finish check. Every text in `input` must already have its secrets removed: the
 * call goes to the agent's provider, as the turn did.
 */
export function finishCheckPrompt(input: FinishCheckInput): string {
  const tools = input.steps.filter((step) => step.kind === "tool");
  const shownTools = tools.slice(-STEP_LINES);
  const plan = input.plan?.steps.map((step) => `- [${step.status}] ${oneLine(step.text)}`) ?? [];
  return [
    `${FINISH_CHECK_MARKER}. You check whether an AI agent finished the user's request. You do not do the work, and you do not talk to the user. Answer with one JSON object only.`,
    "",
    "The user's request, oldest message first:",
    "<request>",
    ...input.request.map((text) => clip(text.trim(), REQUEST_CHARACTERS)),
    "</request>",
    ...(input.context.length > 0
      ? [
          "",
          "The chat before the request, only to understand it:",
          "<context>",
          ...input.context
            .slice(-CONTEXT_MESSAGES)
            .map((message) => `${message.author}: ${clip(oneLine(message.text), CONTEXT_CHARACTERS)}`),
          "</context>",
        ]
      : []),
    "",
    tools.length === 0
      ? "The agent used no tools in its last turn."
      : `The tool steps of the agent's last turn (${tools.length}${tools.length > shownTools.length ? `, the last ${shownTools.length} shown` : ""}):`,
    ...shownTools.map(stepLine),
    ...(plan.length > 0 ? ["", "The agent's plan:", ...plan] : []),
    "",
    "The agent's last answer to the user:",
    "<answer>",
    clip(input.answer.trim(), ANSWER_CHARACTERS),
    "</answer>",
    "",
    `The request continued automatically ${input.continuations} times before this turn.`,
    "",
    "Choose one verdict:",
    '- "done": the answer completes the whole request, or it says truthfully which part cannot be done and why. A question, a chat message, or a request for an opinion is done when it is answered.',
    '- "continue": a part of the request is not done and the agent can do it now without the user. For example: it did only some of the items; it says what it will do next and stops; it offers to do work that the request already asked for; it says done but did not check a result that it can check, such as a test, a build, a page or a file it changed; a step failed and it did not try another way.',
    '- "user": the agent needs something that only the user can give: a choice that changes the result, missing information, a sign-in, a payment, or approval of an action that sends, posts, publishes, buys, deletes, or changes something outside the agent\'s own work. A question of this kind in the answer is "user".',
    '- "blocked": the agent tried the other ways that it has, and it cannot go on for a reason that the user must fix. One failed step with no other try is "continue", not "blocked".',
    'Do not ask for more than the request asked for. Do not choose "continue" for extra polish, a nice-to-have, or a risky action. When you are not sure, choose "done".',
    "",
    'JSON shape: {"verdict":"done"|"continue"|"user"|"blocked","missing":"for continue only: what is not done, as at most 3 short instructions to the agent"}',
  ].join("\n");
}

/** The gap to send to the agent, or null when the verdict does not continue the request. */
export function finishCheckGap(result: FinishCheckResult): string | null {
  if (result.verdict !== "continue") return null;
  const missing = result.missing?.trim();
  return missing ? clip(missing, MISSING_CHARACTERS) : null;
}
