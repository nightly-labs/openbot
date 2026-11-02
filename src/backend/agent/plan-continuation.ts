import type { ConversationPlan, ConversationPlanStep } from "@openbot/contracts/ipc";
import { nextStepContinuationPrompt, planContinuationPrompt } from "./delivery-content";

export interface PlanContinuationOptions {
  /** The most automatic continuations of one request. */
  limit: number;
}

/** Why a turn continues: open steps in its plan, or a next step that it named but did not do. */
type ContinuationKind = "plan" | "nextStep";

/** The most next-step continuations of one request. Each one has no plan to measure progress. */
const NEXT_STEP_LIMIT = 2;
/** A longer answer is a report, not a turn that stopped before the step it named. */
const NEXT_STEP_ANSWER_MAX = 400;
/** Verbs that mean "go on with the same work". "Proceed" and "go ahead" ask for approval, so they block. */
const CONTINUE_VERB = "(?:continue|keep going|go on|carry on|move on)";
const REST_OF_WORK = String.raw`(?:\s+(?:with|to|on)\s+(?:the\s+)?(?:next(?:\s+(?:steps?|ones?|parts?|phases?|items?))?|rest(?:\s+of\s+(?:it|them|the\s+(?:steps|work|plan|list)))?|remaining(?:\s+(?:steps|work|items|parts|ones))?|steps?\s+\d+))?`;
/**
 * A last line that only asks whether to go on with the work, such as "Shall I continue?" or "Step
 * one is done. Want me to continue with the next step?". Text in front of the question must end a
 * statement, so another question in the line still blocks. A question about a named action, such as
 * "Should I continue with the deploy?" or "Proceed?", does not match: the user must answer it.
 */
const ASKS_TO_CONTINUE = new RegExp(
  String.raw`^(?:[^?？]*[.!]\s+)?(?:(?:(?:shall|should|can|may)\s+i|(?:do\s+you\s+)?want\s+me\s+to|would\s+you\s+like\s+me\s+to|ok(?:ay)?\s+(?:if\s+i|to))\s+)?${CONTINUE_VERB}${REST_OF_WORK}\s*\?+$`,
  "i",
);
/**
 * A short answer whose last words name the agent's next step, such as "I'll now run the tests." An
 * answer that says the agent waits, holds or stops does not match.
 */
const NAMES_NEXT_STEP =
  /(?:\blet me now\b|\bnow let me\b|\bi['\u2019]ll now\b|\bi will now\b|\bnow i(?:['\u2019]ll| will)\b|\bnext,?\s+i(?:['\u2019]ll| will)\b)(?!\s+(?:wait|hold|pause|stop)\b)[^.!?\n]{0,100}[.:\u2026]?\s*$/i;

/** The last line of an answer, without Markdown emphasis, code, quote or heading marks. */
function lastLine(answer: string | undefined): string {
  return (answer?.trimEnd().split("\n").at(-1) ?? "").replace(/[*_`>#]/g, "").trim();
}

function asksToContinue(answer: string | undefined): boolean {
  return ASKS_TO_CONTINUE.test(lastLine(answer));
}

/**
 * Whether the answer asks the user a question in its last line, so the turn waits for an answer.
 * A question anywhere in the line counts, so Markdown or a closing remark after it does not hide it.
 * A question that only asks whether to continue does not count: the work continues by itself.
 */
export function asksUserQuestion(answer: string | undefined): boolean {
  const line = lastLine(answer);
  return /[?？]/.test(line) && !ASKS_TO_CONTINUE.test(line);
}

/** Whether a turn stopped before the next step: it named the step, or asked whether to continue. */
function stoppedBeforeNextStep(answer: string | undefined): boolean {
  if (asksToContinue(answer)) return true;
  const text = answer?.trim() ?? "";
  return text.length > 0 && text.length <= NEXT_STEP_ANSWER_MAX && NAMES_NEXT_STEP.test(text.slice(-160));
}

interface Chain {
  deliveryIds: ReadonlySet<string>;
  count: number;
  kind: ContinuationKind;
  /** The next-step continuations of the chain. */
  nextSteps: number;
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
   * turn of a request reads it. Returns the number and the kind of this continuation, or null; null
   * also ends the chain.
   */
  consider(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
    /** The answer of that turn. */
    answer: string | undefined;
  }): { count: number; kind: ContinuationKind } | null {
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
      if (chained && previous.kind === "plan" && previous.openSteps === signature) return null;
      kind = "plan";
    } else if (nextSteps < NEXT_STEP_LIMIT && stoppedBeforeNextStep(input.answer)) kind = "nextStep";
    else return null;
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      kind,
      nextSteps: kind === "nextStep" ? nextSteps + 1 : nextSteps,
      plan,
      openSteps: JSON.stringify(open.map(stepKey)),
      earlierSteps,
    });
    return { count: count + 1, kind };
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
    return chain.kind === "plan" && chain.plan
      ? planContinuationPrompt(openSteps(chain.plan, chain.earlierSteps), chain.count, this.#limit)
      : nextStepContinuationPrompt(chain.count, this.#limit);
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
