import { Button, Progress } from "@openbot/ui";
import { type Accessor, createSignal } from "solid-js";
import type { AgentProfile } from "../../data";
import { currentText } from "../../text";
import { AgentAvatar } from "./AgentAvatar";

/** How long a deleted agent can be restored. */
export const AGENT_DELETE_UNDO_MS = 8_000;
const TICK_MS = 100;

/** The time to undo. It stops while the pointer or the keyboard focus is on the toast, and while the window is hidden. */
export interface UndoCountdown {
  /** The part of the time that is left, from 1 to 0. */
  readonly left: Accessor<number>;
  hold(source: "pointer" | "focus", held: boolean): void;
  stop(): void;
}

/**
 * Starts the time to undo. The caller owns it and calls `stop()` when the toast settles.
 *
 * The toast cannot count the time itself: sonner renders a toast's content more than once, for
 * example to measure its height, and each copy would get its own timer that the pointer never holds.
 */
export function startUndoCountdown(onExpire: () => void, durationMs = AGENT_DELETE_UNDO_MS): UndoCountdown {
  const [remaining, setRemaining] = createSignal(durationMs);
  const holds = new Set<"pointer" | "focus">();
  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    if (holds.size > 0 || document.hidden) return;
    const next = Math.max(0, remaining() - elapsed);
    setRemaining(next);
    if (next === 0) {
      window.clearInterval(timer);
      onExpire();
    }
  }, TICK_MS);
  return {
    left: () => remaining() / durationMs,
    hold: (source, held) => {
      if (held) holds.add(source);
      else holds.delete(source);
    },
    stop: () => window.clearInterval(timer),
  };
}

interface AgentDeleteUndoToastProps {
  agent: Pick<AgentProfile, "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  countdown: UndoCountdown;
  onUndo: () => void;
}

/**
 * The toast after an agent delete. The bar along the bottom edge shows the time left to undo. Raise it
 * with sonner's own timer off (`duration: Infinity`).
 */
export function AgentDeleteUndoToast(props: AgentDeleteUndoToastProps) {
  // The app's Toaster renders outside the text provider, so `useText()` would always give English.
  const { t } = currentText();

  return (
    <div
      class="agent-delete-undo-toast"
      onPointerEnter={() => props.countdown.hold("pointer", true)}
      onPointerLeave={() => props.countdown.hold("pointer", false)}
      onFocusIn={() => props.countdown.hold("focus", true)}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
          props.countdown.hold("focus", false);
      }}
    >
      <AgentAvatar agent={props.agent} motion="idle" class="agent-delete-undo-toast-avatar" />
      <div class="agent-delete-undo-toast-text">
        <strong class="agent-delete-undo-toast-title">{t("agent.deleteUndo.title", { name: props.agent.name })}</strong>
        {props.agent.title && <span class="agent-delete-undo-toast-detail">{props.agent.title}</span>}
      </div>
      <div class="ui-toast-card-actions agent-delete-undo-toast-actions">
        <Button type="button" variant="default" size="sm" onClick={() => props.onUndo()}>
          {t("agent.deleteUndo.action")}
        </Button>
      </div>
      <Progress
        value={props.countdown.left() * 100}
        minValue={0}
        maxValue={100}
        class="agent-delete-undo-toast-bar"
        aria-hidden="true"
      />
    </div>
  );
}
