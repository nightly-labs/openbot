import { isOpenableAttachmentName } from "@openbot/contracts/attachment-files";
import type {
  FileAction,
  OpenBotDesktopApi,
  OpenSharedFileInput,
  OpenWorkspaceFileInput,
} from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";
import { normalizeMessage } from "@openbot/user-errors/reference";
import { decodedPath, SHARED_FOLDER_PATH } from "./message-image-files";

export type ChatFileKind = "shared" | "workspace";

export interface ChatFileOpener {
  openSharedFile: (input: OpenSharedFileInput) => Promise<void>;
  openWorkspaceFile: (input: OpenWorkspaceFileInput) => Promise<void>;
}

export function serverChatFileOpener(
  agent: Pick<OpenBotDesktopApi["agent"], "openSharedFile" | "openWorkspaceFile">,
  serverId: string,
): ChatFileOpener {
  return {
    openSharedFile: (input) => agent.openSharedFile(input, serverId),
    openWorkspaceFile: (input) => agent.openWorkspaceFile(input, serverId),
  };
}

const MISSING_PATH_KEYS = new Set([
  "error.backend.workspacePathMissing",
  "error.backend.workspacePathMissingForMember",
]);

export function chatFileName(path: string): string {
  return decodedPath(path).replaceAll("\\", "/").split("/").pop() || currentText().t("attachment.error.fileFallback");
}

export function chatFileError(error: unknown, path: string, fallback: string): string {
  const { t, errorMessage } = currentText();
  const notFound = () => t("attachment.error.fileNotFound", { name: chatFileName(path) });
  if (error instanceof Error && /\bENOENT\b/u.test(error.message)) return notFound();
  const message = errorMessage(error, fallback);
  return message === fallback && matchingSourceKeys(normalizeMessage(error)).some((key) => MISSING_PATH_KEYS.has(key))
    ? notFound()
    : message;
}

const LOCATION_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/u;

function fileAction(path: string): FileAction {
  return isOpenableAttachmentName(decodedPath(path).replace(LOCATION_SUFFIX, "")) ? "open" : "reveal";
}

function openFile(opener: ChatFileOpener, kind: ChatFileKind, agentId: string | undefined, path: string) {
  const action = fileAction(path);
  if (kind === "shared") return opener.openSharedFile({ path, action });
  if (!agentId) return Promise.resolve();
  return opener.openWorkspaceFile({ agentId, path, action });
}

function fallbacks(kind: ChatFileKind, agentId: string | undefined, path: string, asWritten?: string) {
  const files: { kind: ChatFileKind; path: string }[] = [];
  if (asWritten && agentId) files.push({ kind: "workspace", path: asWritten });
  if (kind === "workspace" && SHARED_FOLDER_PATH.test(path)) files.push({ kind: "shared", path: decodedPath(path) });
  return files;
}

export async function openChatFile(
  opener: ChatFileOpener,
  kind: ChatFileKind,
  agentId: string | undefined,
  path: string,
  asWritten?: string,
): Promise<string | null> {
  try {
    await openFile(opener, kind, agentId, path);
    return null;
  } catch (error) {
    for (const file of fallbacks(kind, agentId, path, asWritten)) {
      const opened = await openFile(opener, file.kind, agentId, file.path).then(
        () => true,
        () => false,
      );
      if (opened) return null;
    }
    return chatFileError(error, path, currentText().t("attachment.error.openFile"));
  }
}
