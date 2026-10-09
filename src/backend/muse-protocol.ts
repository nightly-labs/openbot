import { Schema } from "effect";
import type { ThreadItem } from "./protocol";

const text = Schema.String;
export const MuseItem = Schema.Struct({
  itemId: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  revision: Schema.Int,
  status: text,
  turnId: Schema.optional(Schema.NullOr(text)),
  text: Schema.optional(text),
  summary: Schema.optional(Schema.Array(text)),
  tool: Schema.optional(text),
  args: Schema.optional(text),
  visibleOutput: Schema.optional(text),
  commandText: Schema.optional(text),
  exitCode: Schema.optional(Schema.Int),
  failureReason: Schema.optional(text),
  outcome: Schema.optional(text),
});
export type MuseItem = typeof MuseItem.Type;
export const MuseSession = Schema.Struct({
  session: Schema.Struct({ sessionId: Schema.NonEmptyString }),
  history: Schema.optional(
    Schema.Struct({
      mode: text,
      items: Schema.NullOr(Schema.Array(MuseItem)),
      snapshot: Schema.NullOr(
        Schema.Struct({ schemaVersion: Schema.Int, state: Schema.Struct({ items: Schema.Array(MuseItem) }) }),
      ),
    }),
  ),
});
export const MusePage = Schema.Struct({
  events: Schema.Array(Schema.Struct({ method: text, params: Schema.Record(text, Schema.Unknown) })),
  nextCursor: Schema.NullOr(text),
});
export const MuseModels = Schema.Struct({
  providerId: text,
  models: Schema.Array(
    Schema.Struct({
      modelId: text,
      displayLabel: text,
      providerId: text,
      variants: Schema.optional(Schema.Union([Schema.Array(text), Schema.Literal("unknown")])),
      defaultReasoningEffort: Schema.optional(text),
    }),
  ),
});
export const MuseApproval = Schema.Struct({
  approvalId: text,
  currentRequirementId: Schema.Struct({ approvalId: text, sourceIndex: Schema.Int }),
  availableChoices: Schema.Array(Schema.Struct({ choiceId: text, decision: text, scope: text })),
  subject: Schema.Struct({ kind: text, command: Schema.optional(text), path: Schema.optional(text) }),
});
export const MuseUsage = Schema.Struct({
  turnId: text,
  cumulative: Schema.Struct({
    promptTokens: Schema.Number,
    totalTokens: Schema.Number,
    outputTokens: Schema.Number,
    cacheReadTokens: Schema.optional(Schema.Number),
    cacheWriteTokens: Schema.optional(Schema.Number),
  }),
});
export const MuseTerminal = Schema.Struct({
  turnId: text,
  terminal: text,
  reason: Schema.optional(text),
  error: Schema.optional(Schema.Struct({ message: text })),
});
export const MuseUserInput = Schema.Struct({
  userInputId: text,
  questions: Schema.Array(
    Schema.Struct({
      id: text,
      header: text,
      question: text,
      options: Schema.Array(Schema.Struct({ label: text, description: Schema.optional(text) })),
      selection: Schema.Struct({ mode: Schema.Literals(["single", "multiple"]) }),
    }),
  ),
});

/** Converts a native item without exposing raw provider arguments as diagnostic text. */
export function museThreadItem(item: MuseItem): ThreadItem {
  const common = { id: item.itemId, status: item.status };
  switch (item.kind) {
    case "agentMessage":
      return { ...common, type: "agentMessage", text: item.text ?? "" };
    case "userMessage":
      return { ...common, type: "userMessage", content: [{ type: "inputText", text: item.text ?? "" }] };
    case "reasoning":
      return {
        ...common,
        type: "reasoning",
        summary: (item.summary ?? []).map((value) => ({ type: "summaryText", text: value })),
      };
    case "userShell":
    case "commandExecution":
      return {
        ...common,
        type: "commandExecution",
        command: item.commandText ?? "",
        aggregatedOutput: item.visibleOutput ?? "",
        exitCode: item.exitCode ?? null,
      };
    case "compaction":
      return { ...common, type: "contextCompaction" };
    default:
      return {
        ...common,
        type: "mcpToolCall",
        server: "muse",
        tool: item.tool ?? item.kind,
        arguments: item.args ?? "",
        result: item.visibleOutput ?? item.text ?? "",
        error: item.failureReason ?? null,
      };
  }
}
