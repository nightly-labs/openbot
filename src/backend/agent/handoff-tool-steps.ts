import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentClient } from "../agent-client";
import { getArray, getRecord, getString, isRecord } from "../protocol";
import { providerFailure, providerSync } from "../provider-client-effects";

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

/** How many of a session's newest turns with work steps a capture keeps. */
const CAPTURED_TURNS = 60;

/** Keep only rendered steps, never the provider's full tool results. */
export const readCapturedSteps = Effect.fn("ProviderHistory.readCapturedSteps")(function* (
  client: AgentClient,
  threadId: string,
) {
  if (!client.readHistory) return yield* providerFailure(new Error("Provider history reader is unavailable."));
  const captured = new Map<string, string>();
  let kept: string[] = [];
  let size = 0;
  let omitted = 0;
  yield* client.readHistory({ threadId, items: "full" }, (fragment) =>
    providerSync(() => {
      for (const item of fragment.items) {
        const step = renderStep(item);
        if (!step) continue;
        kept.push(step);
        size += step.length + 1;
        while (size > TURN_LIMIT - 100 && kept.length) {
          size -= (kept.shift()?.length ?? 0) + 1;
          omitted += 1;
        }
      }
      if (fragment.complete) {
        if (kept.length) {
          captured.set(
            fragment.turnId,
            [
              "[work steps]",
              ...(omitted ? [`(${omitted} earlier steps left out)`] : []),
              ...kept,
              "[end work steps]",
            ].join("\n"),
          );
        }
        kept = [];
        size = 0;
        omitted = 0;
      }
      return captured.size < CAPTURED_TURNS;
    }),
  );
  return captured;
});

export function decodeCapturedSteps(text: string): Map<string, string> {
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("Invalid captured work steps.");
  return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => isString(entry[1])));
}
