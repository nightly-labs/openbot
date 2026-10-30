import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Image } from "expo-image";
import { Skeleton } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ImageOff from "lucide-react-native/icons/image-off";
import { useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useText } from "@/shared/lib/text";
import { FILL, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { sameShape } from "../model/image-dimensions";
import { type GalleryTile, galleryTiles } from "../model/image-gallery-layout";
import { rememberImageDimensions, useAttachmentFile } from "./attachment-preview";
import { useChatImageSource } from "./chat-image-viewer";

const GAP = 4;
const TILE_RADIUS = 10;

/**
 * The images of one agent message as one compact grid. A tap opens the conversation's viewer on
 * that image.
 */
export function ChatImageGallery({
  attachments,
  serverId,
}: {
  attachments: readonly AttachmentSummary[];
  serverId: string;
}) {
  const { width } = useWindowDimensions();
  const galleryWidth = Math.min(MAX_FRAME_WIDTH, width - 80);
  const layout = galleryTiles(attachments.length, galleryWidth, GAP);
  return (
    <View style={{ width: galleryWidth, height: layout.height }}>
      {attachments.map((attachment, index) => {
        const tile = layout.tiles[index];
        return tile ? (
          <ChatGalleryTile key={attachment.id} attachment={attachment} serverId={serverId} tile={tile} />
        ) : null;
      })}
    </View>
  );
}

function ChatGalleryTile({
  attachment,
  serverId,
  tile,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  tile: GalleryTile;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const { pending, localUri, uri, dimensions, query } = useAttachmentFile(serverId, attachment, true);
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const source = useChatImageSource(attachment.id, TILE_RADIUS);
  const failed = Boolean(query.error) || imageFailed;

  return (
    <Animated.View
      ref={source.origin}
      collapsable={false}
      style={[
        {
          position: "absolute",
          left: tile.left,
          top: tile.top,
          width: tile.width,
          height: tile.height,
          borderRadius: TILE_RADIUS,
          borderCurve: "continuous",
          overflow: "hidden",
        },
        source.hiddenStyle,
      ]}
    >
      {/* A plain pressable, so every layer fills the tile exactly. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          failed
            ? t("mobile.chat.attachment.retryImage")
            : t("mobile.chat.attachment.preview", { name: attachment.name })
        }
        accessibilityState={{ disabled: pending || (!uri && !failed), busy: !failed && !loaded }}
        disabled={pending || (!uri && !failed)}
        onPress={() => {
          if (!failed) {
            source.open?.(attachment);
            return;
          }
          setImageFailed(false);
          void query.refetch();
        }}
        style={FILL}
      >
        {failed ? (
          <View className="items-center justify-center bg-control" style={FILL}>
            <ImageOff size={22} color={String(muted)} />
          </View>
        ) : (
          <>
            <Skeleton isLoading={!loaded} className="rounded-none" style={FILL} />
            <Image
              source={uri}
              transition={localUri ? 0 : 220}
              contentFit="cover"
              accessible={false}
              style={FILL}
              onLoad={({ source: decoded }) => {
                setLoaded(true);
                if (decoded.width <= 0 || decoded.height <= 0) return;
                // The decoder has the final word on the shape, which the viewer opens the image in.
                const size = { width: decoded.width, height: decoded.height };
                if (dimensions && sameShape(dimensions, size)) return;
                rememberImageDimensions(attachment.id, size);
              }}
              onError={() => setImageFailed(true)}
            />
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
