import { useEffect, useRef, useState } from "react";

/**
 * One turn is reported by signals that do not overlap. The local send flag clears before the host
 * reports the turn, and the turn ends before the reply's first word is played back, so the
 * indicator would unmount and mount again inside a single turn. Holding the last rows across that
 * gap keeps one avatar on screen for the whole turn instead of a blink.
 */
export const ACTIVITY_HOLD_MS = 260;

export function useActivityPresence<T>(rows: readonly T[], holdMs: number = ACTIVITY_HOLD_MS): readonly T[] {
  const held = useRef(rows);
  const live = rows.length > 0;
  const [released, setReleased] = useState(!live);
  useEffect(() => {
    if (live) held.current = rows;
  });
  useEffect(() => {
    if (live) {
      setReleased(false);
      return;
    }
    const timer = setTimeout(() => setReleased(true), holdMs);
    return () => clearTimeout(timer);
  }, [live, holdMs]);
  return live || released ? rows : held.current;
}
