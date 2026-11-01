import type { FilePreview } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../backend/effect-boundary";
import { isMissingWorkspacePath, type ResolvedWorkspaceFile } from "../backend/workspace-paths";
import { localFilePreview, missingFilePreview } from "./file-preview";
import { filePreviewPages } from "./file-preview-pages";

/**
 * Reads a workspace file for the chat. A path that is not there answers with a `missing` preview
 * instead of a failed request: a message can name a file that only its author has, and the chat asks
 * once for every name it reads. Any other refusal, such as a path outside the workspace, still fails.
 */
export async function previewWorkspacePath(
  resolve: () => Promise<ResolvedWorkspaceFile>,
  path: string,
  maxBytes?: number,
): Promise<FilePreview> {
  let file: ResolvedWorkspaceFile;
  try {
    file = await resolve();
  } catch (error) {
    if (!isMissingWorkspacePath(error)) throw error;
    return missingFilePreview(path);
  }
  return runCauseEffect(localFilePreview(file.path, file.name, file.size, filePreviewPages.generation, maxBytes));
}
