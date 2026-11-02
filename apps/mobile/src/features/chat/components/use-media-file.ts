import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** The extension of a file whose name has none, for the types a player cannot read without one. */
const MIME_EXTENSIONS: Record<string, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/markdown": "md",
};

let folderCleared = false;

/**
 * The folder of downloaded files. A file stays on this phone only for the launch that showed it:
 * the first file of a launch removes the files of the launch before.
 */
function mediaFolder() {
  const folder = new Directory(Paths.cache, "chat-media");
  if (!folderCleared) {
    folderCleared = true;
    // Earlier versions kept videos in their own folder.
    for (const old of [folder, new Directory(Paths.cache, "chat-videos")]) {
      try {
        if (old.exists) old.delete();
      } catch {
        // The system clears the cache folder itself when it needs the space.
      }
    }
  }
  return folder;
}

/**
 * Where a host file is kept on this phone. A player reads a file, not the Base64 that the host
 * sends, and the file keeps the attachment's name so the share sheet shows it.
 */
export function mediaFile(serverId: string, attachment: AttachmentSummary) {
  const segment = (value: string) => value.replace(/[^\w.-]/gu, "_").replace(/^\.+/u, "_");
  let name = attachment.name.replace(/[/\\\p{Cc}]/gu, "_").replace(/^\.+/u, "_") || "file";
  // A player and the photo library read the type from the extension.
  if (!attachmentFileExtension(name))
    name = `${name}.${MIME_EXTENSIONS[attachment.mimeType] ?? attachment.mimeType.split("/")[1] ?? "bin"}`;
  return new File(mediaFolder(), segment(serverId), segment(attachment.id), name);
}

/**
 * A host file as a local file. A file from an earlier download is used again when it is whole.
 * `enabled` is false while the card passes in a fast fling, or until the user asks for the file.
 */
export function useMediaFile(serverId: string, attachment: AttachmentSummary, enabled: boolean) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  return useQuery({
    enabled,
    queryKey: queryKeys.chatMediaFile(serverId, attachment.id),
    queryFn: async () => {
      const file = mediaFile(serverId, attachment);
      if (file.exists && file.size === attachment.size) return file.uri;
      const data = await downloadAttachment(serverId, attachment.id);
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      file.writeSync(data.base64, { encoding: "base64" });
      return file.uri;
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}
