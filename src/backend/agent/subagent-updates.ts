import {
  CONVERSATION_SUBAGENT_STEP_LIMIT,
  type ConversationSubagent,
  type ConversationSubagentStatus,
  type ConversationSubagentStep,
  type ConversationSubagentStepKind,
  clampConversationSubagents,
  isConversationSubagents,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isRecord } from "../protocol";

/**
 * The notification that carries the subagents of a turn:
 * `{ threadId, turnId, subagents: ConversationSubagent[] }`, always the full list of that turn.
 * A background subagent can end after its turn, so an update can name a turn that has ended.
 */
export const SUBAGENTS_UPDATED_METHOD = "turn/subagents/updated";

/** The subagents in a `turn/subagents/updated` notification, or null. */
export function subagentsFromNotification(params: unknown): ConversationSubagent[] | null {
  if (!isRecord(params) || !isConversationSubagents(params.subagents)) return null;
  return clampConversationSubagents(params.subagents);
}

/** The step that a subagent's tool call shows: the kind gives the icon, the text is the target. */
function subagentToolStep(name: string, input: unknown): { kind: ConversationSubagentStepKind; text: string } {
  const fields = isRecord(input) ? input : {};
  const field = (key: string) => (isString(fields[key]) ? fields[key] : "");
  switch (name) {
    case "Read":
    case "NotebookRead":
      return { kind: "read", text: field("file_path") || field("notebook_path") };
    case "Grep":
    case "Glob":
      return { kind: "search", text: field("pattern") };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return { kind: "edit", text: field("file_path") || field("notebook_path") };
    case "Bash":
      return { kind: "command", text: field("command") };
    case "WebSearch":
      return { kind: "web", text: field("query") };
    case "WebFetch":
      return { kind: "web", text: field("url") };
    default:
      return { kind: "tool", text: name };
  }
}

/**
 * Adds a step, or replaces the step with the same id, and keeps only the newest steps, so a long
 * run holds bounded memory. Returns false for a blank step, which is not added.
 */
function pushSubagentStep(subagent: ConversationSubagent, step: ConversationSubagentStep): boolean {
  const text = step.text.trim();
  if (!text) return false;
  const existing = subagent.steps.findIndex((candidate) => candidate.id === step.id);
  if (existing >= 0) subagent.steps[existing] = { ...step, text };
  else subagent.steps.push({ ...step, text });
  if (subagent.steps.length > CONVERSATION_SUBAGENT_STEP_LIMIT)
    subagent.steps.splice(0, subagent.steps.length - CONVERSATION_SUBAGENT_STEP_LIMIT);
  return true;
}

/** The final report as the last step, unless the subagent already wrote the same text. */
function pushSubagentReport(subagent: ConversationSubagent, text: string): void {
  const last = subagent.steps.at(-1);
  if (last?.kind === "text" && last.id !== `${subagent.id}:result` && last.text === text.trim()) return;
  pushSubagentStep(subagent, { id: `${subagent.id}:result`, kind: "text", text });
}

/** Ends a subagent once. A later end, such as a tool result after the task notification, keeps the first. */
function endSubagent(
  subagent: ConversationSubagent,
  status: Exclude<ConversationSubagentStatus, "running">,
  endedAt: string,
  error: string | null = null,
): boolean {
  if (subagent.status !== "running") return false;
  subagent.status = status;
  subagent.endedAt = endedAt;
  if (error) subagent.error = error;
  return true;
}

/** The subagents of one turn, in start order. */
interface SubagentTurn {
  subagents: ConversationSubagent[];
  /** The turn ended. A later `Agent` call can still come while it runs, so its list stays until then. */
  ended: boolean;
}

/**
 * The subagents that Claude starts with its `Agent` tool (`Task` before Claude Code 2). The state
 * lives with the Claude session, because a background subagent ends after its turn, and the CLI then
 * reports it in a turn of its own. A turn's entry goes when the turn ended and none of its subagents
 * still runs.
 */
export interface ClaudeSubagentState {
  turns: Map<string, SubagentTurn>;
  /** The turn of each subagent, under the tool-use id of its `Agent` call. */
  turnOf: Map<string, string>;
  /** The tool-use id of each subagent under its CLI task id: `task_updated` names only the task. */
  toolOfTask: Map<string, string>;
}

export function newClaudeSubagentState(): ClaudeSubagentState {
  return { turns: new Map(), turnOf: new Map(), toolOfTask: new Map() };
}

const CLAUDE_SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** The turn whose list changed and its full list, for one notification. */
export interface SubagentChange {
  turnId: string;
  subagents: ConversationSubagent[];
}

function change(state: ClaudeSubagentState, turnId: string | undefined): SubagentChange | null {
  const turn = turnId ? state.turns.get(turnId) : undefined;
  if (!turnId || !turn) return null;
  const subagents = clampConversationSubagents(turn.subagents) ?? [];
  if (turn.ended && turn.subagents.every((subagent) => subagent.status !== "running")) {
    state.turns.delete(turnId);
    for (const subagent of turn.subagents) state.turnOf.delete(subagent.id);
    for (const [taskId, toolUseId] of state.toolOfTask)
      if (!state.turnOf.has(toolUseId)) state.toolOfTask.delete(taskId);
  }
  return { turnId, subagents };
}

function subagentFor(state: ClaudeSubagentState, toolUseId: unknown): ConversationSubagent | undefined {
  if (!isString(toolUseId)) return undefined;
  const turnId = state.turnOf.get(toolUseId);
  return turnId ? state.turns.get(turnId)?.subagents.find((subagent) => subagent.id === toolUseId) : undefined;
}

/** Starts a subagent for an `Agent` call of the main agent. Returns null for every other tool. */
export function foldClaudeSubagentCall(
  state: ClaudeSubagentState,
  turnId: string,
  call: { id: string; name: string; input: unknown },
  now: string,
): SubagentChange | null {
  if (!CLAUDE_SUBAGENT_TOOLS.has(call.name) || state.turnOf.has(call.id)) return null;
  const input = isRecord(call.input) ? call.input : {};
  const agentType = isString(input.subagent_type) ? input.subagent_type : null;
  const subagent: ConversationSubagent = {
    id: call.id,
    title: isString(input.description) ? input.description : (agentType ?? ""),
    agentType,
    prompt: isString(input.prompt) ? input.prompt : null,
    status: "running",
    startedAt: now,
    endedAt: null,
    steps: [],
    error: null,
    ...(input.run_in_background === true ? { background: true as const } : {}),
  };
  const turn = state.turns.get(turnId) ?? { subagents: [], ended: false };
  turn.subagents.push(subagent);
  state.turns.set(turnId, turn);
  state.turnOf.set(call.id, turnId);
  return change(state, turnId);
}

/**
 * Applies a message that a subagent wrote: its `parent_tool_use_id` names the `Agent` call. Each
 * thought, text, and tool call becomes a step.
 */
export function foldClaudeSubagentMessage(
  state: ClaudeSubagentState,
  parentToolUseId: string,
  messageId: string,
  message: unknown,
): SubagentChange | null {
  const subagent = subagentFor(state, parentToolUseId);
  if (!subagent || !isRecord(message) || !Array.isArray(message.content)) return null;
  let changed = false;
  message.content.forEach((block, index) => {
    if (!isRecord(block)) return;
    const id = `${messageId}:${index}`;
    const step =
      block.type === "thinking" && isString(block.thinking)
        ? { id, kind: "thinking" as const, text: block.thinking }
        : block.type === "text" && isString(block.text)
          ? { id, kind: "text" as const, text: block.text }
          : block.type === "tool_use" && isString(block.name)
            ? { id: isString(block.id) ? block.id : id, ...subagentToolStep(block.name, block.input) }
            : null;
    if (step && pushSubagentStep(subagent, step)) changed = true;
  });
  return changed ? change(state, state.turnOf.get(parentToolUseId)) : null;
}

/**
 * Applies the main agent's result of an `Agent` call. A background call answers at once that the
 * subagent started, so only a foreground result ends the subagent. An error ends both: a background
 * call that failed started no task, so no `task_notification` ends it later.
 */
export function foldClaudeSubagentResult(
  state: ClaudeSubagentState,
  toolUseId: string,
  result: unknown,
  isError: boolean,
  text: string,
  now: string,
): SubagentChange | null {
  const subagent = subagentFor(state, toolUseId);
  if (!subagent) return null;
  if (isError) {
    endSubagent(subagent, "failed", now, text);
    return change(state, state.turnOf.get(toolUseId));
  }
  if (isRecord(result) && (result.isAsync === true || result.status === "async_launched")) {
    subagent.background = true;
    return null;
  }
  if (subagent.background) return null;
  pushSubagentReport(subagent, claudeResultText(result));
  endSubagent(subagent, "completed", now);
  return change(state, state.turnOf.get(toolUseId));
}

/** The final report in the structured result. The text form is wrapped in a frame for the model. */
function claudeResultText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .filter(isRecord)
    .map((part) => (isString(part.text) ? part.text : ""))
    .join("\n");
}

/**
 * Applies the CLI's own record of a subagent: `task_started`, `task_updated`, and
 * `task_notification`, which carries the end state and the final report. These come for background
 * subagents after their turn too.
 */
export function foldClaudeTaskMessage(
  state: ClaudeSubagentState,
  message: unknown,
  now: string,
): SubagentChange | null {
  if (!isRecord(message) || message.type !== "system") return null;
  if (
    message.subtype === "task_started" &&
    isString(message.task_id) &&
    isString(message.tool_use_id) &&
    state.turnOf.has(message.tool_use_id)
  )
    state.toolOfTask.set(message.task_id, message.tool_use_id);
  const toolUseId =
    message.tool_use_id ?? (isString(message.task_id) ? state.toolOfTask.get(message.task_id) : undefined);
  const subagent = subagentFor(state, toolUseId);
  if (!subagent) return null;
  const turnId = state.turnOf.get(subagent.id);
  if (message.subtype === "task_started" || message.subtype === "task_updated") {
    const backgrounded =
      message.is_backgrounded === true || (isRecord(message.patch) && message.patch.is_backgrounded === true);
    if (!backgrounded || subagent.background) return null;
    subagent.background = true;
    return change(state, turnId);
  }
  if (message.subtype !== "task_notification") return null;
  const summary = isString(message.summary) ? message.summary : "";
  if (message.status === "completed") {
    pushSubagentReport(subagent, summary);
    endSubagent(subagent, "completed", now);
  } else endSubagent(subagent, message.status === "failed" ? "failed" : "stopped", now, summary || null);
  return change(state, turnId);
}

/**
 * The turn ended. A foreground subagent that still runs has stopped with it, for example when the
 * person stopped the turn. A background subagent works on.
 */
export function endClaudeSubagentTurn(state: ClaudeSubagentState, turnId: string, now: string): SubagentChange | null {
  const turn = state.turns.get(turnId);
  if (!turn) return null;
  turn.ended = true;
  let changed = false;
  for (const subagent of turn.subagents)
    if (!subagent.background) changed = endSubagent(subagent, "stopped", now) || changed;
  const update = change(state, turnId);
  return changed ? update : null;
}

/** The process ended, and each subagent that still ran ended with it. */
export function stopClaudeSubagents(state: ClaudeSubagentState, now: string): SubagentChange[] {
  return [...state.turns].flatMap(([turnId, turn]) => {
    turn.ended = true;
    let changed = false;
    for (const subagent of turn.subagents) changed = endSubagent(subagent, "stopped", now) || changed;
    const update = change(state, turnId);
    return changed && update ? [update] : [];
  });
}

/**
 * Ends the subagents in a stored list that still run. `background` keeps a background subagent,
 * which works on after its turn. Returns true when the list changed.
 */
export function stopRunningSubagents(
  subagents: ConversationSubagent[] | undefined,
  now: string,
  { background }: { background: boolean },
): boolean {
  let changed = false;
  for (const subagent of subagents ?? [])
    if (background || !subagent.background) changed = endSubagent(subagent, "stopped", now) || changed;
  return changed;
}

/**
 * Applies a Codex `collabAgentToolCall` item to the subagents of a turn. `spawnAgent` starts one
 * subagent for each receiver thread; the other tools (`wait`, `closeAgent`) report the state of
 * subagents that already exist. Returns the new list, or null when nothing changed.
 */
export function foldCodexSubagentItem(
  current: readonly ConversationSubagent[],
  item: DynamicRecord,
  now: string,
): ConversationSubagent[] | null {
  const subagents = current.map((subagent) => ({ ...subagent, steps: [...subagent.steps] }));
  let changed = false;
  const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter(isString) : [];
  if (item.tool === "spawnAgent") {
    const prompt = isString(item.prompt) ? item.prompt : null;
    for (const receiver of receivers) {
      if (subagents.some((subagent) => subagent.id === receiver)) continue;
      subagents.push({
        id: receiver,
        title: prompt?.trim().split("\n", 1)[0] ?? "",
        agentType: isString(item.model) ? item.model : null,
        prompt,
        status: "running",
        startedAt: now,
        endedAt: null,
        steps: [],
        error: null,
      });
      changed = true;
    }
    if (item.status === "failed")
      for (const subagent of subagents)
        if (receivers.includes(subagent.id)) changed = endSubagent(subagent, "failed", now) || changed;
  }
  const states = isRecord(item.agentsStates) ? item.agentsStates : {};
  for (const subagent of subagents) {
    const state = states[subagent.id];
    if (!isRecord(state)) continue;
    const message = isString(state.message) ? state.message : "";
    const status = codexSubagentStatus(state.status);
    if (status === "completed") {
      pushSubagentReport(subagent, message);
      changed = endSubagent(subagent, status, now) || changed;
    } else if (status) changed = endSubagent(subagent, status, now, message || null) || changed;
  }
  return changed ? subagents : null;
}

/** The end state of a Codex agent, or null while it still works. */
function codexSubagentStatus(status: unknown): Exclude<ConversationSubagentStatus, "running"> | null {
  if (status === "completed") return "completed";
  if (status === "errored" || status === "failed") return "failed";
  if (status === "shutdown" || status === "notFound" || status === "interrupted") return "stopped";
  return null;
}
