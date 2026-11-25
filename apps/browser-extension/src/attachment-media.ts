import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { createSignal } from "solid-js";

export interface HostFile {
  name: string;
  mimeType: string;
  base64: string;
}

const THUMBNAIL_BYTES = 2 * 1024 * 1024;
const GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const MEDIA_BYTES = MOBILE_ATTACHMENT_BYTES;
const CACHE_BYTES = 64 * 1024 * 1024;
const CONCURRENT_DOWNLOADS = 2;

const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "video/quicktime",
  "video/mp4",
]);
const SVG_TYPE = "image/svg+xml";

interface Entry {
  url: string;
  bytes: number;
  object: boolean;
}

export interface AttachmentMedia extends AttachmentMediaSource {
  save(attachment: AttachmentSummary): Promise<void>;
  dispose(): void;
}

export function createAttachmentMedia(download: (attachmentId: string) => Promise<HostFile>): AttachmentMedia {
  const entries = new Map<string, Entry>();
  const [shown, setShown] = createSignal<ReadonlyMap<string, string>>(new Map());
  const loading = new Map<string, Promise<boolean>>();
  const waiting: (() => void)[] = [];
  let active = 0;
  let total = 0;
  let disposed = false;

  const store = (id: string, entry: Entry) => {
    entries.set(id, entry);
    total += entry.bytes;
    for (const [oldId, old] of entries) {
      if (total <= CACHE_BYTES || oldId === id) break;
      entries.delete(oldId);
      total -= old.bytes;
      if (old.object) URL.revokeObjectURL(old.url);
    }
    setShown(new Map([...entries].map(([key, value]) => [key, value.url])));
  };
  const slot = async () => {
    if (active >= CONCURRENT_DOWNLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
  };
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  const limitFor = (type: string, size: "thumbnail" | "generated") =>
    playableMediaKind(type) ? MEDIA_BYTES : size === "generated" ? GENERATED_IMAGE_BYTES : THUMBNAIL_BYTES;

  async function fetchInto(attachment: AttachmentSummary, type: string, limit: number): Promise<boolean> {
    await slot();
    try {
      if (disposed) return false;
      const bytes = base64ToBytes((await download(attachment.id)).base64);
      if (disposed || bytes.byteLength > limit) return false;
      store(
        attachment.id,
        type === SVG_TYPE
          ? { url: `data:${SVG_TYPE};base64,${bytesToBase64(bytes)}`, bytes: bytes.byteLength, object: false }
          : { url: URL.createObjectURL(new Blob([bytes], { type })), bytes: bytes.byteLength, object: true },
      );
      return true;
    } catch {
      return false;
    } finally {
      release();
    }
  }

  return {
    thumbnailLimit: THUMBNAIL_BYTES,
    generatedImageLimit: GENERATED_IMAGE_BYTES,
    mediaLimit: MEDIA_BYTES,
    url: (id) => (disposed ? undefined : shown().get(id)),
    load(attachment, size = "thumbnail") {
      if (entries.has(attachment.id)) return Promise.resolve(true);
      const running = loading.get(attachment.id);
      if (running) return running;
      const type = mediaType(attachment);
      if (!type) return Promise.resolve(false);
      const limit = limitFor(type, size);
      if (attachment.size > limit) return Promise.resolve(false);
      const job = fetchInto(attachment, type, limit).finally(() => loading.delete(attachment.id));
      loading.set(attachment.id, job);
      return job;
    },
    async save(attachment) {
      const bytes = base64ToBytes((await download(attachment.id)).base64);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) if (entry.object) URL.revokeObjectURL(entry.url);
      entries.clear();
    },
  };
}

function mediaType(attachment: AttachmentSummary): string | null {
  const declared =
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() || attachmentMimeTypeForName(attachment.name);
  return MEDIA_TYPES.has(declared) || declared === SVG_TYPE ? declared : null;
}
