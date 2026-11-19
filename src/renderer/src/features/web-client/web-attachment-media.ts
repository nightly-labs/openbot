import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { createSignal } from "solid-js";
import { createDownloadLimit } from "./web-download-limit";
import type { WebWorkspaceRuntime } from "./web-runtime";

const WEB_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const WEB_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const WEB_MEDIA_BYTES = MOBILE_ATTACHMENT_BYTES;
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

interface WebMediaFile {
  name: string;
  blob: Blob;
}

export interface WebAttachmentMedia extends AttachmentMediaSource {
  file(attachmentId: string): Promise<WebMediaFile | null>;
  keep(attachment: AttachmentSummary, bytes: Uint8Array<ArrayBuffer>): void;
  dispose(): void;
}

interface Entry {
  url: string;
  name: string;
  blob: Blob;
  bytes: number;
  object: boolean;
}

export function createWebAttachmentMedia(
  remote: Pick<WebWorkspaceRuntime, "download">,
  hostId: () => string,
  urls: { create(blob: Blob): string; revoke(url: string): void } = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
): WebAttachmentMedia {
  const entries = new Map<string, Entry>();
  const [shown, setShown] = createSignal<ReadonlyMap<string, string>>(new Map());
  const loading = new Map<string, Promise<boolean>>();
  let cachedHost = "";
  let total = 0;
  let generation = 0;
  let disposed = false;

  const publish = () => setShown(new Map([...entries].map(([key, entry]) => [key, entry.url])));
  const clear = () => {
    for (const entry of entries.values()) if (entry.object) urls.revoke(entry.url);
    entries.clear();
    loading.clear();
    total = 0;
    generation += 1;
  };
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
  const limited = createDownloadLimit(CONCURRENT_DOWNLOADS);

  const entryFor = (attachment: AttachmentSummary, type: string, bytes: Uint8Array<ArrayBuffer>): Entry => {
    const blob = new Blob([bytes], { type });
    const base = { name: attachment.name, blob, bytes: bytes.byteLength };
    return type === SVG_TYPE
      ? { ...base, url: `data:${SVG_TYPE};base64,${bytesToBase64(bytes)}`, object: false }
      : { ...base, url: urls.create(blob), object: true };
  };
  const limitFor = (type: string, size: "thumbnail" | "generated") =>
    playableMediaKind(type) ? WEB_MEDIA_BYTES : size === "generated" ? WEB_GENERATED_IMAGE_BYTES : WEB_THUMBNAIL_BYTES;

  async function download(attachment: AttachmentSummary, type: string, limit: number, key: string) {
    const started = generation;
    return limited(async () => {
      try {
        if (generation !== started) return false;
        const file = await remote.download(attachment.id);
        const bytes = base64ToBytes(file.base64);
        if (bytes.byteLength > limit || generation !== started) return false;
        store(key, entryFor(attachment, type, bytes));
        return true;
      } catch {
        return false;
      }
    });
  }

  return {
    thumbnailLimit: WEB_THUMBNAIL_BYTES,
    generatedImageLimit: WEB_GENERATED_IMAGE_BYTES,
    mediaLimit: WEB_MEDIA_BYTES,
    url: (id) => (disposed ? undefined : shown().get(`${hostId()}:${id}`)),
    load(attachment, size = "thumbnail") {
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
      const limit = limitFor(type, size);
      if (attachment.size > limit) return Promise.resolve(false);
      const job = download(attachment, type, limit, key).finally(() => {
        if (loading.get(key) === job) loading.delete(key);
      });
      loading.set(key, job);
      return job;
    },
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
      if (!type || entries.has(key) || loading.has(key) || bytes.byteLength > limitFor(type, "generated")) return;
      store(key, entryFor(attachment, type, bytes));
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

function mediaType(attachment: AttachmentSummary): string | null {
  const declared =
    attachment.mimeType.split(";")[0]?.trim().toLowerCase() || attachmentMimeTypeForName(attachment.name);
  return MEDIA_TYPES.has(declared) || declared === SVG_TYPE ? declared : null;
}
