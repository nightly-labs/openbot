import type { AttachmentSummary, ImageGenerationAspectRatio, VideoGenerationInfo } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import X from "lucide-react-native/icons/x";
import { useWindowDimensions, View } from "react-native";
import { useText } from "@/shared/lib/text";
import { attachmentFrame, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { playbackTime } from "../model/playback-time";
import { ChatAttachmentView } from "./chat-attachment";
import type { ImageGenerationStatus } from "./chat-image-generation";
import { ImageGenerationCanvas } from "./image-generation-canvas";

/** The same shapes as desktop, until the video gives its first frame. */
function requestedRatio(aspectRatio: ImageGenerationAspectRatio) {
  if (aspectRatio === "portrait") return 9 / 16;
  if (aspectRatio === "square") return 1;
  return 16 / 9;
}

/**
 * A video that an agent makes: the canvas of an image generation while it is made, then the chat's
 * video card, which plays it. The frame keeps the size of that card, so the chat does not move when
 * the video arrives. A host without video generation sends only the video, which shows as a file.
 */
export function ChatVideoGeneration({
  generation,
  status,
  attachment,
  serverId,
}: {
  generation: VideoGenerationInfo;
  status: ImageGenerationStatus;
  attachment: AttachmentSummary | undefined;
  serverId: string;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const { t, format, sourceText } = useText();
  const [base, accent, surface, muted] = useThemeColor(["muted", "accent", "surface-secondary", "muted"]);
  const ratio = requestedRatio(generation.aspectRatio);
  const frame = attachmentFrame(null, Math.min(MAX_FRAME_WIDTH, windowWidth - 80), ratio);
  // The host marks the video completed, then copies its file. The copy ends with the file or with a
  // failure, so the canvas stays until then.
  const video = status === "completed" ? attachment : undefined;
  const failed = status === "failed" || status === "interrupted";
  const label =
    status === "failed"
      ? t("mobile.chat.videoGeneration.failed")
      : status === "interrupted"
        ? t("mobile.chat.videoGeneration.interrupted")
        : t("mobile.chat.videoGeneration.generating");
  const error =
    status === "failed"
      ? generation.error
        ? sourceText(generation.error)
        : t("mobile.chat.videoGeneration.didNotComplete")
      : status === "interrupted"
        ? generation.error
          ? sourceText(generation.error)
          : t("mobile.chat.videoGeneration.wasInterrupted")
        : null;
  // What the model was asked for. The finished video shows its real length on its card.
  const specs = [
    generation.durationSeconds ? playbackTime(generation.durationSeconds, format) : null,
    generation.resolution ?? null,
  ].filter((value): value is string => value !== null);

  return (
    <View className="max-w-full gap-2" accessibilityLiveRegion="polite">
      {video ? (
        <ChatAttachmentView attachment={video} serverId={serverId} videoRatio={ratio} />
      ) : (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          accessibilityState={{ busy: !failed }}
          style={{
            width: frame.width,
            height: frame.height,
            maxWidth: "100%",
            borderRadius: FRAME_RADIUS,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: surface,
          }}
        >
          <ImageGenerationCanvas
            width={frame.width}
            height={frame.height}
            running={!failed}
            failed={failed}
            base={base}
            accent={accent}
          />
          {failed ? (
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              <View className="size-10 items-center justify-center rounded-full bg-background/80">
                <X size={20} color={String(muted)} />
              </View>
            </View>
          ) : null}
          {!failed && specs.length > 0 ? (
            <View
              className="absolute top-2.5 left-2.5 flex-row gap-1.5 rounded-full bg-background/70 px-2 py-0.5"
              pointerEvents="none"
            >
              {specs.map((value) => (
                <Typography.Paragraph key={value} type="body-xs" className="text-muted">
                  {value}
                </Typography.Paragraph>
              ))}
            </View>
          ) : null}
          {!failed ? (
            <View
              className="absolute bottom-2.5 left-2.5 rounded-full bg-background/70 px-2.5 py-1"
              pointerEvents="none"
            >
              <Typography.Paragraph type="body-xs" className="font-semibold text-foreground">
                {label}
              </Typography.Paragraph>
            </View>
          ) : null}
        </View>
      )}
      {generation.prompt || error ? (
        <View className="gap-0.5 px-1" style={{ maxWidth: frame.width }}>
          {failed ? (
            <Typography.Paragraph type="body-sm" className="font-semibold text-foreground">
              {label}
            </Typography.Paragraph>
          ) : null}
          {generation.prompt ? (
            <Typography.Paragraph type="body-xs" numberOfLines={2} className="text-muted">
              “{generation.prompt}”
            </Typography.Paragraph>
          ) : null}
          {error ? (
            <Typography.Paragraph type="body-xs" accessibilityRole="alert" className="text-danger-text">
              {error}
            </Typography.Paragraph>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
