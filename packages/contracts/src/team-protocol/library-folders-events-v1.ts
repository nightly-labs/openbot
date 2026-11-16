// Frozen optional library-folders-events-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host tells each client
// that negotiated the capability that its Library folders changed, so the client reads them again.
// A change is each change of a folder or of the folder of a file: from a member, from an agent that
// saves a file into a folder, and from the host when it removes the folders of a deleted agent or the
// entries of deleted files. The event carries no data: the folders stay behind the
// `library-folders-v1` read route, which gives each member only what they can see. Widening any of it
// needs a second capability.
import { isDynamicRecord } from "../runtime-values";

export const LIBRARY_FOLDERS_EVENTS_CAPABILITY = "library-folders-events-v1";

export type LibraryFoldersEvent = { type: "library-folders-changed" };

/** The Library folders event in `value`, or null for any other event. */
export function libraryFoldersEvent(value: unknown): LibraryFoldersEvent | null {
  if (!isDynamicRecord(value) || value.type !== "library-folders-changed") return null;
  return { type: "library-folders-changed" };
}
