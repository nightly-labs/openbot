import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import { MOBILE_ATTACHMENT_BYTES, type RemoteLargeDownload } from "@openbot/team-client/remote-peer";
import { create } from "zustand";
import { useLargeFilePreference } from "@/features/settings/model/large-files";
import type { MobileText } from "@/shared/lib/text";

export const MOBILE_LARGE_FILE_BYTES = TEAM_PROTOCOL_V2_MAX_FILE_BYTES;

export type AttachmentDownload = "download" | "ask" | "desktop";

const useRequestedFiles = create<{ keys: ReadonlySet<string> }>(() => ({ keys: new Set() }));

const fileKey = (serverId: string, attachmentId: string) => `${serverId}\n${attachmentId}`;

function downloadOf(size: number, automatic: boolean, requested: boolean): AttachmentDownload {
  if (size <= MOBILE_ATTACHMENT_BYTES) return "download";
  if (size > MOBILE_LARGE_FILE_BYTES) return "desktop";
  return automatic || requested ? "download" : "ask";
}

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

export function largeDownloadOf(attachment: AttachmentSummary, file?: string): RemoteLargeDownload | undefined {
  return attachment.size > MOBILE_ATTACHMENT_BYTES
    ? {
        maxBytes: attachment.size,
        mimeType: attachment.mimeType || "application/octet-stream",
        ...(file ? { file } : {}),
      }
    : undefined;
}

export function fileLimitText({ t, format }: Pick<MobileText, "t" | "format">, bytes: number) {
  return t("format.fileSize.megabytes", { size: format.number(Math.round(bytes / 1024 ** 2)) });
}
