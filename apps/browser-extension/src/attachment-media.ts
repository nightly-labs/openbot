import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { createSignal } from "solid-js";

/** A file that the host sent: its name, its type and its bytes as Base64. */
export interface HostFile {
  name: string;
  mimeType: string;
  base64: string;
}

/** An image above this size keeps its file card: a thumbnail must not cost a large download. */
const THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** The image that the person asked an agent to make. */
const GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
/** Audio and video load on a click, up to the phone's limit. */
const MEDIA_BYTES = MOBILE_ATTACHMENT_BYTES;
const CACHE_BYTES = 64 * 1024 * 1024;
/** The chat shares the host connection, so only a few files download at the same time. */
const CONCURRENT_DOWNLOADS = 2;

/**
 * The only types that get an object URL. A blob URL has the extension's origin, so a type that a
 * browser can run as a page (HTML, SVG, XHTML) would get the session of this extension.
 */
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
/** An SVG gets a `data:` URL: an `<img>` runs no SVG script, and the document has no origin of its own. */
const SVG_TYPE = "image/svg+xml";

interface Entry {
  url: string;
  bytes: number;
  /** A `data:` URL has nothing to revoke. */
  object: boolean;
}

export interface AttachmentMedia extends AttachmentMediaSource {
  /** Saves the file in the browser's downloads. */
  save(attachment: AttachmentSummary): Promise<void>;
  /** Revokes every object URL. */
  dispose(): void;
}

/**
 * The images, audio and video of the attachments of one server, read through its connection, as the
 * web client reads them (`web-attachment-media.ts`). The host gives no preview URL to a remote client.
 */
export function createAttachmentMedia(download: (attachmentId: string) => Promise<HostFile>): AttachmentMedia {
  // Insertion order is the use order: the first entry is the least recently used.
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
      // The card keeps its icon and its download button.
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
      // Saved as plain bytes: the browser stores the file and never shows it as a page of this origin.
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

/** The allowed type of an attachment, from its own type or else its name. */
function mediaType(attachment: AttachmentSummary): string | null {
  const declared =
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() || attachmentMimeTypeForName(attachment.name);
  return MEDIA_TYPES.has(declared) || declared === SVG_TYPE ? declared : null;
}
