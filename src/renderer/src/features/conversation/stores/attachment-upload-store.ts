import type { AttachmentImportFile } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import { composerDraftKey } from "../conversation-keys";
import type { ConversationTarget } from "../conversation-types";

export interface AttachmentUpload {
  requestId: string;
  target: ConversationTarget;
  files: AttachmentImportFile[];
  sent: number | null;
  error: string | null;
}

export function createAttachmentUploadStore() {
  const [state, setState] = createStore<{ uploads: AttachmentUpload[] }>({ uploads: [] });
  const find = (requestId: string) => state.uploads.find((upload) => upload.requestId === requestId);

  return {
    list: (key: string) => state.uploads.filter((upload) => composerDraftKey(upload.target) === key),
    get: find,
    hasFailed: (key: string) =>
      state.uploads.some((upload) => upload.error !== null && composerDraftKey(upload.target) === key),
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
