import { createContext, useContext, useEffect, useState } from "react";

export const KeptOpenContext = createContext<Map<string, boolean> | null>(null);

export function useKeptOpen(key: string, initial: boolean) {
  const kept = useContext(KeptOpenContext);
  const state = useState(() => kept?.get(key) ?? initial);
  const [open] = state;
  useEffect(() => {
    if (kept && (open !== initial || kept.has(key))) kept.set(key, open);
  }, [kept, key, open, initial]);
  return state;
}
