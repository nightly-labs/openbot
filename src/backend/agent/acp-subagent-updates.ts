import type { ConversationSubagentStepKind } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isRecord } from "../protocol";
import {
  dropSubagent,
  endSubagent,
  pushSubagentReport,
  pushSubagentStep,
  type SubagentChange,
  type SubagentState,
  startSubagent,
  subagentChange,
  subagentFor,
} from "./subagent-updates";

/** The ACP extension notification that OpenCode sends for the sessions of its subagents. */
export const OPENCODE_CHILD_UPDATE_METHOD = "opencode/session/child_update";

/** The client capability that makes OpenCode send `OPENCODE_CHILD_UPDATE_METHOD`. */
export const OPENCODE_CHILD_SESSION_UPDATES = "opencode/child-session-updates";

/** The fields of an ACP `tool_call` or `tool_call_update` that a subagent card reads. */
export interface AcpSubagentToolCall {
  id: string;
  /** The name that OpenBot shows for the call: the ACP `name`, else the title. */
  name: string;
  status: string | undefined;
  rawInput: unknown;
  rawOutput: unknown;
  content: unknown;
}

/** The text blocks of ACP tool call content, joined. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && isRecord(part.content) && isString(part.content.text) ? part.content.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** A JSON object in text, or null. Kimi sends the arguments of a call as its content text. */
function jsonRecord(text: string): DynamicRecord | null {
  if (!text.trim().startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** The first string among these fields. */
function firstString(record: DynamicRecord | null, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (isString(value) && value.trim()) return value;
  }
  return null;
}

/** The description after `<name>: `, "" for the bare name, or null when the call is not one of these tools. */
function subagentToolTitle(names: readonly string[], name: string): string | null {
  for (const tool of names) {
    if (name === tool) return "";
    if (name.startsWith(`${tool}: `)) return name.slice(tool.length + 2).trim();
  }
  return null;
}

/** The report or error in a tool result: a string, or the text field of an object. */
function resultText(rawOutput: unknown, content: unknown): string {
  if (isString(rawOutput)) return rawOutput;
  const field = isRecord(rawOutput) ? firstString(rawOutput, ["output", "result", "text", "error", "message"]) : null;
  return field ?? contentText(content);
}

/**
 * Applies an ACP tool call that runs a subagent, such as Kimi's `Agent`, Cline's `spawn_agent`, or
 * Hermes's `delegate_task`. These agents send no events of the subagent itself, so its card shows
 * the task, the state, and the report. A background call is not shown: no event says when it ends.
 */
export function foldAcpSubagentTool(
  state: SubagentState,
  turnId: string,
  names: readonly string[],
  call: AcpSubagentToolCall,
  now: string,
): SubagentChange | null {
  const title = subagentToolTitle(names, call.name);
  const existing = subagentFor(state, call.id);
  const ended = call.status === "completed" || call.status === "failed";
  // A call that was not shown while it ran, such as Kimi's background call, is not shown at its end.
  if (!existing && (title === null || ended)) return null;
  // Kimi sends no `rawInput`: the content of a running call is its arguments, and at the end its result.
  const input = isRecord(call.rawInput) ? call.rawInput : ended ? null : jsonRecord(contentText(call.content));
  if (input?.run_in_background === true || input?.background === true)
    return existing ? dropSubagent(state, call.id) : null;
  const description = title || firstString(input, ["description", "title"]) || "";
  const prompt = firstString(input, ["prompt", "task", "goal"]);
  const agentType = firstString(input, ["subagent_type", "agent", "role"]);
  if (!existing)
    return startSubagent(state, turnId, {
      id: call.id,
      title: description,
      agentType,
      prompt,
      status: "running",
      startedAt: now,
      endedAt: null,
      steps: [],
      error: null,
    });
  // The arguments stream in, so a later update can name the task that the first one did not.
  let changed = false;
  if (existing.status === "running") {
    if (description && existing.title !== description) {
      existing.title = description;
      changed = true;
    }
    if (prompt && existing.prompt !== prompt) {
      existing.prompt = prompt;
      changed = true;
    }
    if (agentType && existing.agentType !== agentType) {
      existing.agentType = agentType;
      changed = true;
    }
  }
  if (call.status === "completed") {
    pushSubagentReport(existing, resultText(call.rawOutput, call.content));
    changed = endSubagent(existing, "completed", now) || changed;
  } else if (call.status === "failed")
    changed = endSubagent(existing, "failed", now, resultText(call.rawOutput, call.content) || null) || changed;
  return changed ? subagentChange(state, state.turnOf.get(call.id)) : null;
}

/** A subagent call that OpenCode's parent session made, which its child session takes the task of. */
interface OpenCodeLaunch {
  title: string;
  prompt: string | null;
  agentType: string | null;
  background: boolean;
}

/** The parent's `subagent` (`task` before OpenCode 2) calls that no child session took yet, by call id. */
export type OpenCodeLaunches = Map<string, OpenCodeLaunch>;

const OPENCODE_LAUNCH_LIMIT = 24;

/** The text that a streamed step keeps. A step shows 500 characters on one line. */
const OPENCODE_STREAM_LIMIT = 2_000;

/**
 * Notes a parent tool call that starts an OpenCode subagent. Its child session reports only the
 * description as its title, so the prompt and the agent come from this call.
 */
export function noteOpenCodeLaunch(launches: OpenCodeLaunches, call: AcpSubagentToolCall): void {
  const input = isRecord(call.rawInput) ? call.rawInput : null;
  const title = firstString(input, ["description"]);
  const prompt = firstString(input, ["prompt"]);
  if (!title || !prompt || isString(input?.sessionID)) return;
  launches.set(call.id, {
    title,
    prompt,
    agentType: firstString(input, ["agent", "subagent_type"]),
    background: input?.background === true,
  });
  for (const id of launches.keys()) {
    if (launches.size <= OPENCODE_LAUNCH_LIMIT) break;
    launches.delete(id);
  }
}

/**
 * Marks the subagent background when the parent's call ended and left it running: OpenCode then
 * reports its end after the turn. The call's result names the child session.
 */
export function markOpenCodeBackground(state: SubagentState, rawOutput: unknown): SubagentChange | null {
  const metadata = isRecord(rawOutput) && isRecord(rawOutput.metadata) ? rawOutput.metadata : null;
  if (metadata?.status !== "running" || !isString(metadata.sessionID)) return null;
  const subagent = subagentFor(state, metadata.sessionID);
  if (!subagent || subagent.background || subagent.status !== "running") return null;
  subagent.background = true;
  return subagentChange(state, state.turnOf.get(subagent.id));
}

/** The step kind of an ACP tool kind. */
function acpStepKind(kind: unknown): ConversationSubagentStepKind {
  switch (kind) {
    case "read":
      return "read";
    case "search":
      return "search";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "command";
    case "fetch":
      return "web";
    case "think":
      return "thinking";
    default:
      return "tool";
  }
}

/**
 * Applies an `opencode/session/child_update` notification. `turnId` is the parent session's
 * running turn: a new child session belongs to it. A child of a child shows its steps in its top
 * subagent. Text and thinking stream; the list is sent when a step starts or the state changes, not
 * for each chunk.
 */
export function foldOpenCodeChildUpdate(
  state: SubagentState,
  launches: OpenCodeLaunches,
  turnId: string | null,
  params: unknown,
  now: string,
): SubagentChange | null {
  if (!isRecord(params) || !isString(params.childSessionId)) return null;
  const childId = params.childSessionId;
  const nested = typeof params.depth === "number" && params.depth > 1;
  if (nested && isString(params.parentSessionId) && !state.aliases.has(childId)) {
    const top = state.aliases.get(params.parentSessionId) ?? params.parentSessionId;
    if (state.turnOf.has(top)) state.aliases.set(childId, top);
  }
  const id = state.aliases.get(childId) ?? childId;
  const childTitle = isString(params.title) ? params.title : "";
  const subagent = subagentFor(state, id);
  if (params.type === "status") {
    if (nested) return null;
    const status = params.status;
    if (status === "created" || status === "running") {
      if (subagent) {
        if (subagent.status === "running") return null;
        // The parent sent a follow-up to a subagent that had ended.
        subagent.status = "running";
        subagent.endedAt = null;
        subagent.error = null;
        return subagentChange(state, state.turnOf.get(id));
      }
      if (!turnId) return null;
      const launch = takeLaunch(launches, childTitle);
      return startSubagent(state, turnId, {
        id,
        title: childTitle,
        agentType: launch?.agentType ?? null,
        prompt: launch?.prompt ?? null,
        status: "running",
        startedAt: now,
        endedAt: null,
        steps: [],
        error: null,
        ...(launch?.background ? { background: true as const } : {}),
      });
    }
    if (!subagent) return null;
    state.streams.delete(id);
    const error = isRecord(params.error) && isString(params.error.message) ? params.error.message : null;
    const ended =
      status === "completed"
        ? endSubagent(subagent, "completed", now)
        : status === "failed"
          ? endSubagent(subagent, "failed", now, error)
          : status === "interrupted"
            ? endSubagent(subagent, "stopped", now)
            : false;
    return ended ? subagentChange(state, state.turnOf.get(id)) : null;
  }
  if (params.type !== "update" || !subagent || subagent.status !== "running" || !isRecord(params.update)) return null;
  const update = params.update;
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    if (!isString(update.toolCallId)) return null;
    const previous = subagent.steps.find((step) => step.id === update.toolCallId);
    const input = isRecord(update.rawInput) ? update.rawInput : null;
    const title = isString(update.title) ? update.title : "";
    const target =
      firstString(input, ["command", "cmd", "filePath", "path", "pattern", "query", "url"]) ??
      (childTitle && title.startsWith(`${childTitle}: `) ? title.slice(childTitle.length + 2) : title);
    const kind = update.kind === undefined && previous ? previous.kind : acpStepKind(update.kind);
    const text = target || previous?.text || "";
    if (previous && previous.kind === kind && previous.text === text.trim()) return null;
    state.streams.get(id)?.clear();
    return pushSubagentStep(subagent, { id: update.toolCallId, kind, text })
      ? subagentChange(state, state.turnOf.get(id))
      : null;
  }
  const kind =
    update.sessionUpdate === "agent_message_chunk"
      ? "text"
      : update.sessionUpdate === "agent_thought_chunk"
        ? "thinking"
        : null;
  const chunk = isRecord(update.content) && isString(update.content.text) ? update.content.text : "";
  if (!kind || !chunk) return null;
  const streams = state.streams.get(id) ?? new Map<string, string>();
  state.streams.set(id, streams);
  // Without a message id, a chunk continues the open step of its kind. A tool call closes it.
  const prefix = `${id}:${kind}:`;
  const stepId = isString(update.messageId)
    ? `${prefix}${update.messageId}`
    : ([...streams.keys()].find((key) => key.startsWith(prefix)) ?? `${prefix}${now}`);
  const previous = streams.get(stepId) ?? "";
  // A step shows only the start of its text, so a long stream stops growing.
  if (previous.length >= OPENCODE_STREAM_LIMIT) return null;
  streams.set(stepId, previous + chunk);
  const started = !subagent.steps.some((step) => step.id === stepId);
  const pushed = pushSubagentStep(subagent, { id: stepId, kind, text: previous + chunk });
  return pushed && started ? subagentChange(state, state.turnOf.get(id)) : null;
}

/** The launch whose description is the child session's title, which it then leaves the list. */
function takeLaunch(launches: OpenCodeLaunches, title: string): OpenCodeLaunch | undefined {
  for (const [callId, launch] of launches)
    if (launch.title === title) {
      launches.delete(callId);
      return launch;
    }
  return undefined;
}
