import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";

/** Keep the ordered draft IDs together until send commits them to one message. */
export async function uploadChatAttachments(
  files: RemoteFileUpload[],
  actions: {
    upload: (file: RemoteFileUpload) => Promise<{ id: string }>;
    discard: (id: string) => Promise<void>;
    send: (ids: string[]) => Promise<string>;
    cancelled: () => boolean;
    progress: (completed: number) => void;
  },
): Promise<string> {
  const ids: string[] = [];
  try {
    actions.progress(0);
    for (const file of files) {
      if (actions.cancelled()) throw new Error("Attachment upload cancelled.");
      ids.push((await actions.upload(file)).id);
      actions.progress(ids.length);
    }
    if (actions.cancelled()) throw new Error("Attachment upload cancelled.");
    return await actions.send(ids);
  } catch (error) {
    await Promise.allSettled(ids.map(actions.discard));
    throw error;
  }
}
