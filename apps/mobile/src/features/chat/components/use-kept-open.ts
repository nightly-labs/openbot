import { createContext, useContext, useEffect, useState } from "react";

/**
 * The open or closed state of the rows that the reader toggled, by row. The chat list provides one
 * map for each chat. The list renders only the rows near the view, so a row that scrolls out and
 * back in mounts again: without the map it came back in its first state, at another height than
 * the list kept for it, and moved the rows around it.
 */
export const KeptOpenContext = createContext<Map<string, boolean> | null>(null);

/**
 * `useState` for the open state of a chat row. `key` names the row in its chat. Outside a chat list
 * it is a plain state.
 */
export function useKeptOpen(key: string, initial: boolean) {
  const kept = useContext(KeptOpenContext);
  const state = useState(() => kept?.get(key) ?? initial);
  const [open] = state;
  useEffect(() => {
    // A row that stays in its first state adds nothing to the map.
    if (kept && (open !== initial || kept.has(key))) kept.set(key, open);
  }, [kept, key, open, initial]);
  return state;
}
