import { createSignal } from "solid-js";

export type SkillSuggestionPress = "pending" | "sent" | "saved";

export interface SkillSuggestionPressKey {
  serverId: string;
  agentId: string;
  messageId: string;
}

const MAX_PRESSES = 200;

const [presses, setPresses] = createSignal<ReadonlyMap<string, SkillSuggestionPress>>(new Map());

function pressId(key: SkillSuggestionPressKey): string {
  return JSON.stringify([key.serverId, key.agentId, key.messageId]);
}

export function skillSuggestionPress(key: SkillSuggestionPressKey): SkillSuggestionPress | null {
  return presses().get(pressId(key)) ?? null;
}

export function setSkillSuggestionPress(key: SkillSuggestionPressKey, press: SkillSuggestionPress | null): void {
  const id = pressId(key);
  const next = new Map(presses());
  next.delete(id);
  if (press) next.set(id, press);
  for (const oldest of next.keys()) {
    if (next.size <= MAX_PRESSES) break;
    next.delete(oldest);
  }
  setPresses(next);
}
