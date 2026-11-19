import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { releaseFilePreviewPage } from "./conversation-port";
import type { ConversationRuntime } from "./conversation-runtime";

export const SHARED_FOLDER_PATH = /^Shared[/\\]/u;

export function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const CACHE_CHARACTERS = 16 * 1024 * 1024;

const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

interface MessageImageScope {
  serverId: string;
  messageId: string;
  agentId: string | undefined;
}

export function createMessageImageFiles(
  agent: Pick<ConversationRuntime["agent"], "previewSharedFile" | "previewWorkspaceFile">,
) {
  const cache = new Map<string, { job: Promise<string | null>; characters: number }>();
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
    const shared = (path = file.path) => agent.previewSharedFile({ path, maxBytes: INLINE_IMAGE_BYTES });
    const preview =
      file.kind === "shared"
        ? await shared()
        : await agent
            .previewWorkspaceFile({
              agentId: agentId ?? "",
              path: file.path,
              maxBytes: INLINE_IMAGE_BYTES,
              exactPath: true,
            })
            .catch((error: unknown) => {
              if (!SHARED_FOLDER_PATH.test(file.path)) throw error;
              sharedFallbacks.add(key);
              return shared(decodedPath(file.path));
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

  function source(file: MessageImageFile, scope: MessageImageScope): MessageImageFile {
    return sharedFallbacks.has(keyOf(file, scope)) ? { kind: "shared", path: decodedPath(file.path) } : file;
  }

  return { load, source };
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
