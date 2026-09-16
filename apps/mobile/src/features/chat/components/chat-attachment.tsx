import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Image } from "expo-image";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ExternalLink, FileText } from "lucide-react-native";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { formatFileSize, useAttachmentFile } from "./attachment-preview";

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
  const [ratio, setRatio] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const { width } = useWindowDimensions();
  const image = attachment.kind === "image";
  const { pending, localUri, uri, query, sharing, share } = useAttachmentFile(serverId, attachment, image);
  // Keep the message footprint independent of dimensions received after image decoding.
  const frameSize = Math.min(280, width - 80);
  const imageHeight = Math.min(frameSize, frameSize / ratio);
  const imageWidth = imageHeight * ratio;
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
            onPress={share}
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
          onPress={share}
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
