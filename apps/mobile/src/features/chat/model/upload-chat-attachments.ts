import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { ChatMessage } from "./chat-messages";

/** Keep the ordered draft IDs together until send commits them to one message. */
export async function uploadChatAttachments(
  files: RemoteFileUpload[],
  actions: {
    upload: (file: RemoteFileUpload) => Promise<{ id: string }>;
    discard: (id: string) => Promise<void>;
    send: (ids: string[]) => Promise<string>;
    cancelled?: () => boolean;
    progress?: (completed: number) => void;
  },
): Promise<string> {
  const ids: string[] = [];
  try {
    actions.progress?.(0);
    for (const file of files) {
      if (actions.cancelled?.()) throw new Error("Attachment upload cancelled.");
      ids.push((await actions.upload(file)).id);
      actions.progress?.(ids.length);
    }
    if (actions.cancelled?.()) throw new Error("Attachment upload cancelled.");
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
