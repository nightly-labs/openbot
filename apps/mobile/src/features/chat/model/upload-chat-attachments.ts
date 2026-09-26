import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { ChatMessage } from "./chat-messages";

/** The user cancelled the upload. A caller that shows the error uses `mobile.chat.upload.cancelled`. */
export class ChatUploadCancelledError extends Error {
  constructor() {
    super("Attachment upload cancelled.");
  }
}

/** Keep the ordered draft IDs together until send commits them to one message. */
export async function uploadChatAttachments<T extends RemoteFileUpload>(
  files: T[],
  actions: {
    upload: (file: T, onProgress: (fraction: number) => void) => Promise<{ id: string }>;
    discard: (id: string) => Promise<void>;
    send: (ids: string[]) => Promise<string>;
    cancelled?: () => boolean;
    progress?: (completed: number) => void;
    /** The sent fraction of the file uploading now, which is file number `completed`. */
    fileProgress?: (fraction: number) => void;
  },
): Promise<string> {
  const ids: string[] = [];
  try {
    actions.progress?.(0);
    for (const file of files) {
      if (actions.cancelled?.()) throw new ChatUploadCancelledError();
      actions.fileProgress?.(0);
      ids.push((await actions.upload(file, (fraction) => actions.fileProgress?.(fraction))).id);
      actions.progress?.(ids.length);
    }
    if (actions.cancelled?.()) throw new ChatUploadCancelledError();
    return await actions.send(ids);
  } catch (error) {
    await Promise.allSettled(ids.map(actions.discard));
    throw error;
  }
}

/** The host replaces upload draft IDs when it commits a message, preserving file order. */
export function retainConfirmedAttachments(
  messages: ChatMessage[],
  receiptId: string,
  files: (RemoteFileUpload & { uri?: string })[],
  retain: (id: string, file: RemoteFileUpload & { localUri?: string }) => void,
): boolean {
  const message = messages.find((candidate) => candidate.id === receiptId);
  if (!message || message.kind !== "message") return false;
  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    const file = files[index];
    if (file)
      retain(attachment.id, { name: file.name, mimeType: file.mimeType, base64: file.base64, localUri: file.uri });
  }
  return true;
}
