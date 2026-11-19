import { createContext, useContext } from "react";

export const HistoryShownContext = createContext(true);

export function useHistoryShown(): boolean {
  return useContext(HistoryShownContext);
}
