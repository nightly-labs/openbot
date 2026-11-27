import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";

export const ENTRANCE_FRESH_MS = 3000;

export interface ArrivalSnapshot {
  agentId: string;
  messages: readonly ChatMessage[];
  enabled: boolean;
  arriving: ReadonlySet<string>;
  arrivedAt: ReadonlyMap<string, number>;
  entered: Set<string>;
}

export interface ArrivalEntrances {
  fresh: (id: string) => boolean;
  played: (id: string) => void;
}

export function firstArrivals(agentId: string, messages: readonly ChatMessage[], enabled: boolean): ArrivalSnapshot {
  return { agentId, messages, enabled, arriving: new Set(), arrivedAt: new Map(), entered: new Set() };
}

export function nextArrivals(
  snapshot: ArrivalSnapshot,
  agentId: string,
  messages: readonly ChatMessage[],
  enabled: boolean,
  now: number,
): ArrivalSnapshot {
  if (snapshot.agentId === agentId && snapshot.enabled === enabled && snapshot.messages === messages) return snapshot;
  const sameAgent = snapshot.agentId === agentId;
  const arriving = new Set<string>();
  if (enabled && snapshot.enabled && sameAgent) {
    const previous = snapshot.messages;
    let byId: Map<string, ChatMessage> | undefined;
    const previousThinking = previous.findLast((item) => item.kind === "thinking");
    const newestStep = previousThinking?.kind === "thinking" ? previousThinking.steps.at(-1)?.id : undefined;
    const previousTail = previous.at(-1)?.id;
    const tailIndex = !previousTail
      ? -1
      : messages[previous.length - 1]?.id === previousTail
        ? previous.length - 1
        : messages.findIndex((message) => message.id === previousTail);
    for (const [index, message] of messages.entries()) {
      let old = previous[index];
      if (old?.id !== message.id) {
        if (!byId) byId = new Map(previous.map((item) => [item.id, item]));
        old = byId.get(message.id);
      }
      if (
        snapshot.arriving.has(message.id) ||
        (old?.kind === "message" && old.streaming && message.kind === "message" && message.status === "completed") ||
        ((previous.length === 0 || (tailIndex >= 0 && index > tailIndex)) && !old) ||
        (!old && message.kind === "message" && message.progress && message.id === newestStep)
      )
        arriving.add(message.id);
    }
  }
  const kept =
    arriving.size === snapshot.arriving.size && [...arriving].every((id) => snapshot.arriving.has(id))
      ? snapshot.arriving
      : arriving;
  const arrivedAt = new Map<string, number>();
  for (const id of kept) arrivedAt.set(id, (sameAgent ? snapshot.arrivedAt.get(id) : undefined) ?? now);
  return {
    agentId,
    messages,
    enabled,
    arriving: kept,
    arrivedAt,
    entered: sameAgent ? snapshot.entered : new Set(),
  };
}

export function entranceFresh(snapshot: ArrivalSnapshot, id: string, now: number): boolean {
  if (!snapshot.arriving.has(id) || snapshot.entered.has(id)) return false;
  const at = snapshot.arrivedAt.get(id);
  return at !== undefined && now - at < ENTRANCE_FRESH_MS;
}

export function useMessageArrivals(agentId: string, messages: ChatMessage[], enabled: boolean) {
  const kept = useRef<ArrivalSnapshot | null>(null);
  const snapshot = kept.current
    ? nextArrivals(kept.current, agentId, messages, enabled, Date.now())
    : firstArrivals(agentId, messages, enabled);
  kept.current = snapshot;
  const entrances = useMemo<ArrivalEntrances>(
    () => ({
      fresh: (id) => (kept.current ? entranceFresh(kept.current, id, Date.now()) : false),
      played: (id) => {
        kept.current?.entered.add(id);
      },
    }),
    [],
  );
  return { arriving: snapshot.arriving, entrances };
}

export const ArrivalEntrancesContext = createContext<ArrivalEntrances | null>(null);

export function useArrivalEntrance(id: string, arriving: boolean): boolean {
  const entrances = useContext(ArrivalEntrancesContext);
  const [entrance] = useState(() => arriving && (entrances?.fresh(id) ?? false));
  useEffect(() => {
    if (entrance) entrances?.played(id);
  }, [entrance, entrances, id]);
  return entrance;
}
