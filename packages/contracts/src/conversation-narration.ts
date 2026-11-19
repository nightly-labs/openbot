import type { AgentProviderRef } from "./agent-providers";

const NARRATION_ITEM_ID = /:(?:narration:\d+|assistant(?::\d+)?|text:\d+)$/u;

const CODEX_MESSAGE_ITEM_ID = /^msg_[0-9a-f]+$/u;

export function isNarrationItemId(id: string | undefined, provider: AgentProviderRef | undefined): boolean {
  if (id === undefined) return false;
  if (NARRATION_ITEM_ID.test(id)) return true;
  return provider === "codex" && CODEX_MESSAGE_ITEM_ID.test(id);
}

const CONTENT_CHARACTER = /[\p{L}\p{N}]/gu;

export function showsNarration(text: string, shown: Set<string>): boolean {
  const key = text.replace(/\s+/gu, " ").trim();
  if ((key.match(CONTENT_CHARACTER)?.length ?? 0) < 2 || shown.has(key)) return false;
  shown.add(key);
  return true;
}
