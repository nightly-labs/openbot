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

export const OPENCODE_CHILD_UPDATE_METHOD = "opencode/session/child_update";

export const OPENCODE_CHILD_SESSION_UPDATES = "opencode/child-session-updates";

export interface AcpSubagentToolCall {
  id: string;
  name: string;
  status: string | undefined;
  rawInput: unknown;
  rawOutput: unknown;
  content: unknown;
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && isRecord(part.content) && isString(part.content.text) ? part.content.text : ""))
    .filter(Boolean)
    .join("\n");
}

function jsonRecord(text: string): DynamicRecord | null {
  if (!text.trim().startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function firstString(record: DynamicRecord | null, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (isString(value) && value.trim()) return value;
  }
  return null;
}

function subagentToolTitle(names: readonly string[], name: string): string | null {
  for (const tool of names) {
    if (name === tool) return "";
    if (name.startsWith(`${tool}: `)) return name.slice(tool.length + 2).trim();
  }
  return null;
}

function resultText(rawOutput: unknown, content: unknown): string {
  if (isString(rawOutput)) return rawOutput;
  const field = isRecord(rawOutput) ? firstString(rawOutput, ["output", "result", "text", "error", "message"]) : null;
  return field ?? contentText(content);
}

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
  if (!existing && (title === null || ended)) return null;
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

interface OpenCodeLaunch {
  title: string;
  prompt: string | null;
  agentType: string | null;
  background: boolean;
}

export type OpenCodeLaunches = Map<string, OpenCodeLaunch>;

const OPENCODE_LAUNCH_LIMIT = 24;

const OPENCODE_STREAM_LIMIT = 2_000;

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

export function markOpenCodeBackground(state: SubagentState, rawOutput: unknown): SubagentChange | null {
  const metadata = isRecord(rawOutput) && isRecord(rawOutput.metadata) ? rawOutput.metadata : null;
  if (metadata?.status !== "running" || !isString(metadata.sessionID)) return null;
  const subagent = subagentFor(state, metadata.sessionID);
  if (!subagent || subagent.background || subagent.status !== "running") return null;
  subagent.background = true;
  return subagentChange(state, state.turnOf.get(subagent.id));
}

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
 * for each chunk. With `lateSteps`, an update of a subagent that already ended still adds its step: Kiro's
 * roster can overtake a session update that the subagent sent before its end.
 */
export function foldOpenCodeChildUpdate(
  state: SubagentState,
  launches: OpenCodeLaunches,
  turnId: string | null,
  params: unknown,
  now: string,
  lateSteps = false,
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
  if (params.type !== "update" || !subagent || !isRecord(params.update)) return null;
  if (subagent.status !== "running" && !lateSteps) return null;
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
  const prefix = `${id}:${kind}:`;
  const stepId = isString(update.messageId)
    ? `${prefix}${update.messageId}`
    : ([...streams.keys()].find((key) => key.startsWith(prefix)) ?? `${prefix}${now}`);
  const previous = streams.get(stepId) ?? "";
  if (previous.length >= OPENCODE_STREAM_LIMIT) return null;
  streams.set(stepId, previous + chunk);
  const started = !subagent.steps.some((step) => step.id === stepId);
  const pushed = pushSubagentStep(subagent, { id: stepId, kind, text: previous + chunk });
  return pushed && started ? subagentChange(state, state.turnOf.get(id)) : null;
}

const KIRO_TITLE_LIMIT = 120;

/** The first line of the task that the parent gave a Kiro subagent, cut to the length of a card title. */
function kiroSubagentTitle(entry: DynamicRecord): string {
  const firstLine = isString(entry.initialQuery)
    ? (entry.initialQuery
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim() ?? "")
    : "";
  const text = firstLine || (isString(entry.sessionName) ? entry.sessionName : "");
  return text.length > KIRO_TITLE_LIMIT ? `${text.slice(0, KIRO_TITLE_LIMIT - 1)}…` : text;
}

/**
 * Applies `_kiro.dev/subagent/list_update` of Kiro CLI 2.37 (engine V2): the whole roster of the
 * subagents of the process, sent at each change, with no parent session. `turnId` is the turn that
 * started them, which only a new subagent needs. A listed subagent that is `working` shows as
 * running, one that is `terminated` ends, and a running subagent that the roster no longer lists
 * ended too: Kiro takes it off the list after `terminated`. The steps of a subagent come from the
 * updates of its own session. One change for each turn that the roster touched.
 */
export function foldKiroSubagentRoster(
  state: SubagentState,
  turnId: string | null,
  params: unknown,
  now: string,
): SubagentChange[] {
  if (!isRecord(params) || !Array.isArray(params.subagents)) return [];
  const touched = new Set<string>();
  const listed = new Set<string>();
  for (const entry of params.subagents) {
    if (!isRecord(entry) || !isString(entry.sessionId) || !entry.sessionId) continue;
    const id = entry.sessionId;
    listed.add(id);
    const type = isRecord(entry.status) ? entry.status.type : undefined;
    const known = subagentFor(state, id);
    if (known) {
      if (type === "terminated" && endSubagent(known, "completed", now)) touched.add(state.turnOf.get(id) ?? "");
      continue;
    }
    if (type !== "working" || !turnId) continue;
    startSubagent(state, turnId, {
      id,
      title: kiroSubagentTitle(entry),
      agentType: isString(entry.agentName) ? entry.agentName : null,
      prompt: isString(entry.initialQuery) ? entry.initialQuery : null,
      status: "running",
      startedAt: now,
      endedAt: null,
      steps: [],
      error: null,
    });
    touched.add(turnId);
  }
  for (const [id, owner] of [...state.turnOf]) {
    if (listed.has(id)) continue;
    const subagent = subagentFor(state, id);
    if (subagent && endSubagent(subagent, "completed", now)) touched.add(owner);
  }
  touched.delete("");
  return [...touched].flatMap((turn) => subagentChange(state, turn) ?? []);
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
