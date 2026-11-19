import { useEffect, useRef, useState } from "react";

const ACTIVITY_HOLD_MS = 260;

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
