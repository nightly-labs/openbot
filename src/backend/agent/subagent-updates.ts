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
export function pushSubagentStep(subagent: ConversationSubagent, step: ConversationSubagentStep): boolean {
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
export function pushSubagentReport(subagent: ConversationSubagent, text: string): void {
  const last = subagent.steps.at(-1);
  if (last?.kind === "text" && last.id !== `${subagent.id}:result` && last.text === text.trim()) return;
  pushSubagentStep(subagent, { id: `${subagent.id}:result`, kind: "text", text });
}

/** Ends a subagent once. A later end, such as a tool result after the task notification, keeps the first. */
export function endSubagent(
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
 * The subagents of one provider session: Claude's `Agent` calls, an ACP agent's subagent tool
 * calls, or OpenCode's child sessions. The state lives with the session, because a background
 * subagent ends after its turn, and the provider then reports it in a turn of its own. A turn's
 * entry goes when the turn ended and none of its subagents still runs.
 */
export interface SubagentState {
  turns: Map<string, SubagentTurn>;
  /** The turn of each subagent, under the subagent's id. */
  turnOf: Map<string, string>;
  /**
   * The subagent's id under another id that an update names: a Claude CLI task id, which
   * `task_updated` names alone, or a nested OpenCode child session, which shows in its top subagent.
   */
  aliases: Map<string, string>;
  /** The text of steps that still stream, under the subagent's id and then the step's id. */
  streams: Map<string, Map<string, string>>;
}

export function newSubagentState(): SubagentState {
  return { turns: new Map(), turnOf: new Map(), aliases: new Map(), streams: new Map() };
}

const CLAUDE_SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** The turn whose list changed and its full list, for one notification. */
export interface SubagentChange {
  turnId: string;
  subagents: ConversationSubagent[];
}

/** The full list of a turn after a change. A turn that ended with no subagent left running is forgotten. */
export function subagentChange(state: SubagentState, turnId: string | undefined): SubagentChange | null {
  const turn = turnId ? state.turns.get(turnId) : undefined;
  if (!turnId || !turn) return null;
  const subagents = clampConversationSubagents(turn.subagents) ?? [];
  if (turn.ended && turn.subagents.every((subagent) => subagent.status !== "running")) {
    state.turns.delete(turnId);
    for (const subagent of turn.subagents) {
      state.turnOf.delete(subagent.id);
      state.streams.delete(subagent.id);
    }
    for (const [alias, id] of state.aliases) if (!state.turnOf.has(id)) state.aliases.delete(alias);
  }
  return { turnId, subagents };
}

/** The subagent with this id, or null when the state does not know it. */
export function subagentFor(state: SubagentState, id: unknown): ConversationSubagent | undefined {
  if (!isString(id)) return undefined;
  const turnId = state.turnOf.get(id);
  return turnId ? state.turns.get(turnId)?.subagents.find((subagent) => subagent.id === id) : undefined;
}

/** Adds a subagent to a turn. The turn's entry starts with its first subagent. */
export function startSubagent(
  state: SubagentState,
  turnId: string,
  subagent: ConversationSubagent,
): SubagentChange | null {
  const turn = state.turns.get(turnId) ?? { subagents: [], ended: false };
  turn.subagents.push(subagent);
  state.turns.set(turnId, turn);
  state.turnOf.set(subagent.id, turnId);
  return subagentChange(state, turnId);
}

/** Removes a subagent that turned out not to be one that OpenBot can follow. */
export function dropSubagent(state: SubagentState, id: string): SubagentChange | null {
  const turnId = state.turnOf.get(id);
  const turn = turnId ? state.turns.get(turnId) : undefined;
  if (!turnId || !turn) return null;
  turn.subagents = turn.subagents.filter((subagent) => subagent.id !== id);
  state.turnOf.delete(id);
  state.streams.delete(id);
  return subagentChange(state, turnId);
}

/** Starts a subagent for an `Agent` call of the main agent. Returns null for every other tool. */
export function foldClaudeSubagentCall(
  state: SubagentState,
  turnId: string,
  call: { id: string; name: string; input: unknown },
  now: string,
): SubagentChange | null {
  if (!CLAUDE_SUBAGENT_TOOLS.has(call.name) || state.turnOf.has(call.id)) return null;
  const input = isRecord(call.input) ? call.input : {};
  const agentType = isString(input.subagent_type) ? input.subagent_type : null;
  return startSubagent(state, turnId, {
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
  });
}

/**
 * Applies a message that a subagent wrote: its `parent_tool_use_id` names the `Agent` call. Each
 * thought, text, and tool call becomes a step.
 */
export function foldClaudeSubagentMessage(
  state: SubagentState,
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
  return changed ? subagentChange(state, state.turnOf.get(parentToolUseId)) : null;
}

/**
 * Applies the main agent's result of an `Agent` call. A background call answers at once that the
 * subagent started, so only a foreground result ends the subagent. An error ends both: a background
 * call that failed started no task, so no `task_notification` ends it later.
 */
export function foldClaudeSubagentResult(
  state: SubagentState,
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
    return subagentChange(state, state.turnOf.get(toolUseId));
  }
  if (isRecord(result) && (result.isAsync === true || result.status === "async_launched")) {
    subagent.background = true;
    return null;
  }
  if (subagent.background) return null;
  pushSubagentReport(subagent, claudeResultText(result));
  endSubagent(subagent, "completed", now);
  return subagentChange(state, state.turnOf.get(toolUseId));
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
export function foldClaudeTaskMessage(state: SubagentState, message: unknown, now: string): SubagentChange | null {
  if (!isRecord(message) || message.type !== "system") return null;
  if (
    message.subtype === "task_started" &&
    isString(message.task_id) &&
    isString(message.tool_use_id) &&
    state.turnOf.has(message.tool_use_id)
  )
    state.aliases.set(message.task_id, message.tool_use_id);
  const toolUseId = message.tool_use_id ?? (isString(message.task_id) ? state.aliases.get(message.task_id) : undefined);
  const subagent = subagentFor(state, toolUseId);
  if (!subagent) return null;
  const turnId = state.turnOf.get(subagent.id);
  if (message.subtype === "task_started" || message.subtype === "task_updated") {
    const backgrounded =
      message.is_backgrounded === true || (isRecord(message.patch) && message.patch.is_backgrounded === true);
    if (!backgrounded || subagent.background) return null;
    subagent.background = true;
    return subagentChange(state, turnId);
  }
  if (message.subtype !== "task_notification") return null;
  const summary = isString(message.summary) ? message.summary : "";
  if (message.status === "completed") {
    pushSubagentReport(subagent, summary);
    endSubagent(subagent, "completed", now);
  } else endSubagent(subagent, message.status === "failed" ? "failed" : "stopped", now, summary || null);
  return subagentChange(state, turnId);
}

/**
 * The turn ended. A foreground subagent that still runs has stopped with it, for example when the
 * person stopped the turn. A background subagent works on.
 */
export function endSubagentTurn(state: SubagentState, turnId: string, now: string): SubagentChange | null {
  const turn = state.turns.get(turnId);
  if (!turn) return null;
  turn.ended = true;
  let changed = false;
  for (const subagent of turn.subagents)
    if (!subagent.background) changed = endSubagent(subagent, "stopped", now) || changed;
  const update = subagentChange(state, turnId);
  return changed ? update : null;
}

/**
 * The process ended, and each subagent that still ran ended with it. `turnIds` limits this to the
 * turns of one session, which closed: the agent then reports nothing more of its subagents.
 */
export function stopSubagents(state: SubagentState, now: string, turnIds?: ReadonlySet<string>): SubagentChange[] {
  return [...state.turns].flatMap(([turnId, turn]) => {
    if (turnIds && !turnIds.has(turnId)) return [];
    turn.ended = true;
    let changed = false;
    for (const subagent of turn.subagents) changed = endSubagent(subagent, "stopped", now) || changed;
    const update = subagentChange(state, turnId);
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

/**
 * Applies an item of a Codex subagent's own thread as a step of that subagent. Codex sends the
 * items of each thread to every connection, child threads too. Returns the new list, or null when
 * nothing changed. An ended subagent takes no more steps.
 */
export function foldCodexChildItem(
  current: readonly ConversationSubagent[],
  childThreadId: string,
  item: DynamicRecord,
): ConversationSubagent[] | null {
  const index = current.findIndex((subagent) => subagent.id === childThreadId && subagent.status === "running");
  const step = index >= 0 ? codexChildStep(item) : null;
  if (!step) return null;
  const subagents = current.map((subagent) => ({ ...subagent, steps: [...subagent.steps] }));
  const subagent = subagents[index];
  return subagent && pushSubagentStep(subagent, step) ? subagents : null;
}

/** The step that a Codex thread item shows, or null for an item that is not work of the subagent. */
function codexChildStep(item: DynamicRecord): ConversationSubagentStep | null {
  if (!isString(item.id)) return null;
  const id = item.id;
  const field = (record: unknown, key: string) => (isRecord(record) && isString(record[key]) ? record[key] : "");
  const lines = (value: unknown) => (Array.isArray(value) ? value.filter(isString).join("\n") : "");
  switch (item.type) {
    case "commandExecution":
      return { id, kind: "command", text: field(item, "command") };
    case "fileChange":
      return {
        id,
        kind: "edit",
        text: Array.isArray(item.changes) ? item.changes.map((change) => field(change, "path")).join(", ") : "",
      };
    case "webSearch":
      return { id, kind: "web", text: field(item, "query") || field(item.action, "url") };
    case "imageView":
      return { id, kind: "read", text: field(item, "path") };
    case "mcpToolCall":
    case "dynamicToolCall":
      return { id, kind: "tool", text: field(item, "tool") };
    case "agentMessage":
      return { id, kind: "text", text: field(item, "text") };
    case "reasoning":
      return { id, kind: "thinking", text: lines(item.summary) || lines(item.content) };
    default:
      return null;
  }
}
