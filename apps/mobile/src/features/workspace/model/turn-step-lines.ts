import type { ConversationMessage } from "@openbot/contracts/ipc";

export interface TurnStepLine {
  id: string;
  text: string;
  after: string | null;
}

export type TurnStepLines = Readonly<Record<string, readonly TurnStepLine[]>>;

const TURN_LIMIT = 50;
const LINE_LIMIT = 200;

export function appendTurnStepLine(
  lines: TurnStepLines,
  turnId: string,
  text: string,
  after: string | null,
): TurnStepLines {
  const turn = lines[turnId] ?? [];
  const last = turn.at(-1);
  if (!text.trim() || last?.text === text) return lines;
  const sequence = last ? Number(last.id.slice(last.id.lastIndexOf(":") + 1)) + 1 : 0;
  const next: Record<string, readonly TurnStepLine[]> = { ...lines };
  delete next[turnId];
  next[turnId] = [...turn, { id: `${turnId}:${sequence}`, text, after }].slice(-LINE_LIMIT);
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}

export function isTurnThought(message: ConversationMessage): boolean {
  return message.author === "assistant" && message.itemType === "commentary" && Boolean(message.text.trim());
}

export function latestThoughtId(messages: readonly ConversationMessage[], turnId: string): string | null {
  return messages.findLast((message) => message.turnId === turnId && isTurnThought(message))?.id ?? null;
}
