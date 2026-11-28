import { AGENT_CONTEXT_CATEGORIES, type AgentContextCategory, type AgentContextState } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export interface ContextUsageView {
  usedTokens: number;
  windowTokens: number;
  autoCompactAt: number | null;
  nativeManaged: boolean;
  estimated: boolean;
  sizeUnknown: boolean;
  compacting: boolean;
  lastCompaction: { beforeTokens: number; afterTokens: number } | null;
  categories: readonly { category: AgentContextCategory; tokens: number }[];
}

export function contextUsageView(state: AgentContextState | undefined): ContextUsageView | undefined {
  if (!state) return undefined;
  const { usage, compaction } = state;
  if (!usage)
    return compaction === null || compaction.status === "running"
      ? {
          usedTokens: 0,
          windowTokens: 0,
          autoCompactAt: null,
          nativeManaged: false,
          estimated: false,
          sizeUnknown: true,
          compacting: compaction !== null,
          lastCompaction: null,
          categories: [],
        }
      : undefined;
  return {
    usedTokens: usage.usedTokens,
    windowTokens: usage.windowTokens,
    autoCompactAt: usage.autoCompactAt,
    nativeManaged: usage.nativeManaged,
    estimated: usage.estimated ?? false,
    sizeUnknown: false,
    compacting: compaction?.status === "running",
    lastCompaction:
      compaction?.status === "completed" &&
      compaction.beforeTokens !== undefined &&
      compaction.afterTokens !== undefined
        ? { beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens }
        : null,
    categories: usage.categories ?? [],
  };
}

export function usedShare(usage: ContextUsageView): number {
  return usage.windowTokens > 0 ? Math.min(1, Math.max(0, usage.usedTokens / usage.windowTokens)) : 0;
}

export type ContextMeterLevel = "quiet" | "normal" | "warning" | "danger";

export function contextMeterLevel(usage: ContextUsageView): ContextMeterLevel {
  const share = usedShare(usage);
  if (!usage.nativeManaged && usage.autoCompactAt === null && share >= 0.9) return "danger";
  if (share >= (usage.autoCompactAt ?? 0.9) - 0.1) return "warning";
  return share < 0.5 ? "quiet" : "normal";
}

export function canCompact(usage: ContextUsageView): boolean {
  return usage.sizeUnknown || usage.autoCompactAt !== null;
}

export const CONTEXT_CATEGORY_LABEL = {
  systemPrompt: "mobile.chat.context.category.systemPrompt",
  memoryFiles: "mobile.chat.context.category.memoryFiles",
  tools: "mobile.chat.context.category.tools",
  skills: "mobile.chat.context.category.skills",
  toolResults: "mobile.chat.context.category.toolResults",
  messages: "mobile.chat.context.category.messages",
  other: "mobile.chat.context.category.other",
} as const satisfies Record<AgentContextCategory, MobileTextKey>;

export function contextCategoryRows(usage: ContextUsageView): { category: AgentContextCategory; tokens: number }[] {
  return AGENT_CONTEXT_CATEGORIES.flatMap((category) => {
    const tokens = usage.categories.find((row) => row.category === category)?.tokens ?? 0;
    return tokens > 0 ? [{ category, tokens }] : [];
  });
}
