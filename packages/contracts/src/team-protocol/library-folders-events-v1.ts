import { isDynamicRecord } from "../runtime-values";

export const LIBRARY_FOLDERS_EVENTS_CAPABILITY = "library-folders-events-v1";

export type LibraryFoldersEvent = { type: "library-folders-changed" };

export function libraryFoldersEvent(value: unknown): LibraryFoldersEvent | null {
  if (!isDynamicRecord(value) || value.type !== "library-folders-changed") return null;
  return { type: "library-folders-changed" };
}
