import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { releaseFilePreviewPage } from "./conversation-port";
import type { ConversationRuntime } from "./conversation-runtime";

/** A path that the host reads as one in the shared folder, such as `Shared/report.md`. */
export const SHARED_FOLDER_PATH = /^Shared[/\\]/u;

/** A larger named image keeps only its chip. The host does not read or send a larger file. */
const INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
/**
 * The cached `data:` URLs together take at most this many characters. The renderer keeps a second
 * copy of each shown URL and its decoded bitmap, so the cache stays small; an image that scrolls
 * back into view after eviction is read again from the host.
 */
const CACHE_CHARACTERS = 16 * 1024 * 1024;

/**
 * The types that show inline. Each shows as a `data:` URL in an `<img>`, which runs no script and
 * has an opaque origin, so an SVG gets nothing of the app even when it is opened on its own.
 */
const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

/** The host, the message, and for a workspace path the agent whose workspace holds it. */
interface MessageImageScope {
  serverId: string;
  messageId: string;
  agentId: string | undefined;
}

/**
 * Reads the image files that agent messages name, through the same file preview as their chips.
 * `scope` names the host, the message, and for a workspace path the agent whose workspace holds it.
 * Each message keeps its own entry: an agent can write the same path again, and a newer message
 * must show the newer file.
 */
export function createMessageImageFiles(
  agent: Pick<ConversationRuntime["agent"], "previewSharedFile" | "previewWorkspaceFile">,
) {
  // Insertion order is the use order: the first entry is the least recently used.
  const cache = new Map<string, { job: Promise<string | null>; characters: number }>();
  // A workspace `Shared/…` image that showed from the shared folder, so its download saves the same file.
  // A key stays after its cache entry goes, because the row still shows the image.
  const sharedFallbacks = new Set<string>();
  let total = 0;
  const drop = (key: string) => {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    total -= entry.characters;
  };
  const keyOf = (file: MessageImageFile, scope: MessageImageScope) =>
    `${scope.serverId}:${scope.messageId}:${file.kind}:${file.kind === "workspace" ? scope.agentId : ""}:${file.path}`;

  async function read(file: MessageImageFile, agentId: string | undefined, key: string): Promise<string | null> {
    if (file.kind === "workspace" && !agentId) return null;
    const shared = () => agent.previewSharedFile({ path: file.path, maxBytes: INLINE_IMAGE_BYTES });
    const preview =
      file.kind === "shared"
        ? await shared()
        : await agent
            .previewWorkspaceFile({
              agentId: agentId ?? "",
              path: file.path,
              maxBytes: INLINE_IMAGE_BYTES,
              // An inline image shows only the file that the answer names, not an older file with the same name.
              exactPath: true,
            })
            // The host reads `Shared/…` as a shared file, as the chip does when the workspace has none (#5657).
            .catch((error: unknown) => {
              if (!SHARED_FOLDER_PATH.test(file.path)) throw error;
              sharedFallbacks.add(key);
              return shared();
            });
    releaseFilePreviewPage(preview.pageUrl);
    const type = preview.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (preview.previewKind !== "image" || !preview.bytes || !INLINE_IMAGE_TYPES.has(type)) return null;
    if (preview.bytes.byteLength > INLINE_IMAGE_BYTES) return null;
    return dataUrl(new Blob([new Uint8Array(preview.bytes).buffer], { type }));
  }

  function load(file: MessageImageFile, scope: MessageImageScope): Promise<string | null> {
    const key = keyOf(file, scope);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.job;
    }
    // A file that does not load, or is too large, shows no preview until the chat opens again, so
    // a row that renders again does not ask the host again.
    sharedFallbacks.delete(key);
    const entry = { job: read(file, scope.agentId, key).catch(() => null), characters: 0 };
    cache.set(key, entry);
    void entry.job.then((url) => {
      if (cache.get(key) !== entry) return;
      entry.characters = url?.length ?? 0;
      total += entry.characters;
      for (const oldKey of cache.keys()) {
        if (total <= CACHE_CHARACTERS || oldKey === key) break;
        drop(oldKey);
      }
    });
    return entry.job;
  }

  /** The file that the shown image of `file` came from. */
  function source(file: MessageImageFile, scope: MessageImageScope): MessageImageFile {
    return sharedFallbacks.has(keyOf(file, scope)) ? { kind: "shared", path: file.path } : file;
  }

  return { load, source };
}

/** Encodes off the UI thread: one answer can name several large images. */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
