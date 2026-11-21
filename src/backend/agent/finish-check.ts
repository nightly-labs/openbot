import type { ConversationMessage, ConversationPlan, ConversationTraceStep } from "@openbot/contracts/ipc";
import { Schema } from "effect";

export const FINISH_CHECK_DEADLINE_MS = 30_000;

const FINISH_CHECK_MARKER = "OpenBot finish check";

export const FINISH_CHECK_ABORT_POLL = "250 millis";

export const FINISH_CHECK_CONTEXT_MESSAGES = 6;

const REQUEST_CHARACTERS = 2_000;
const CONTEXT_CHARACTERS = 600;
const ANSWER_CHARACTERS = 4_000;
const STEP_LINES = 40;
const STEP_CHARACTERS = 160;
const RESULT_CHARACTERS = 240;
const MISSING_CHARACTERS = 600;

export const FinishCheckResult = Schema.Struct({
  verdict: Schema.Literals(["done", "continue", "user", "blocked"]),
  missing: Schema.optional(Schema.NullOr(Schema.String)),
});
export type FinishCheckResult = typeof FinishCheckResult.Type;

export interface FinishCheckStep extends ConversationTraceStep {
  tool?: string | undefined;
  result?: string | undefined;
}

export interface FinishCheckInput {
  request: readonly string[];
  context: readonly Pick<ConversationMessage, "author" | "text">[];
  steps: readonly FinishCheckStep[];
  plan: ConversationPlan | null;
  answer: string;
  continuations: number;
}

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}… [${text.length - limit} more characters]`;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function stepLine(step: FinishCheckStep): string {
  const named = [step.tool, step.command].filter((part) => part !== undefined && part.trim() !== "").join(": ");
  const what = oneLine(named || (step.text ?? "tool"));
  const outcome = step.failed
    ? ` (failed${step.error ? `: ${oneLine(step.error)}` : ""})`
    : step.result
      ? ` → ${oneLine(step.result)}`
      : "";
  return `- ${clip(what, STEP_CHARACTERS)}${clip(outcome, RESULT_CHARACTERS)}`;
}

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
            .slice(-FINISH_CHECK_CONTEXT_MESSAGES)
            .map((message) => `${message.author}: ${clip(oneLine(message.text), CONTEXT_CHARACTERS)}`),
          "</context>",
        ]
      : []),
    "",
    tools.length === 0
      ? "The agent used no tools in its last turn."
      : `The tool steps of the agent's last turn (${tools.length}${tools.length > shownTools.length ? `, the last ${shownTools.length} shown` : ""}), each with the start of its result after "→" when there is one. Use them as evidence of what the agent did:`,
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

export function finishCheckGap(result: FinishCheckResult): string | null {
  if (result.verdict !== "continue") return null;
  const missing = result.missing?.trim();
  return missing ? clip(missing, MISSING_CHARACTERS) : null;
}
