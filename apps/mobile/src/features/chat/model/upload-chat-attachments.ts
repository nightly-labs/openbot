import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { ChatMessage } from "./chat-messages";

export class ChatUploadCancelledError extends Error {
  constructor() {
    super("Attachment upload cancelled.");
  }
}

export async function uploadChatAttachments<T extends RemoteFileUpload, R = string>(
  files: T[],
  actions: {
    upload: (file: T, onProgress: (fraction: number) => void) => Promise<{ id: string }>;
    discard: (id: string) => Promise<void>;
    send: (ids: string[]) => Promise<R>;
    cancelled?: () => boolean;
    progress?: (completed: number) => void;
    fileProgress?: (fraction: number) => void;
  },
): Promise<R> {
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
    if (actions.cancelled?.()) throw new ChatUploadCancelledError();
    throw error;
  }
}

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
    if (file && !file.file)
      retain(attachment.id, { name: file.name, mimeType: file.mimeType, base64: file.base64, localUri: file.uri });
  }
  return true;
}
