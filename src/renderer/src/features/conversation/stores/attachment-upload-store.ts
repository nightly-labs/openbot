import type { AttachmentImportFile } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import { composerDraftKey } from "../conversation-keys";
import type { ConversationTarget } from "../conversation-types";

/** A file import that the composer shows from the pick until the files reach the draft. */
export interface AttachmentUpload {
  requestId: string;
  target: ConversationTarget;
  files: AttachmentImportFile[];
  /** The bytes the server confirmed. Null until the transport reports them; some never do. */
  sent: number | null;
  /** Why the import failed. Null while it runs. A failed import stays until Retry or remove. */
  error: string | null;
}

/**
 * The imports of each chat that have not landed, in pick order. They live in memory only: an import
 * does not outlive the window that started it.
 */
export function createAttachmentUploadStore() {
  const [state, setState] = createStore<{ uploads: AttachmentUpload[] }>({ uploads: [] });
  const find = (requestId: string) => state.uploads.find((upload) => upload.requestId === requestId);

  return {
    list: (key: string) => state.uploads.filter((upload) => composerDraftKey(upload.target) === key),
    get: find,
    /** A failed import blocks Send in its chat: the user meant to send the file. */
    hasFailed: (key: string) =>
      state.uploads.some((upload) => upload.error !== null && composerDraftKey(upload.target) === key),
    /** Adds an import, or runs a failed one again under the same id. */
    start(requestId: string, target: ConversationTarget, files: AttachmentImportFile[]) {
      setState((draft) => {
        const upload = draft.uploads.find((candidate) => candidate.requestId === requestId);
        if (upload) {
          upload.sent = null;
          upload.error = null;
        } else draft.uploads.push({ requestId, target, files, sent: null, error: null });
      });
    },
    progress(requestId: string, sent: number) {
      setState((draft) => {
        const upload = draft.uploads.find((candidate) => candidate.requestId === requestId);
        if (upload) upload.sent = sent;
      });
    },
    fail(requestId: string, error: string) {
      setState((draft) => {
        const upload = draft.uploads.find((candidate) => candidate.requestId === requestId);
        if (upload) upload.error = error;
      });
    },
    remove(requestId: string) {
      setState((draft) => {
        draft.uploads = draft.uploads.filter((upload) => upload.requestId !== requestId);
      });
    },
  };
}
