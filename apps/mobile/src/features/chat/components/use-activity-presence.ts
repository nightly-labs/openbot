import { useEffect, useRef, useState } from "react";

const ACTIVITY_HOLD_MS = 260;
const NO_ROWS: readonly never[] = [];

export function useActivityPresence<T>(
  rows: readonly T[],
  enterLater = false,
  holdMs: number = ACTIVITY_HOLD_MS,
): readonly T[] {
  const held = useRef(rows);
  const drawn = useRef(false);
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
  const presented = live || released ? rows : held.current;
  const shown = enterLater && !drawn.current ? NO_ROWS : presented;
  useEffect(() => {
    drawn.current = shown.length > 0;
  });
  return shown;
}
