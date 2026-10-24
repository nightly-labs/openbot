import { createContext, useContext } from "react";

/**
 * False while a chat opens and its history is still hidden. The list provides it. Rows wait with
 * parts that take time to start and that the reader cannot see yet, such as web views, audio files
 * and action icons, so the history shows sooner. Outside a chat list it is always true.
 */
export const HistoryShownContext = createContext(true);

export function useHistoryShown(): boolean {
  return useContext(HistoryShownContext);
}
