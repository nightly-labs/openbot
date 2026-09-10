import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ExternalLink, FileText } from "lucide-react-native";
import { useState } from "react";
import { Alert, useWindowDimensions, View } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function ChatAttachmentView({
  attachment,
  serverId,
  alignment = "left",
}: {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
}) {
  const [fileColor, muted] = useThemeColor(["success", "muted"]);
  const { downloadAttachment } = useMobileWorkspace();
  const [ratio, setRatio] = useState(1);
  const [sharing, setSharing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const { width } = useWindowDimensions();
  const pending = attachment.id.startsWith("mobile-draft-attachment-");
  const image = attachment.kind === "image";
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
    enabled: image && !local && !pending,
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
  const localUri = local ?? query.data?.localUri;
  const uri = localUri ?? (query.data ? `data:${query.data.mimeType};base64,${query.data.base64}` : null);
  // Keep the message footprint independent of dimensions received after image decoding.
  const frameSize = Math.min(280, width - 80);
  const imageHeight = Math.min(frameSize, frameSize / ratio);
  const imageWidth = imageHeight * ratio;
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
  return (
    <View className="max-w-full gap-2">
      {image ? (
        <View
          className={alignment === "right" ? "items-end justify-end" : "items-start justify-end"}
          style={{ width: frameSize, height: frameSize, maxWidth: "100%" }}
        >
          <Button
            variant="ghost"
            className="min-h-0 min-w-0 overflow-hidden p-0"
            isDisabled={pending || sharing || query.isFetching || !uri || imageFailed}
            accessibilityLabel={`Open or save ${attachment.name}`}
            onPress={() => void share()}
            style={{
              width: imageWidth,
              height: imageHeight,
              maxWidth: "100%",
              borderRadius: 18,
              borderCurve: "circular",
            }}
          >
            <Image
              source={imageFailed ? null : uri}
              placeholder={localUri ? null : { blurhash: "A95}pxj[ayfQ" }}
              placeholderContentFit="cover"
              transition={localUri ? 0 : 250}
              contentFit="contain"
              accessibilityLabel={attachment.name}
              style={{ width: "100%", height: "100%", borderRadius: 18 }}
              onLoad={({ source }) => {
                if (source.width > 0 && source.height > 0) setRatio(source.width / source.height);
              }}
              onError={() => setImageFailed(true)}
            />
          </Button>
        </View>
      ) : null}
      {!image ? (
        <Button
          variant="secondary"
          className="h-auto flex-row justify-start gap-3 rounded-2xl border border-border bg-control p-3"
          style={{ width: Math.min(280, width - 80), maxWidth: "100%" }}
          isDisabled={pending || sharing || query.isFetching}
          accessibilityLabel={`Open or save ${attachment.name}`}
          onPress={() => void share()}
        >
          <View className="size-11 items-center justify-center rounded-xl bg-success/15">
            <FileText size={23} color={fileColor} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Typography.Paragraph type="body-sm" numberOfLines={2} className="font-semibold text-foreground">
              {attachment.name}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-muted">
              {sharing || query.isFetching ? "Downloading…" : formatFileSize(attachment.size)}
            </Typography.Paragraph>
          </View>
          <ExternalLink size={18} color={muted} />
        </Button>
      ) : null}
      {query.error || imageFailed ? (
        <Typography.Paragraph type="body-xs">
          {query.error?.message ?? "Could not display this image."}
        </Typography.Paragraph>
      ) : null}
      {image && (query.error || imageFailed) ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setImageFailed(false);
            void query.refetch();
          }}
        >
          <Button.Label>Retry image</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
