import type { ConversationPlan, ConversationPlanStep } from "@openbot/contracts/ipc";
import { compactionContinuationPrompt, nextStepContinuationPrompt, planContinuationPrompt } from "./delivery-content";

export interface PlanContinuationOptions {
  /** The most automatic continuations of one request. */
  limit: number;
}

/**
 * Why a turn continues: open steps in its plan, a next step that it named but did not do, or a
 * compaction that lost the connection and stopped the turn.
 */
type ContinuationKind = "plan" | "nextStep" | "compaction";

/** The most next-step continuations of one request. Each one has no plan to measure progress. */
const NEXT_STEP_LIMIT = 2;
/** A longer answer is a report, not a turn that stopped before the step it named. */
const NEXT_STEP_ANSWER_MAX = 400;
/** Verbs that mean "go on with the same work". "Proceed" and "go ahead" ask for approval, so they block. */
const CONTINUE_VERB = "(?:continue|keep going|go on|carry on|move on)";
/** Parts of the same work. A named action, such as "the rest of the deploy", is not in it, so it blocks. */
const WORK_PARTS =
  "(?:steps|work|items|parts|ones|tasks|files|tests|changes|fixes|edits|checks|pages|sections|list|plan)";
const REST_OF_WORK = String.raw`(?:\s+(?:with|to|on)\s+(?:the\s+)?(?:next(?:\s+(?:steps?|ones?|parts?|phases?|items?))?|rest(?:\s+of\s+(?:it|them|the\s+${WORK_PARTS}))?|remaining(?:\s+${WORK_PARTS})?|steps?\s+\d+))?`;
/**
 * A last line that only asks whether to go on with the work, such as "Shall I continue?" or "Step
 * one is done. Want me to continue with the remaining files?". Text in front of the question must end a
 * statement, so another question in the line still blocks. A question about a named action, such as
 * "Should I continue with the deploy?" or "Proceed?", does not match: the user must answer it.
 */
const ASKS_TO_CONTINUE = new RegExp(
  String.raw`^(?:[^?？]*[.!]\s+)?(?:(?:(?:shall|should|can|may)\s+i|(?:do\s+you\s+)?want\s+me\s+to|would\s+you\s+like\s+me\s+to|ok(?:ay)?\s+(?:if\s+i|to))\s+)?${CONTINUE_VERB}${REST_OF_WORK}\s*\?+$`,
  "i",
);
/** A character inside a sentence. A period inside a word, as in "parser.ts" or "v1.2", does not end it. */
const SENTENCE_CHAR = String.raw`(?:[^.!?\n]|\.(?=\S))`;
/**
 * The rest of a next-step sentence must not wait for someone or something: an offer to the user
 * ("… if you want"), the user's approval, a later time, or another person ("… get back to you").
 */
const NOT_WAITING = String.raw`(?!${SENTENCE_CHAR}*\b(?:(?:if|when|once|after|unless|until|as\s+soon\s+as)\s+(?:you|your)|get\s+back|once\s+approved|(?:your|the\s+user['’]s)\s+(?:approval|confirmation|permission)|later|tomorrow|next\s+(?:week|month|time)|back\s+in)\b)`;
/**
 * A short answer whose last words name the agent's next step, such as "I'll now run the tests." An
 * answer that says the agent waits, holds or stops does not match.
 */
const NAMES_NEXT_STEP = new RegExp(
  String.raw`(?:\blet me now\b|\bnow let me\b|\bi['’]ll now\b|\bi will now\b|\bnow i(?:['’]ll| will)\b|\bnext,?\s+i(?:['’]ll| will)\b)(?!\s+(?:wait|hold|pause|stop)\b)${NOT_WAITING}[^.!?\n]{0,100}[.:…]?\s*$`,
  "i",
);

/**
 * Work verbs that a stopped turn names for its next step. Verbs such as deploy or delete are not in it.
 * The continuation note does not approve a risky action in any case.
 */
const WORK_VERB = String.raw`(?:run|re-?run|check|test|fix|update|edit|write|create|add|build|install|open|read|look|search|inspect|review|verify|start|try|apply|implement|rename|move|refactor|debug|finish|continue|configure|set\s+up|generate|download|compile|patch)`;
/**
 * A last sentence in which the agent says that it does the next work, such as "Let me run the tests."
 * or "I'm going to fix the parser.". It must name a work verb, so "Let me know …", "I'll keep an eye on
 * it." and "I'll update you …" do not match.
 */
const ANNOUNCES_WORK = new RegExp(
  String.raw`(?:^|[.!:…–—]\s+|\s-\s+|\n\s*)(?:(?:ok(?:ay)?|now|next|first|then|so)[,:]?\s+)*(?:let\s+me|i['’]ll|i\s+will|i['’]m\s+going\s+to|i\s+am\s+going\s+to)\s+(?:(?:now|first|next|then|also|quickly)\s+)?${WORK_VERB}\b(?!\s+you\b)${NOT_WAITING}${SENTENCE_CHAR}{0,120}[.:…]?\s*$`,
  "i",
);

/** A last line that says the agent waits for the user, such as "I'll now wait for your approval." */
const WAITS_FOR_USER =
  /\b(?:i['\u2019]ll|i will|i['\u2019]m going to|let me)\s+(?:now\s+)?(?:wait|hold|pause|stop)\b|\bwaiting\s+(?:for|on)\s+(?:you|your)\b/i;

/** The last line of an answer, without Markdown emphasis, code, quote or heading marks. */
function lastLine(answer: string | undefined): string {
  return (answer?.trimEnd().split("\n").at(-1) ?? "").replace(/[*_`>#]/g, "").trim();
}

function asksToContinue(answer: string | undefined): boolean {
  return ASKS_TO_CONTINUE.test(lastLine(answer));
}

/**
 * Whether the last line of the answer waits for the user: it asks a question, or says that the agent
 * waits. A question anywhere in the line counts, so Markdown or a closing remark after it does not
 * hide it. A question that only asks whether to continue does not count: the work continues by itself.
 */
export function waitsForUser(answer: string | undefined): boolean {
  const line = lastLine(answer);
  return (/[?？]/.test(line) && !ASKS_TO_CONTINUE.test(line)) || WAITS_FOR_USER.test(line);
}

/** Whether a turn stopped before the next step: it named the step, or asked whether to continue. */
function stoppedBeforeNextStep(answer: string | undefined): boolean {
  if (asksToContinue(answer)) return true;
  const text = answer?.trim() ?? "";
  if (text.length === 0 || text.length > NEXT_STEP_ANSWER_MAX) return false;
  return NAMES_NEXT_STEP.test(text.slice(-160)) || ANNOUNCES_WORK.test(text.replace(/[*_`>#]/g, "").trimEnd());
}

interface ContinuationCount {
  current: number;
  limit: number;
}

interface Chain {
  deliveryIds: ReadonlySet<string>;
  count: number;
  kind: ContinuationKind;
  /** The number and the limit that the chat line and the note show for the last continuation. */
  shown: ContinuationCount;
  /** The next-step continuations of the chain. */
  nextSteps: number;
  /** Whether a failed compaction continued the chain already. A second one ends it. */
  compactionContinued: boolean;
  /** The plan of the last turn of the chain. A turn that sends no plan update keeps it. */
  plan: ConversationPlan | null;
  /** The open steps of that plan, by text and status, to see whether a turn made progress. */
  openSteps: string;
  /** The open steps of the chat's plan before the request, by text and status. */
  earlierSteps: ReadonlySet<string>;
}

function laneKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}\u0000${taskId}`;
}

const stepKey = (step: ConversationPlanStep) => JSON.stringify([step.text, step.status]);

function openSteps(plan: ConversationPlan, earlierSteps: ReadonlySet<string>): ConversationPlanStep[] {
  return plan.steps.filter((step) => step.status !== "completed" && !earlierSteps.has(stepKey(step)));
}

/**
 * Owns the in-memory chains of automatic plan continuations: for each lane (the agent's own chat or
 * one task), the deliveries of the request, the count, and the plan of the last turn. A turn that
 * ends with open steps in the agent's own plan runs once more with a short note, until the plan is
 * done, the limit is reached, or a turn makes no progress. A step that was open, with the same text
 * and status, in the plan from before the request is left from earlier work and does not count.
 * A turn with no open step also continues, at most `NEXT_STEP_LIMIT` times, when its answer only asks
 * whether to continue, or is short and ends on a next step that it did not do. A restart forgets every
 * chain, and the drain then settles the waiting deliveries. It never imports the mailbox or the
 * service facade.
 */
export class PlanContinuation {
  readonly #limit: number;
  readonly #chains = new Map<string, Chain>();

  constructor(options: PlanContinuationOptions) {
    this.#limit = options.limit;
  }

  get limit(): number {
    return this.#limit;
  }

  /**
   * Decides whether the turn that just ended continues. `plan` is the plan of that turn, or null when
   * the turn sent none. `earlierPlan` is the chat's last plan from before that turn; only the first
   * turn of a request reads it. Returns the kind of this continuation, with its number and limit, or
   * null; null also ends the chain. A next-step continuation counts against `NEXT_STEP_LIMIT`.
   */
  consider(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
    /** The answer of that turn. */
    answer: string | undefined;
  }): ({ kind: ContinuationKind } & ContinuationCount) | null {
    const key = laneKey(input.agentId, input.taskId);
    const previous = this.#chains.get(key);
    this.#chains.delete(key);
    const chained =
      previous !== undefined &&
      input.deliveryIds.length > 0 &&
      // A message steered into a continuation turn joins the request, so the chain keeps its count.
      input.deliveryIds.some((deliveryId) => previous.deliveryIds.has(deliveryId));
    const plan = input.plan ?? (chained ? previous.plan : null);
    const earlierSteps = chained
      ? previous.earlierSteps
      : new Set(
          (input.earlierPlan?.steps ?? []).filter((step) => step.status !== "completed").map((step) => stepKey(step)),
        );
    const count = chained ? previous.count : 0;
    if (count >= this.#limit) return null;
    const open = plan ? openSteps(plan, earlierSteps) : [];
    const nextSteps = chained ? previous.nextSteps : 0;
    let kind: ContinuationKind;
    if (open.length > 0) {
      const signature = JSON.stringify(open.map(stepKey));
      // A continuation after a failed compaction keeps the plan of the turn before it.
      if (chained && previous.kind !== "nextStep" && previous.openSteps === signature) return null;
      kind = "plan";
    } else if (nextSteps < NEXT_STEP_LIMIT && stoppedBeforeNextStep(input.answer)) kind = "nextStep";
    else return null;
    const shown =
      kind === "plan"
        ? { current: count + 1, limit: this.#limit }
        : { current: nextSteps + 1, limit: nextSteps + Math.min(NEXT_STEP_LIMIT - nextSteps, this.#limit - count) };
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      kind,
      shown,
      nextSteps: kind === "nextStep" ? nextSteps + 1 : nextSteps,
      compactionContinued: chained ? previous.compactionContinued : false,
      plan,
      openSteps: JSON.stringify(open.map(stepKey)),
      earlierSteps,
    });
    return { kind, ...shown };
  }

  /**
   * Decides whether a turn that a failed compaction stopped continues: the connection failed or
   * stopped while the provider compacted the context of the turn (#5822). Once for each request, and
   * within the limit of the chain. Returns null when it does not continue; null also ends the chain.
   * `plan` and `earlierPlan` are as in `consider`, so a later plan continuation compares the same steps.
   */
  afterFailedCompaction(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
  }): ({ kind: ContinuationKind } & ContinuationCount) | null {
    const key = laneKey(input.agentId, input.taskId);
    const previous = this.#chains.get(key);
    this.#chains.delete(key);
    const chained =
      previous !== undefined && input.deliveryIds.some((deliveryId) => previous.deliveryIds.has(deliveryId));
    const count = chained ? previous.count : 0;
    if (count >= this.#limit || (chained && previous.compactionContinued)) return null;
    const plan = input.plan ?? (chained ? previous.plan : null);
    const earlierSteps = chained
      ? previous.earlierSteps
      : new Set(
          (input.earlierPlan?.steps ?? []).filter((step) => step.status !== "completed").map((step) => stepKey(step)),
        );
    const shown = { current: 1, limit: 1 };
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      kind: "compaction",
      shown,
      nextSteps: chained ? previous.nextSteps : 0,
      compactionContinued: true,
      plan,
      openSteps: JSON.stringify((plan ? openSteps(plan, earlierSteps) : []).map(stepKey)),
      earlierSteps,
    });
    return { kind: "compaction", ...shown };
  }

  /**
   * The note that starts the continuation of this delivery, or null when no chain waits for it:
   * after a restart, a Stop, a new chat, or when other messages wait in the lane (`othersQueued`).
   * A start that goes back to the queue, as during a compaction, claims the same note again.
   */
  claim(agentId: string, taskId: string | null, deliveryId: string, othersQueued: boolean): string | null {
    const key = laneKey(agentId, taskId);
    const chain = this.#chains.get(key);
    if (!chain?.deliveryIds.has(deliveryId) || othersQueued) {
      this.#chains.delete(key);
      return null;
    }
    if (chain.kind === "compaction") return compactionContinuationPrompt();
    return chain.kind === "plan" && chain.plan
      ? planContinuationPrompt(openSteps(chain.plan, chain.earlierSteps), chain.shown.current, chain.shown.limit)
      : nextStepContinuationPrompt(chain.shown.current, chain.shown.limit);
  }

  /** Ends the chain of one lane, or of every lane of the agent when `taskId` is undefined. */
  cancel(agentId: string, taskId?: string | null): void {
    if (taskId !== undefined) {
      this.#chains.delete(laneKey(agentId, taskId));
      return;
    }
    for (const key of [...this.#chains.keys()])
      if (key === agentId || key.startsWith(`${agentId}\u0000`)) this.#chains.delete(key);
  }

  dispose(): void {
    this.#chains.clear();
  }
}
