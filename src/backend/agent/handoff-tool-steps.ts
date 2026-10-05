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

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function renderStep(item: DynamicRecord): string | null {
  const status = getString(item, "status") ?? "unknown";
  switch (getString(item, "type")) {
    case "commandExecution": {
      const command = getString(item, "command");
      if (!command) return null;
      const result = isNumber(item.exitCode) ? `exit ${item.exitCode}` : status;
      const output = getString(item, "aggregatedOutput")?.trim();
      const tail = output && output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output;
      return [`$ ${clip(command, STEP_LIMIT - OUTPUT_TAIL)} (${result})`, tail].filter(Boolean).join("\n");
    }
    case "fileChange": {
      const changes = getArray(item, "changes").flatMap((change) => {
        const path = getString(change, "path");
        return path ? [`${getString(getRecord(change, "kind"), "type") ?? "change"} ${path}`] : [];
      });
      return changes.length > 0 ? `files (${status}): ${clip(changes.join(", "), STEP_LIMIT)}` : null;
    }
    case "mcpToolCall": {
      const tool = getString(item, "tool");
      return tool ? `tool ${getString(item, "server") ?? "mcp"}/${tool} (${status})` : null;
    }
    case "dynamicToolCall": {
      const tool = getString(item, "tool");
      const namespace = getString(item, "namespace");
      return tool ? `tool ${namespace ? `${namespace}/` : ""}${tool} (${status})` : null;
    }
    case "toolCall": {
      const name = getString(item, "name");
      return name ? `tool ${clip(name, STEP_LIMIT)} (${status})` : null;
    }
    case "webSearch": {
      const query = getString(item, "query");
      return query ? `searched: ${clip(query, STEP_LIMIT)}` : null;
    }
    case "agentMessage": {
      // Progress notes between tool calls. Claude's thinking is restored with the same phase; its
      // id marks it, and reasoning stays with the provider that produced it.
      const text = getString(item, "text")?.trim();
      if (getString(item, "phase") !== "commentary" || !text) return null;
      return getString(item, "id")?.endsWith(":reasoning") ? null : `note: ${clip(text, STEP_LIMIT)}`;
    }
    default:
      return null;
  }
}

/**
 * The work one turn did, for a handoff: commands with their exit code and the end of their output,
 * changed files, tool calls, searches and progress notes. Diffs are left out, because the files are
 * on disk in the same workspace. Registered secrets and known credential shapes are redacted.
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
  return redactText(
    ["[work steps]", omitted > 0 ? `(${omitted} earlier steps left out)` : null, ...kept, "[end work steps]"]
      .filter(Boolean)
      .join("\n"),
  );
}
