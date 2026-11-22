import type { AgentMessage } from "@openbot/ui/data";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

const STALE_STREAM_MS = 3_000;

export function heldWhileWritten(message: AgentMessage): boolean {
  return (
    message.author === "agent" &&
    message.streaming === true &&
    message.kind === "text" &&
    !message.imageGeneration &&
    !message.videoGeneration
  );
}

export function createTurnStreamHold(
  activeTurnId: () => string | null | undefined,
): (message: AgentMessage) => boolean {
  const [endingTurnIds, setEndingTurnIds] = createSignal<ReadonlySet<string>>(new Set<string>());
  const endingTimers = new Set<ReturnType<typeof setTimeout>>();
  let lastTurnId = untrack(activeTurnId) ?? undefined;
  createEffect(activeTurnId, (turnId) => {
    const ended = lastTurnId;
    lastTurnId = turnId ?? undefined;
    if (!ended || ended === turnId) return;
    setEndingTurnIds((ids) => new Set(ids).add(ended));
    const timer = setTimeout(() => {
      endingTimers.delete(timer);
      setEndingTurnIds((ids) => new Set([...ids].filter((id) => id !== ended)));
    }, STALE_STREAM_MS);
    endingTimers.add(timer);
  });
  onCleanup(() => {
    for (const timer of endingTimers) clearTimeout(timer);
  });
  return (message) =>
    heldWhileWritten(message) &&
    (message.turnId === undefined
      ? Boolean(activeTurnId()) || endingTurnIds().size > 0
      : message.turnId === activeTurnId() || endingTurnIds().has(message.turnId));
}
