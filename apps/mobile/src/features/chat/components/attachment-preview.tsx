import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useThemeColor } from "heroui-native/hooks";
import { FileText } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

/** A list entry shows what the file is: an image shows itself, every other file shows its icon. */
export function AttachmentThumbnail({ name, uri, size = 40 }: { name: string; uri: string | null; size?: number }) {
  const fileColor = useThemeColor("success");
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-xl bg-success/15"
      style={{ width: size, height: size }}
    >
      {uri ? (
        <Image
          source={uri}
          contentFit="cover"
          transition={120}
          accessibilityLabel={name}
          style={{ width: size, height: size }}
        />
      ) : (
        <FileText size={Math.round(size / 2)} color={String(fileColor)} />
      )}
    </View>
  );
}

/** The image of a file this phone holds itself, such as one an edit just added. */
export function localAttachmentPreview(file: { mimeType: string; base64: string; uri?: string }): string | null {
  if (!file.mimeType.startsWith("image/")) return null;
  return file.uri ?? (file.base64 ? `data:${file.mimeType};base64,${file.base64}` : null);
}

/**
 * One host file: its image for a preview, and the share sheet for opening it. The query key is the
 * one the chat uses, so a file read in a message is not downloaded a second time for a queue row.
 */
export function useAttachmentFile(serverId: string, attachment: AttachmentSummary, preview: boolean) {
  const { downloadAttachment } = useMobileWorkspace();
  const [sharing, setSharing] = useState(false);
  const pending = attachment.id.startsWith("mobile-draft-attachment-");
  const local =
    attachment.previewUrl?.startsWith("data:image/") || (pending && attachment.previewUrl?.startsWith("file://"))
      ? attachment.previewUrl
      : null;
  const query = useQuery({
    queryKey: ["chat-attachment", serverId, attachment.id],
    queryFn: (): Promise<RemoteFileUpload & { localUri?: string }> => {
      if (attachment.size > MOBILE_ATTACHMENT_BYTES)
        throw new Error("This file exceeds the mobile 10 MB limit. Open it on desktop.");
      return downloadAttachment(serverId, attachment.id);
    },
    enabled: preview && !local && !pending,
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
  const localUri = local ?? query.data?.localUri;
  const uri = localUri ?? (query.data ? `data:${query.data.mimeType};base64,${query.data.base64}` : null);
  async function share() {
    setSharing(true);
    let file: File | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The attachment is unavailable. Try again.");
      const name = attachment.name.replace(/[/\\\p{Cc}]/gu, "_");
      file = new File(Paths.cache, `${Date.now()}-${name}`);
      file.write(result.data.base64, { encoding: "base64" });
      await Sharing.shareAsync(file.uri, { mimeType: result.data.mimeType, dialogTitle: attachment.name });
    } catch (error) {
      Alert.alert("Could not open attachment", error instanceof Error ? error.message : "Try again.");
    } finally {
      if (file?.exists) file.delete();
      setSharing(false);
    }
  }
  return {
    pending,
    localUri,
    uri,
    query,
    sharing,
    busy: sharing || query.isFetching,
    share: () => void share(),
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
