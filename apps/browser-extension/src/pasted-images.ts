import { attachmentFileExtension, IMAGE_ATTACHMENT_EXTENSIONS } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { AGENT_THREAD_FILES_LIMIT } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import type { ComposerPendingImage } from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import { createSignal } from "solid-js";

const IMAGE_EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function clipboardImages(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const files =
    clipboard.files.length > 0
      ? Array.from(clipboard.files)
      : Array.from(clipboard.items).flatMap((item) => {
          const file = item.kind === "file" ? item.getAsFile() : null;
          return file ? [file] : [];
        });
  return files.flatMap((file) => {
    const extension = IMAGE_EXTENSION_BY_TYPE[file.type];
    if (!extension) return [];
    const named = IMAGE_ATTACHMENT_EXTENSIONS.some((known) => known === attachmentFileExtension(file.name));
    return [named ? file : new File([file], `image.${extension}`, { type: file.type })];
  });
}

export function createPastedImages(options: {
  upload: (file: File) => Promise<AttachmentSummary>;
  discard: (attachmentId: string) => void;
  onError: (error: unknown) => void;
}) {
  const [ready, setReady] = createSignal<AttachmentSummary[]>([]);
  const [pending, setPending] = createSignal<ComposerPendingImage[]>([]);
  let queue = Promise.resolve();
  let generation = 0;

  function add(files: readonly File[]): void {
    const room = AGENT_THREAD_FILES_LIMIT - ready().length - pending().length;
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      const current = generation;
      setPending((list) => [...list, { id, name: file.name, url }]);
      queue = queue.then(async () => {
        try {
          if (current !== generation) {
            URL.revokeObjectURL(url);
            return;
          }
          const attachment = await options.upload(file);
          if (current !== generation) {
            options.discard(attachment.id);
            URL.revokeObjectURL(url);
            return;
          }
          setReady((list) => [...list, { ...attachment, previewUrl: url }]);
        } catch (error) {
          URL.revokeObjectURL(url);
          if (current === generation) options.onError(error);
        } finally {
          setPending((list) => list.filter((entry) => entry.id !== id));
        }
      });
    }
  }

  function remove(attachment: AttachmentSummary): void {
    setReady((list) => list.filter((entry) => entry.id !== attachment.id));
    options.discard(attachment.id);
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }

  function take(): AttachmentSummary[] {
    const taken = ready();
    setReady([]);
    for (const attachment of taken) if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    return taken.map((attachment) => ({ ...attachment, previewUrl: null }));
  }

  function clear(): void {
    generation += 1;
    for (const attachment of ready()) remove(attachment);
    for (const image of pending()) URL.revokeObjectURL(image.url);
    setPending([]);
  }

  return { ready, pending, busy: () => pending().length > 0, add, remove, take, clear };
}
