import type { AgentContextCategory, AgentContextCategoryUsage } from "@openbot/contracts/ipc";
import { Option, Schema } from "effect";

const Count = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const ClaudeContextUsage = Schema.Struct({
  totalTokens: Count,
  categories: Schema.Array(
    Schema.Struct({ name: Schema.String, tokens: Count, isDeferred: Schema.optional(Schema.Boolean) }),
  ),
  messageBreakdown: Schema.optional(Schema.Struct({ toolCallTokens: Count, toolResultTokens: Count })),
});

const CATEGORY_BY_NAME: Readonly<Record<string, AgentContextCategory>> = {
  "System prompt": "systemPrompt",
  "Memory files": "memoryFiles",
  "System tools": "tools",
  "MCP tools": "tools",
  Skills: "skills",
  "Custom agents": "skills",
  Messages: "messages",
};

export function claudeContextCategories(usage: unknown): AgentContextCategoryUsage[] | undefined {
  const decoded = Schema.decodeUnknownOption(ClaudeContextUsage)(usage);
  if (Option.isNone(decoded)) return undefined;
  const { totalTokens, categories, messageBreakdown } = decoded.value;
  const tokens = new Map<AgentContextCategory, number>();
  for (const row of categories) {
    const category = row.isDeferred ? undefined : CATEGORY_BY_NAME[row.name];
    if (category) tokens.set(category, (tokens.get(category) ?? 0) + row.tokens);
  }
  const excess = [...tokens.values()].reduce((sum, value) => sum + value, 0) - totalTokens;
  const messages = (tokens.get("messages") ?? 0) - Math.max(0, excess);
  if (messages < 0) return undefined;
  if (tokens.has("messages")) tokens.set("messages", messages);
  const toolResults = Math.min(
    messages,
    (messageBreakdown?.toolCallTokens ?? 0) + (messageBreakdown?.toolResultTokens ?? 0),
  );
  if (toolResults > 0) {
    tokens.set("toolResults", toolResults);
    tokens.set("messages", messages - toolResults);
  }
  if (excess < 0) tokens.set("other", -excess);
  return [...tokens].filter(([, value]) => value > 0).map(([category, value]) => ({ category, tokens: value }));
}
