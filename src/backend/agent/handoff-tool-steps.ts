import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { getArray, getRecord, getString, isRecord } from "../protocol";

/**
 * One turn of an earlier provider session, as `thread/read` returns it. The items stay whole:
 * `decodeThreadResponse` keeps only the fields a transcript needs, and drops the command, output
 * and file paths that a handoff gives to the next provider.
 */
export interface ProviderTurnSteps {
  turnId: string;
  items: DynamicRecord[];
}

/**
 * The ids Claude (`:reasoning`) and the ACP client (`:thought`, then `:thought:<n>` for each later
 * block) give a turn's thinking.
 */
const REASONING_ID = /:(?:reasoning|thought(?::\d+)?)$/u;

/** The most text one step adds, and the end of a command's output that is kept. */
const STEP_LIMIT = 1_000;
const OUTPUT_TAIL = 600;
/** The most text the steps of one turn add. The newest steps are kept. */
const TURN_LIMIT = 4_000;

export function decodeProviderTurns(value: unknown): ProviderTurnSteps[] {
  return getArray(getRecord(value, "thread"), "turns").flatMap((turn) => {
    const turnId = getString(turn, "id");
    return turnId ? [{ turnId, items: getArray(turn, "items").filter(isRecord) }] : [];
  });
}

/**
 * A text field of a step, redacted whole. Redaction runs before any cut: a cut through a secret
 * leaves a part that no rule recognizes.
 */
function field(item: unknown, key: string): string | null {
  const value = getString(item, key);
  return value === null ? null : redactText(value);
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function renderStep(item: DynamicRecord): string | null {
  const status = field(item, "status") ?? "unknown";
  switch (getString(item, "type")) {
    case "commandExecution": {
      const command = field(item, "command");
      if (!command) return null;
      const result = isNumber(item.exitCode) ? `exit ${item.exitCode}` : status;
      const output = field(item, "aggregatedOutput")?.trim();
      const tail = output && output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output;
      return [`$ ${clip(command, STEP_LIMIT - OUTPUT_TAIL)} (${result})`, tail].filter(Boolean).join("\n");
    }
    case "fileChange": {
      const changes = getArray(item, "changes").flatMap((change) => {
        const path = field(change, "path");
        return path ? [`${field(getRecord(change, "kind"), "type") ?? "change"} ${path}`] : [];
      });
      return changes.length > 0 ? `files (${status}): ${clip(changes.join(", "), STEP_LIMIT)}` : null;
    }
    case "mcpToolCall": {
      const tool = field(item, "tool");
      return tool ? `tool ${field(item, "server") ?? "mcp"}/${tool} (${status})` : null;
    }
    case "dynamicToolCall": {
      const tool = field(item, "tool");
      const namespace = field(item, "namespace");
      return tool ? `tool ${namespace ? `${namespace}/` : ""}${tool} (${status})` : null;
    }
    case "toolCall": {
      const name = field(item, "name");
      return name ? `tool ${clip(name, STEP_LIMIT)} (${status})` : null;
    }
    case "webSearch": {
      const query = field(item, "query");
      return query ? `searched: ${clip(query, STEP_LIMIT)}` : null;
    }
    case "agentMessage": {
      // Progress notes between tool calls. Claude's and the ACP agents' thinking come back with the
      // same phase; their ids mark them, and reasoning stays with the provider that produced it.
      const id = getString(item, "id") ?? "";
      if (getString(item, "phase") !== "commentary" || REASONING_ID.test(id)) return null;
      const text = field(item, "text")?.trim();
      return text ? `note: ${clip(text, STEP_LIMIT)}` : null;
    }
    default:
      return null;
  }
}

/**
 * The work one turn did, for a handoff: commands with their exit code and the end of their output,
 * changed files, tool calls, searches and progress notes. Diffs are left out, because the files are
 * on disk in the same workspace. Each field is redacted before it is cut.
 */
export function renderTurnSteps(items: readonly DynamicRecord[]): string | null {
  const steps = items.map(renderStep).filter(isString);
  const kept: string[] = [];
  let size = 0;
  for (const step of steps.toReversed()) {
    if (size + step.length > TURN_LIMIT) break;
    kept.unshift(step);
    size += step.length + 1;
  }
  if (kept.length === 0) return null;
  const omitted = steps.length - kept.length;
  return ["[work steps]", omitted > 0 ? `(${omitted} earlier steps left out)` : null, ...kept, "[end work steps]"]
    .filter(Boolean)
    .join("\n");
}

/** How many of a session's newest turns with work steps a capture keeps. */
const CAPTURED_TURNS = 60;

/**
 * The rendered steps of a session's turns, for the file a capture writes. Only redacted text is
 * written: the raw output and diffs stay with the provider. A session with no steps gives `{}`, so
 * the handoff does not start its provider again to read the same nothing.
 */
export function encodeCapturedSteps(turns: readonly ProviderTurnSteps[]): string {
  const steps = turns.flatMap((turn) => {
    const rendered = renderTurnSteps(turn.items);
    return rendered ? [[turn.turnId, rendered] as const] : [];
  });
  return JSON.stringify(Object.fromEntries(steps.slice(-CAPTURED_TURNS)));
}

export function decodeCapturedSteps(text: string): Map<string, string> {
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("Invalid captured work steps.");
  return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => isString(entry[1])));
}
