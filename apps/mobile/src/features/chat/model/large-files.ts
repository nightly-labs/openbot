import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import { MOBILE_ATTACHMENT_BYTES, type RemoteLargeDownload } from "@openbot/team-client/remote-peer";
import { create } from "zustand";
import { useLargeFilePreference } from "@/features/settings/model/large-files";
import type { MobileText } from "@/shared/lib/text";

/** The largest file this phone downloads: the host's file limit. A larger file opens on desktop. */
export const MOBILE_LARGE_FILE_BYTES = TEAM_PROTOCOL_V2_MAX_FILE_BYTES;

/**
 * How a host file gets to this phone:
 * - `download`: it downloads when the chat shows it, as a file within the attachment limit does.
 * - `ask`: it is above the attachment limit, and downloads only when the user taps it.
 * - `desktop`: it is above the host's file limit, so it opens only on desktop.
 */
export type AttachmentDownload = "download" | "ask" | "desktop";

/** The large files the user tapped in this launch. A new launch asks again. */
const useRequestedFiles = create<{ keys: ReadonlySet<string> }>(() => ({ keys: new Set() }));

const fileKey = (serverId: string, attachmentId: string) => `${serverId}\n${attachmentId}`;

function downloadOf(size: number, automatic: boolean, requested: boolean): AttachmentDownload {
  if (size <= MOBILE_ATTACHMENT_BYTES) return "download";
  if (size > MOBILE_LARGE_FILE_BYTES) return "desktop";
  return automatic || requested ? "download" : "ask";
}

/** The download of a file, and the tap that lets a large file download. */
export function useAttachmentDownload(serverId: string, attachment: AttachmentSummary) {
  const automatic = useLargeFilePreference((state) => state.automatic);
  const requested = useRequestedFiles((state) => state.keys.has(fileKey(serverId, attachment.id)));
  return {
    download: downloadOf(attachment.size, automatic, requested),
    request: () => requestLargeFile(serverId, attachment.id),
  };
}

export function requestLargeFile(serverId: string, attachmentId: string) {
  const key = fileKey(serverId, attachmentId);
  if (useRequestedFiles.getState().keys.has(key)) return;
  useRequestedFiles.setState(({ keys }) => ({ keys: new Set(keys).add(key) }));
}

/**
 * The allowance a request needs for a file above the attachment limit. It takes a file of this
 * type and of this size or smaller. The host sends an attachment with its own type, or
 * `application/octet-stream` when it has none.
 */
export function largeDownloadOf(attachment: AttachmentSummary): RemoteLargeDownload | undefined {
  return attachment.size > MOBILE_ATTACHMENT_BYTES
    ? { maxBytes: attachment.size, mimeType: attachment.mimeType || "application/octet-stream" }
    : undefined;
}

/** A limit in whole megabytes, such as "10 MB". `format.fileSize` writes "10.0 MB". */
export function fileLimitText({ t, format }: Pick<MobileText, "t" | "format">, bytes: number) {
  return t("format.fileSize.megabytes", { size: format.number(Math.round(bytes / 1024 ** 2)) });
}
