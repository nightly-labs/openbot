import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AgentWait, AgentWaitsSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import type { MailboxStore } from "../mailbox-store";
import type { DynamicToolCallParams } from "../protocol";
import { AgentWaitError, AgentWaitLimitError, type AgentWaitStore } from "./agent-wait-store";

export const AWAIT_EVENT_TOOL = "await_event";
export const CLOSE_WAIT_TOOL = "close_wait";
export const LIST_WAITS_TOOL = "list_waits";

/** Close to the limit, a new wait reminds the agent to close the waits it finished. */
const NEAR_LIMIT_MARGIN = 3;

const waitOwnerSchema = z
  .string()
  .trim()
  .min(1)
  .max(INPUT_LIMITS.identifier)
  .describe("Stable id from list_agents. Omit it for your own waits.");

export const awaitEventToolSchema = z.strictObject({
  note: z.string().trim().min(1).max(INPUT_LIMITS.agentWaitNote),
  routineId: z.string().trim().min(1).max(INPUT_LIMITS.identifier).optional(),
});

export const closeWaitToolSchema = z.strictObject({
  waitId: z.string().trim().min(1).max(INPUT_LIMITS.identifier),
  agentId: waitOwnerSchema.optional(),
});

export const listWaitsToolSchema = z.strictObject({ agentId: waitOwnerSchema.optional() });

export interface AgentWaitsHooks {
  emit(event: AgentEvent): void;
  /** Whether this agent owns this routine. */
  ownsRoutine(agentId: string, routineId: string): boolean;
  /** Whether this agent has a routine: only a routine run wakes a wait. */
  hasRoutine(agentId: string): boolean;
  /** Throws when no local agent has this id. */
  requireKnownAgent(agentId: string): void;
}

export interface AgentWaitsOptions {
  store: AgentWaitStore;
  mailbox: MailboxStore;
  hooks: AgentWaitsHooks;
}

/** Where a wait was opened, as the tool router knows it. */
export interface AgentWaitCaller {
  agentId: string;
  /** A channel or messaging turn: its messages are not in the agent's own chat. */
  inExecutionThread: boolean;
}

/**
 * Open waits: work an agent stopped because it waits for something outside the turn. The agent
 * opens, lists and closes them with three tools, and another local agent can list and close them
 * with `agentId`; the user cancels them from the chat; a routine run of the agent wakes them. The input of the run that wakes a wait repeats the request and the note, so
 * the agent can continue the request after its context lost it.
 *
 * It never imports the agent service facade.
 */
export class AgentWaits {
  readonly #store: AgentWaitStore;
  readonly #mailbox: MailboxStore;
  readonly #hooks: AgentWaitsHooks;

  constructor(options: AgentWaitsOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#hooks = options.hooks;
  }

  list(agentId: string): AgentWaitsSnapshot {
    return { agentId, waits: this.#store.list(agentId) };
  }

  /** The user cancels a wait. A run that it woke and that has not started no longer names it. */
  cancel(agentId: string, waitId: string): void {
    if (!this.#store.delete(agentId, waitId)) throw new AgentWaitError(sourceText("error.backend.agentWaitGone"));
    this.#changed(agentId);
  }

  /**
   * Marks the waits that a routine run wakes, after its delivery is queued. A script event that
   * names a wait wakes only that wait. Any other run wakes every wait of its agent that has no
   * routine or has this routine. A wait whose last wake has not ended yet stays with that run.
   */
  wakeForRun(run: { agentId: string; routineId: string }, deliveryId: string, waitId: string | null): void {
    const named = waitId ? this.#store.get(run.agentId, waitId) : null;
    const candidates = waitId ? (named ? [named] : []) : this.#store.forRoutineRun(run.agentId, run.routineId);
    const woken = candidates
      .filter((wait) => !wait.wakeDeliveryId || !this.#isPending(wait.wakeDeliveryId))
      .map((wait) => wait.id);
    if (woken.length === 0) return;
    this.#store.markWoken(run.agentId, woken, deliveryId);
    this.#changed(run.agentId);
  }

  /** The number of open waits of each agent that has one. */
  countByAgent(): Map<string, number> {
    return this.#store.countByAgent();
  }

  /** The waits that the run of this delivery continues, read when the run starts. */
  wokenBy(deliveryId: string): AgentWait[] {
    return this.#store.wokenBy(deliveryId);
  }

  /** Answers `await_event`, `close_wait` and `list_waits`; null for every other tool. */
  handleTool(params: DynamicToolCallParams, caller: AgentWaitCaller): OpenBotToolResponse | null {
    try {
      if (params.tool === AWAIT_EVENT_TOOL) return this.#awaitEvent(params, caller);
      if (params.tool === CLOSE_WAIT_TOOL) return this.#closeWait(params, caller);
      if (params.tool === LIST_WAITS_TOOL) return this.#listWaits(params, caller);
      return null;
    } catch (error) {
      if (error instanceof AgentWaitError) return openBotToolFailure(error.message);
      throw error;
    }
  }

  #awaitEvent(params: DynamicToolCallParams, caller: AgentWaitCaller): OpenBotToolResponse {
    const parsed = awaitEventToolSchema.safeParse(params.arguments);
    if (!parsed.success) return openBotToolFailure(sourceText("error.backend.agentWaitNoteRequired"));
    const { note, routineId } = parsed.data;
    if (caller.inExecutionThread) return openBotToolFailure(sourceText("error.backend.agentWaitOwnChatOnly"));
    const deliveries = this.#mailbox.findDeliveriesByTurn(caller.agentId, params.turnId);
    // A run that continues waits keeps them: leaving a wait open waits for the next run again.
    const continued = deliveries.flatMap((context) => this.#store.wokenBy(context.delivery.id));
    if (continued.length > 0)
      return openBotToolResult({
        waitIds: continued.map((wait) => wait.id),
        note: "This run continues these open waits. To wait again, leave them open and end your turn. Open a new wait only for a different request.",
      });
    // The user's message comes first; a routine run that waits serves its own instruction.
    const request =
      deliveries.findLast((context) => context.delivery.sender.kind === "user") ?? deliveries.at(0) ?? null;
    if (!request) return openBotToolFailure(sourceText("error.backend.agentWaitNoRequest"));
    if (routineId && !this.#hooks.ownsRoutine(caller.agentId, routineId))
      return openBotToolFailure(sourceText("error.backend.agentWaitRoutineGone"));
    if (!this.#hooks.hasRoutine(caller.agentId))
      return openBotToolFailure(sourceText("error.backend.agentWaitNoRoutine"));
    let wait: AgentWait;
    try {
      wait = this.#store.open({
        agentId: caller.agentId,
        requestMessageId: request.delivery.id,
        requestText: request.delivery.text,
        note,
        routineId: routineId ?? null,
      });
    } catch (error) {
      if (!(error instanceof AgentWaitLimitError)) throw error;
      // The open waits come with the refusal, so the agent can close the finished ones at once.
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({
              error: error.message,
              waits: this.#store.list(caller.agentId).map(waitSummary),
            }),
          },
        ],
      };
    }
    this.#changed(caller.agentId);
    const openWaits = this.#store.count(caller.agentId);
    return openBotToolResult({
      waitId: wait.id,
      openWaits,
      limit: INPUT_LIMITS.agentWaits,
      ...(openWaits >= INPUT_LIMITS.agentWaits - NEAR_LIMIT_MARGIN
        ? {
            nearLimit: `You are close to the limit of open waits. Call openbot.${LIST_WAITS_TOOL} and close the waits whose request is done.`,
          }
        : {}),
      wakes: wait.routineId
        ? `The next run of routine ${wait.routineId} wakes this wait, or a script event that names it.`
        : "The next run of any of your routines wakes this wait, or a script event that names it.",
      scriptEvent: `A local script names the wait with "waitId": "${wait.id}" next to "payload" in the body of its routine run request.`,
      next: "End your turn now. The run that wakes the wait repeats the request and your note. Close the wait with openbot.close_wait when the request is done.",
    });
  }

  #closeWait(params: DynamicToolCallParams, caller: AgentWaitCaller): OpenBotToolResponse {
    const parsed = closeWaitToolSchema.safeParse(params.arguments);
    if (!parsed.success) return openBotToolFailure(z.prettifyError(parsed.error));
    const agentId = this.#waitOwner(parsed.data.agentId, caller);
    if (!this.#store.delete(agentId, parsed.data.waitId))
      return openBotToolFailure(sourceText("error.backend.agentWaitGone"));
    this.#changed(agentId);
    return openBotToolResult({ closed: parsed.data.waitId });
  }

  #listWaits(params: DynamicToolCallParams, caller: AgentWaitCaller): OpenBotToolResponse {
    const parsed = listWaitsToolSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) return openBotToolFailure(z.prettifyError(parsed.error));
    const agentId = this.#waitOwner(parsed.data.agentId, caller);
    return openBotToolResult({
      agentId,
      limit: INPUT_LIMITS.agentWaits,
      waits: this.#store.list(agentId).map(waitSummary),
    });
  }

  /** The agent whose waits a tool call reads or closes. An unknown agent is a request the model can correct. */
  #waitOwner(agentId: string | undefined, caller: AgentWaitCaller): string {
    if (agentId === undefined || agentId === caller.agentId) return caller.agentId;
    try {
      this.#hooks.requireKnownAgent(agentId);
    } catch (error) {
      throw new AgentWaitError(error instanceof Error ? error.message : String(error));
    }
    return agentId;
  }

  #isPending(deliveryId: string): boolean {
    const status = this.#mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "queued" || status === "starting" || status === "running";
  }

  #changed(agentId: string): void {
    this.#hooks.emit({ type: "waits-changed", snapshot: this.list(agentId) });
  }
}

/** A wait as the list tools show it. The request text stays out: it can be long, and it is the user's. */
function waitSummary(wait: AgentWait) {
  return {
    waitId: wait.id,
    note: wait.note,
    openedAt: wait.createdAt,
    routineId: wait.routineId,
    wokenAt: wait.wokenAt,
  };
}

/** The part of a run's input that continues its woken waits. */
export function wokenWaitsPromptText(waits: readonly AgentWait[]): string | null {
  if (waits.length === 0) return null;
  return [
    "--- open waits that this run wakes ---",
    `You opened these waits with openbot.${AWAIT_EVENT_TOOL}. Continue each request with what this run brings. When a request is done, or can no longer be done, tell the user and call openbot.${CLOSE_WAIT_TOOL} with its wait id. To wait for the next run again, leave the wait open.`,
    ...waits.flatMap((wait) => [
      "",
      `Wait ID: ${wait.id}`,
      `Opened: ${wait.createdAt}`,
      `Your note: ${wait.note}`,
      "The request it continues:",
      wait.requestText,
    ]),
    "--- end of open waits ---",
  ].join("\n");
}
