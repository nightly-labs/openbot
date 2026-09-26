import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { Image } from "expo-image";
import { Button, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ExternalLink, ImageOff } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useText } from "@/shared/lib/text";
import type { ImageDimensions } from "../model/image-dimensions";
import { attachmentTypeLabel, rememberImageDimensions, useAttachmentFile } from "./attachment-preview";
import { ImageViewer } from "./image-viewer";
import { UPLOAD_BLUR_RADIUS, UPLOAD_SETTLE_MS, UploadProgressCircle, useUploadRevealStyle } from "./upload-progress";

// An image is this tall unless it is too wide for the column. The host sends no image size, so a
// height taken from the image changes once it downloads and moves every message below it; a
// fixed height keeps that change to the image's own width. Portrait photos and screenshots,
// the usual case, never move the chat.
const IMAGE_HEIGHT = 240;
const MAX_IMAGE_WIDTH = 280;
// An extremely narrow image keeps a frame wide enough to tap, and shows whole inside it.
const MIN_IMAGE_WIDTH = 72;
// The width reserved while the shape is still unknown: a portrait phone photo.
const UNKNOWN_RATIO = 3 / 4;
// Every layer of an image fills its frame exactly, with no padding or percentage in between.
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * The frame an image draws in, always showing the whole image. It is 240 pt tall with the
 * image's own width; an image too wide for the column scales down to the column's width
 * instead, so nothing is cropped.
 */
export function imageFrame(dimensions: ImageDimensions | null, maxWidth: number) {
  const ratio = dimensions ? dimensions.width / dimensions.height : UNKNOWN_RATIO;
  const width = IMAGE_HEIGHT * ratio;
  if (width > maxWidth) return { width: maxWidth, height: Math.round(maxWidth / ratio) };
  return { width: Math.max(MIN_IMAGE_WIDTH, Math.round(width)), height: IMAGE_HEIGHT };
}

/** Two sizes with the same shape, allowing for rounding in a scaled copy. */
function sameShape(left: ImageDimensions, right: ImageDimensions) {
  return Math.abs(left.width / left.height - right.width / right.height) < 0.01;
}

export function ChatAttachmentView({
  attachment,
  serverId,
  alignment = "left",
  upload,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
  /** The sent fraction of this file, from 0 to 1, while the message that carries it is sending. */
  upload?: number;
}) {
  const { t, format, sourceText } = useText();
  const [fileColor, muted] = useThemeColor(["success", "muted"]);
  const [decoded, setDecoded] = useState<ImageDimensions | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // Where the image was when the viewer opened. The chat's copy hides while the viewer holds it.
  const [viewing, setViewing] = useState(false);
  const [sourceHidden, setSourceHidden] = useState(false);
  const frameRef = useRef<View>(null);
  // The send can finish before the upload view has settled. Hold it as complete for that long,
  // so the photo finishes coming into focus instead of jumping to sharp in one frame.
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (upload !== undefined) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), UPLOAD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [upload]);
  const shownUpload = upload ?? (lingering ? 1 : undefined);
  const revealStyle = useUploadRevealStyle(shownUpload ?? 1);
  const { width } = useWindowDimensions();
  const tooLarge = attachment.size > MOBILE_ATTACHMENT_BYTES;
  // An image above the transfer limit cannot be shown here, so it is a file the user opens on desktop.
  const image = attachment.kind === "image" && !tooLarge;
  const { pending, localUri, uri, dimensions, query, sharing, share, saveToPhotos } = useAttachmentFile(
    serverId,
    attachment,
    image,
  );
  const maxWidth = Math.min(MAX_IMAGE_WIDTH, width - 80);
  const shape = decoded ?? dimensions;
  const frame = imageFrame(shape, maxWidth);
  const failed = Boolean(query.error) || imageFailed;
  const busy = sharing || query.isFetching;

  if (image)
    return (
      <View className={`max-w-full gap-2 ${alignment === "right" ? "items-end" : "items-start"}`}>
        <View
          style={{
            width: frame.width,
            height: frame.height,
            maxWidth: "100%",
            borderRadius: 18,
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <View ref={frameRef} collapsable={false} style={{ ...FILL, opacity: sourceHidden ? 0 : 1 }}>
            {/* A plain pressable: a HeroUI button keeps its own side padding and row gap, which
                pushed the image off the frame's right edge. Every layer here fills the frame. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.attachment.preview", { name: attachment.name })}
              accessibilityState={{ disabled: pending || !uri || failed }}
              disabled={pending || !uri || failed}
              onPress={() => setViewing(true)}
              style={FILL}
            >
              {failed ? (
                <View className="items-center justify-center gap-2 p-3" style={FILL}>
                  <ImageOff size={24} color={String(muted)} />
                  <Typography.Paragraph type="body-xs" align="center" className="text-muted">
                    {query.error ? sourceText(query.error.message) : t("mobile.chat.attachment.displayFailed")}
                  </Typography.Paragraph>
                </View>
              ) : (
                <>
                  {/* Under the image, so a cached image covers it at once; it leaves when the image
                    loads, so nothing shows through a transparent picture afterwards. */}
                  <Skeleton
                    isLoading={!imageLoaded}
                    accessible
                    accessibilityLabel={t("mobile.chat.attachment.loadingImage")}
                    className="rounded-none"
                    style={FILL}
                  />
                  {shownUpload !== undefined && uri ? (
                    // A blurred copy under the sharp photo while it uploads. Whole, like the photo,
                    // so the picture never looks cut while it comes into focus.
                    <Image
                      source={uri}
                      blurRadius={UPLOAD_BLUR_RADIUS}
                      transition={0}
                      contentFit="contain"
                      accessible={false}
                      style={FILL}
                    />
                  ) : null}
                  <Animated.View style={[FILL, revealStyle]}>
                    <Image
                      source={uri}
                      transition={localUri ? 0 : 220}
                      // The frame has the image's shape, so this fills it; only an extremely
                      // narrow image leaves a margin at its sides instead of losing its ends.
                      contentFit="contain"
                      accessibilityLabel={attachment.name}
                      style={FILL}
                      onLoad={({ source }) => {
                        setImageLoaded(true);
                        if (source.width <= 0 || source.height <= 0) return;
                        // The decoder has the final word on the shape. The header is read first,
                        // to reserve the frame early, but a rotation tag can make it disagree.
                        const size = { width: source.width, height: source.height };
                        if (dimensions && sameShape(dimensions, size)) return;
                        rememberImageDimensions(attachment.id, size);
                        setDecoded(size);
                      }}
                      onError={() => setImageFailed(true)}
                    />
                  </Animated.View>
                </>
              )}
            </Pressable>
          </View>
          {upload !== undefined ? (
            // The focus says it visually; this says it to a screen reader.
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t("mobile.chat.attachment.uploading", { name: attachment.name })}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(upload * 100) }}
              style={FILL}
            />
          ) : null}
        </View>
        {failed ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              setImageFailed(false);
              void query.refetch();
            }}
          >
            <Button.Label>{t("mobile.chat.attachment.retryImage")}</Button.Label>
          </Button>
        ) : null}
        {viewing && uri ? (
          <ImageViewer
            uri={uri}
            name={attachment.name}
            dimensions={shape ?? frame}
            measureOrigin={(report) =>
              frameRef.current
                ? frameRef.current.measureInWindow((x, y, width, height) => report({ x, y, width, height }))
                : report(null)
            }
            originRadius={18}
            busy={busy}
            onShare={share}
            onSave={saveToPhotos}
            onShown={() => setSourceHidden(true)}
            onDismissed={() => {
              setViewing(false);
              setSourceHidden(false);
            }}
          />
        ) : null}
      </View>
    );

  const typeLabel = attachmentTypeLabel(attachment.name, attachment.mimeType, t);
  const detail = tooLarge
    ? t("mobile.chat.attachment.openOnDesktopDetail", { size: format.fileSize(attachment.size) })
    : upload !== undefined
      ? t("mobile.chat.attachment.uploadingPercent", { percent: format.percent(upload) })
      : busy
        ? t("mobile.chat.attachment.downloading")
        : `${typeLabel} · ${format.fileSize(attachment.size)}`;
  return (
    <View className={`max-w-full ${alignment === "right" ? "items-end" : "items-start"}`}>
      <Button
        variant="secondary"
        className="h-auto flex-row justify-start gap-3 rounded-2xl border border-border bg-control p-3"
        style={{ width: maxWidth, maxWidth: "100%" }}
        isDisabled={pending || busy || tooLarge}
        accessibilityLabel={t("mobile.chat.attachment.openOrSave", { name: attachment.name })}
        accessibilityHint={tooLarge ? t("mobile.chat.attachment.tooLargeHint") : undefined}
        // The card is one element to a screen reader, so the progress inside it is read from here.
        accessibilityValue={upload !== undefined ? { min: 0, max: 100, now: Math.round(upload * 100) } : undefined}
        onPress={share}
      >
        <View className="size-11 items-center justify-center rounded-xl bg-success/15">
          <Typography.Paragraph type="body-xs" className="font-semibold" style={{ color: fileColor }}>
            {typeLabel}
          </Typography.Paragraph>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph type="body-sm" numberOfLines={2} className="font-semibold text-foreground">
            {attachment.name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-muted">
            {detail}
          </Typography.Paragraph>
        </View>
        {/* Where the share icon will be: the file's progress, then a check, then the icon. */}
        {shownUpload !== undefined ? (
          <UploadProgressCircle progress={shownUpload} />
        ) : (
          <ExternalLink size={18} color={muted} />
        )}
      </Button>
    </View>
  );
}
