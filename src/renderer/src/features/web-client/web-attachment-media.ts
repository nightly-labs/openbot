import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { createSignal } from "solid-js";
import type { WebWorkspaceRuntime } from "./web-runtime";

/** An image above this size keeps its file icon: a thumbnail must not cost a large download. */
export const WEB_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** The host connection sends at most this many bytes for one file. */
export const WEB_MEDIA_BYTES = MOBILE_ATTACHMENT_BYTES;
const CACHE_BYTES = 64 * 1024 * 1024;
/** The chat shares the host connection, so only a few files download at the same time. */
const CONCURRENT_DOWNLOADS = 2;

/**
 * The only types that get an object URL. A blob URL has the origin of the app, so a type that a
 * browser can run as a page (HTML, SVG, XHTML) would get the account and host keys of this tab.
 */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "audio/mpeg",
  "video/quicktime",
]);

export interface WebAttachmentMedia extends AttachmentMediaSource {
  /** Revokes every object URL. */
  dispose(): void;
}

interface Entry {
  url: string;
  bytes: number;
}

/**
 * Object URLs for the images, audio and video of host attachments. The browser client gets no
 * `previewUrl`, so each file is read through the host connection when the chat shows it.
 */
export function createWebAttachmentMedia(
  remote: Pick<WebWorkspaceRuntime, "download">,
  hostId: () => string,
  urls: { create(blob: Blob): string; revoke(url: string): void } = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
): WebAttachmentMedia {
  // Insertion order is the use order: the first entry is the least recently used.
  const entries = new Map<string, Entry>();
  const [shown, setShown] = createSignal<ReadonlyMap<string, string>>(new Map());
  const loading = new Map<string, Promise<boolean>>();
  const waiting: (() => void)[] = [];
  let active = 0;
  let cachedHost = "";
  let total = 0;
  // A clear makes every running download stale, so it cannot store a URL that nothing revokes.
  let generation = 0;

  const publish = () => setShown(new Map([...entries].map(([key, entry]) => [key, entry.url])));
  const clear = () => {
    for (const entry of entries.values()) urls.revoke(entry.url);
    entries.clear();
    loading.clear();
    total = 0;
    generation += 1;
    publish();
  };
  /** The files of another host are not shown here, so a host switch drops them. */
  const currentHost = () => {
    const host = hostId();
    if (host !== cachedHost) {
      clear();
      cachedHost = host;
    }
    return host;
  };
  const store = (key: string, entry: Entry) => {
    entries.set(key, entry);
    total += entry.bytes;
    for (const [oldKey, old] of entries) {
      if (total <= CACHE_BYTES || oldKey === key) break;
      entries.delete(oldKey);
      total -= old.bytes;
      urls.revoke(old.url);
    }
    publish();
  };
  const slot = async () => {
    if (active >= CONCURRENT_DOWNLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
  };
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  async function download(attachment: AttachmentSummary, type: string, limit: number, key: string) {
    const started = generation;
    await slot();
    try {
      if (generation !== started) return false;
      const file = await remote.download(attachment.id);
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      if (bytes.byteLength > limit || generation !== started) return false;
      store(key, { url: urls.create(new Blob([bytes], { type })), bytes: bytes.byteLength });
      return true;
    } catch {
      // The card keeps its icon and its download button.
      return false;
    } finally {
      release();
    }
  }

  return {
    thumbnailLimit: WEB_THUMBNAIL_BYTES,
    mediaLimit: WEB_MEDIA_BYTES,
    url: (id) => shown().get(`${hostId()}:${id}`),
    load(attachment) {
      const host = currentHost();
      const key = `${host}:${attachment.id}`;
      const entry = entries.get(key);
      if (entry) {
        entries.delete(key);
        entries.set(key, entry);
        return Promise.resolve(true);
      }
      const running = loading.get(key);
      if (running) return running;
      const type = mediaType(attachment);
      if (!type) return Promise.resolve(false);
      const limit = playableMediaKind(type) ? WEB_MEDIA_BYTES : WEB_THUMBNAIL_BYTES;
      if (attachment.size > limit) return Promise.resolve(false);
      const job = download(attachment, type, limit, key).finally(() => {
        if (loading.get(key) === job) loading.delete(key);
      });
      loading.set(key, job);
      return job;
    },
    dispose: clear,
  };
}

/** The allowed type of an attachment, from its own type or else its name. The host's file type is not used. */
function mediaType(attachment: AttachmentSummary): string | null {
  const declared =
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() || attachmentMimeTypeForName(attachment.name);
  return MEDIA_TYPES.has(declared) ? declared : null;
}
