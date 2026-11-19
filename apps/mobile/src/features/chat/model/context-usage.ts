import { AGENT_CONTEXT_CATEGORIES, type AgentContextCategory, type AgentContextState } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";

/** The meter's view of a chat's context state, as `contextUsageView` on the desktop. */
export interface ContextUsageView {
  usedTokens: number;
  windowTokens: number;
  /** The share of the window (0-1) at which the chat compacts without a request. Null when nothing does. */
  autoCompactAt: number | null;
  nativeManaged: boolean;
  estimated: boolean;
  compacting: boolean;
  lastCompaction: { beforeTokens: number; afterTokens: number } | null;
  categories: readonly { category: AgentContextCategory; tokens: number }[];
}

/** Undefined when the provider of the chat reported no usage: then the composer shows no ring. */
export function contextUsageView(state: AgentContextState | undefined): ContextUsageView | undefined {
  const usage = state?.usage;
  if (!usage) return undefined;
  const compaction = state.compaction;
  return {
    usedTokens: usage.usedTokens,
    windowTokens: usage.windowTokens,
    autoCompactAt: usage.autoCompactAt,
    nativeManaged: usage.nativeManaged,
    estimated: usage.estimated ?? false,
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

/**
 * As on the desktop: below half the window the ring is as quiet as the other controls. It takes the
 * warning colour 10 points before the compaction point, and the danger colour only when nothing will
 * compact the chat and it is nearly full.
 */
export function contextMeterLevel(usage: ContextUsageView): ContextMeterLevel {
  const share = usedShare(usage);
  if (!usage.nativeManaged && usage.autoCompactAt === null && share >= 0.9) return "danger";
  if (share >= (usage.autoCompactAt ?? 0.9) - 0.1) return "warning";
  return share < 0.5 ? "quiet" : "normal";
}

/** Compact now acts only on a chat that OpenBot compacts, as on the desktop. */
export function canCompact(usage: ContextUsageView): boolean {
  return usage.autoCompactAt !== null;
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

/** The rows with tokens, in the fixed order that also gives each its colour. */
export function contextCategoryRows(usage: ContextUsageView): { category: AgentContextCategory; tokens: number }[] {
  return AGENT_CONTEXT_CATEGORIES.flatMap((category) => {
    const tokens = usage.categories.find((row) => row.category === category)?.tokens ?? 0;
    return tokens > 0 ? [{ category, tokens }] : [];
  });
}
