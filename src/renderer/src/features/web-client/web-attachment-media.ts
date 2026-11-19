import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { createSignal } from "solid-js";
import type { WebFile, WebWorkspaceRuntime } from "./web-runtime";

/** An image above this size keeps its file icon: a thumbnail must not cost a large download. */
const WEB_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/**
 * The image that the user asked an agent to make. Above this size, the download and the base64 decode
 * stop the page for too long: about 0.5 s for 15 MB and 1 s for 30 MB.
 */
const WEB_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
/** The chat holds each shown file in memory, so a larger file keeps its card and downloads on a click. */
const WEB_MEDIA_BYTES = MOBILE_ATTACHMENT_BYTES;
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
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "video/quicktime",
  "video/mp4",
]);
/**
 * An SVG thumbnail gets a `data:` URL, not an object URL. An `<img>` does not run SVG scripts, and
 * a `data:` document has no origin of its own, so the file cannot get the keys of this tab.
 */
const SVG_TYPE = "image/svg+xml";

/** A file that the chat already read from the host. */
interface WebMediaFile {
  name: string;
  blob: Blob;
}

export interface WebAttachmentMedia extends AttachmentMediaSource {
  /**
   * The file of an attachment that the chat holds, or that a running load gets. Null when neither,
   * so the caller reads it from the host. It starts no download.
   */
  file(attachmentId: string): Promise<WebMediaFile | null>;
  /** Holds the bytes of a file that the caller read from the host, so the chat and a later open use them. */
  keep(attachment: AttachmentSummary, bytes: Uint8Array<ArrayBuffer>): void;
  /** The loaded small copy of an image (`attachment-preview-v1`). Reactive. */
  copyUrl(attachmentId: string): string | undefined;
  /**
   * The same files for a chat that shows small copies: an image that a card or a tile shows loads as
   * its copy, and `url` gives the whole file or else the copy. This source gives whole files only.
   */
  readonly withCopies: AttachmentMediaSource;
  /** Revokes every object URL. */
  dispose(): void;
}

interface Entry {
  url: string;
  name: string;
  blob: Blob;
  bytes: number;
  /** A `data:` URL has nothing to revoke. */
  object: boolean;
}

/**
 * Object URLs for the images, audio and video of host attachments. The browser client gets no
 * `previewUrl`, so each file is read through the host connection when the chat shows it.
 *
 * With `copies`, `withCopies` loads an image that a card or a tile shows as the host's small copy, and
 * the viewer loads the whole file (#12562). `url` and `file` give only whole files, so another viewer,
 * an open or a save never gets a copy.
 */
export function createWebAttachmentMedia(
  remote: Pick<WebWorkspaceRuntime, "download"> & Partial<Pick<WebWorkspaceRuntime, "downloadPreview">>,
  hostId: () => string,
  urls: { create(blob: Blob): string; revoke(url: string): void } = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
  /** Whether the host serves small copies of its images (`attachment-preview-v1`). */
  copies?: () => boolean,
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
  let disposed = false;

  const publish = () => setShown(new Map([...entries].map(([key, entry]) => [key, entry.url])));
  // No publish here: a card row calls `load` while it renders, and Solid refuses a write there.
  // `url` reads only keys of the current host, so the old host's URLs are never shown.
  const clear = () => {
    for (const entry of entries.values()) if (entry.object) urls.revoke(entry.url);
    entries.clear();
    loading.clear();
    total = 0;
    generation += 1;
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
      if (old.object) urls.revoke(old.url);
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

  const entryFor = (attachment: AttachmentSummary, type: string, bytes: Uint8Array<ArrayBuffer>): Entry => {
    const blob = new Blob([bytes], { type });
    const base = { name: attachment.name, blob, bytes: bytes.byteLength };
    return type === SVG_TYPE
      ? { ...base, url: `data:${SVG_TYPE};base64,${bytesToBase64(bytes)}`, object: false }
      : { ...base, url: urls.create(blob), object: true };
  };
  /** The largest file of this type that the chat holds. */
  const limitFor = (type: string, size: "thumbnail" | "generated") =>
    playableMediaKind(type) ? WEB_MEDIA_BYTES : size === "generated" ? WEB_GENERATED_IMAGE_BYTES : WEB_THUMBNAIL_BYTES;

  async function download(attachment: AttachmentSummary, type: string, limit: number, key: string, copy = false) {
    const started = generation;
    await slot();
    try {
      if (generation !== started) return false;
      const file: WebFile =
        copy && remote.downloadPreview
          ? await remote.downloadPreview(attachment.id)
          : await remote.download(attachment.id);
      const bytes = base64ToBytes(file.base64);
      if (bytes.byteLength > limit || generation !== started) return false;
      // A small copy is a JPEG or a PNG file, whatever the type of its image.
      store(key, entryFor(attachment, copy && MEDIA_TYPES.has(file.mimeType) ? file.mimeType : type, bytes));
      return true;
    } catch {
      // The card keeps its icon and its download button.
      return false;
    } finally {
      release();
    }
  }

  /** A held or running load of `key`, or a new one. */
  const loadOnce = (key: string, start: () => Promise<boolean>) => {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      return Promise.resolve(true);
    }
    const running = loading.get(key);
    if (running) return running;
    const job = start().finally(() => {
      if (loading.get(key) === job) loading.delete(key);
    });
    loading.set(key, job);
    return job;
  };
  const copyKey = (host: string, attachmentId: string) => `${host}:copy:${attachmentId}`;
  const shownUrl = (key: string) => (disposed ? undefined : shown().get(key));

  const fullUrl = (id: string) => shownUrl(`${hostId()}:${id}`);
  const load = (attachment: AttachmentSummary, size: "thumbnail" | "generated" = "thumbnail", copied = false) => {
    const host = currentHost();
    const key = `${host}:${attachment.id}`;
    const type = mediaType(attachment);
    if (!type) return Promise.resolve(false);
    const limit = limitFor(type, size);
    if (attachment.size > limit) return Promise.resolve(false);
    const whole = () => loadOnce(key, () => download(attachment, type, limit, key));
    // A held whole file shows as it is. A host without copies, or one without a copy of this
    // image (a large GIF or WebP file), sends the whole file, as before.
    if (!copied || size !== "thumbnail" || !remote.downloadPreview || copies?.() !== true) return whole();
    if (entries.has(key) || playableMediaKind(type) || type === SVG_TYPE) return whole();
    const copy = copyKey(host, attachment.id);
    const started = generation;
    return loadOnce(copy, () => download(attachment, type, limit, copy, true)).then(
      // A host switch or a dispose during the copy ends the load: its file is not of this host.
      (shown) => shown || (generation === started && !disposed && whole()),
    );
  };
  const limits = {
    thumbnailLimit: WEB_THUMBNAIL_BYTES,
    generatedImageLimit: WEB_GENERATED_IMAGE_BYTES,
    mediaLimit: WEB_MEDIA_BYTES,
  };

  return {
    ...limits,
    url: fullUrl,
    copyUrl: (id) => shownUrl(copyKey(hostId(), id)),
    withCopies: {
      ...limits,
      url: (id) => fullUrl(id) ?? shownUrl(copyKey(hostId(), id)),
      load: (attachment, size) => load(attachment, size, true),
    },
    load: (attachment, size) => load(attachment, size),
    async file(attachmentId) {
      if (disposed) return null;
      const key = `${currentHost()}:${attachmentId}`;
      const running = loading.get(key);
      if (running && !(await running)) return null;
      const entry = entries.get(key);
      return entry ? { name: entry.name, blob: entry.blob } : null;
    },
    keep(attachment, bytes) {
      if (disposed) return;
      const key = `${currentHost()}:${attachment.id}`;
      const type = mediaType(attachment);
      // A running load stores the same file itself.
      if (!type || entries.has(key) || loading.has(key) || bytes.byteLength > limitFor(type, "generated")) return;
      store(key, entryFor(attachment, type, bytes));
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

/** The allowed type of an attachment, from its own type or else its name. The host's file type is not used. */
function mediaType(attachment: AttachmentSummary): string | null {
  const declared =
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() || attachmentMimeTypeForName(attachment.name);
  return MEDIA_TYPES.has(declared) || declared === SVG_TYPE ? declared : null;
}
