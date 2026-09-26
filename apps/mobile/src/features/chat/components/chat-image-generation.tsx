import type { AttachmentSummary, ImageGenerationAspectRatio, ImageGenerationInfo } from "@openbot/contracts/ipc";
import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useText } from "@/shared/lib/text";
import type { ImageDimensions } from "../model/image-dimensions";
import { useAttachmentFile } from "./attachment-preview";
import { ImageGenerationCanvas } from "./image-generation-canvas";
import { ImageViewer } from "./image-viewer";

export type ImageGenerationStatus = "generating" | "completed" | "failed" | "interrupted";

const MAX_WIDTH = 300;
const MAX_HEIGHT = 380;
const REVEAL_DURATION = 720;
const REVEAL_EASING = Easing.bezier(0.23, 1, 0.32, 1);

/** The same mapping as desktop: a streaming message is still generating its image. */
export function imageGenerationStatus(streaming: boolean, status: string | undefined): ImageGenerationStatus {
  if (streaming || status === "streaming") return "generating";
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return "completed";
}

function requestedRatio(aspectRatio: ImageGenerationAspectRatio) {
  if (aspectRatio === "portrait") return 4 / 5;
  if (aspectRatio === "landscape") return 4 / 3;
  return 1;
}

/** The frame holds the requested shape until the image reports its own, so it does not jump. */
function generationFrame(ratio: number, maxWidth: number) {
  const width = Math.min(maxWidth, MAX_HEIGHT * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

export function ChatImageGeneration({
  generation,
  status,
  attachment,
  serverId,
}: {
  generation: ImageGenerationInfo;
  status: ImageGenerationStatus;
  attachment: AttachmentSummary | undefined;
  serverId: string;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const { t, sourceText } = useText();
  const [base, accent, surface, muted] = useThemeColor(["muted", "accent", "surface-secondary", "muted"]);
  const [previewError, setPreviewError] = useState(false);
  const [loaded, setLoaded] = useState<ImageDimensions | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [sourceHidden, setSourceHidden] = useState(false);
  const frameRef = useRef<View>(null);
  // Only an image the user watched being generated is revealed. History that scrolls back into
  // view shows its image at once: the reveal is news, and old news should not repeat.
  const [watched, setWatched] = useState(status === "generating");
  if (status === "generating" && !watched) setWatched(true);
  const file = useAttachmentFile(serverId, attachment ?? PLACEHOLDER, status === "completed" && Boolean(attachment));
  const unavailable = status === "completed" && !attachment;
  const downloadFailed = Boolean(file.query.error) || previewError;
  const failed = status === "failed" || status === "interrupted" || unavailable || downloadFailed;
  const ready = status === "completed" && Boolean(file.uri) && !downloadFailed;
  const dimensions = file.dimensions ?? loaded;
  const ratio = dimensions ? dimensions.width / dimensions.height : requestedRatio(generation.aspectRatio);
  const frame = generationFrame(ratio, Math.min(MAX_WIDTH, windowWidth - 64));
  const label = unavailable
    ? t("mobile.chat.imageGeneration.unavailable")
    : downloadFailed
      ? t("mobile.chat.imageGeneration.loadFailed")
      : status === "failed"
        ? t("mobile.chat.imageGeneration.failed")
        : status === "interrupted"
          ? t("mobile.chat.imageGeneration.interrupted")
          : ready && loaded
            ? t("mobile.chat.imageGeneration.image")
            : status === "completed"
              ? t("mobile.chat.imageGeneration.loading")
              : t("mobile.chat.imageGeneration.generating");
  const error = downloadFailed
    ? file.query.error
      ? sourceText(file.query.error.message)
      : t("mobile.chat.imageGeneration.previewUnavailable")
    : unavailable
      ? t("mobile.chat.imageGeneration.previewUnavailable")
      : status === "failed"
        ? generation.error
          ? sourceText(generation.error)
          : t("mobile.chat.imageGeneration.didNotComplete")
        : status === "interrupted"
          ? generation.error
            ? sourceText(generation.error)
            : t("mobile.chat.imageGeneration.wasInterrupted")
          : null;

  return (
    <View className="max-w-full gap-2" accessibilityLiveRegion="polite">
      <View
        ref={frameRef}
        collapsable={false}
        accessible={!loaded}
        accessibilityRole="image"
        accessibilityLabel={label}
        accessibilityState={{ busy: !failed && !loaded }}
        style={{
          width: frame.width,
          height: frame.height,
          maxWidth: "100%",
          borderRadius: 22,
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: surface,
        }}
      >
        {!revealed ? (
          <ImageGenerationCanvas
            width={frame.width}
            height={frame.height}
            running={!failed}
            failed={failed}
            base={base}
            accent={accent}
          />
        ) : null}
        {failed ? (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <View className="size-10 items-center justify-center rounded-full bg-background/80">
              <X size={20} color={String(muted)} />
            </View>
          </View>
        ) : null}
        {!revealed && generation.resolution ? (
          <View className="absolute top-2.5 left-2.5 rounded-full bg-background/70 px-2 py-0.5" pointerEvents="none">
            <Typography.Paragraph type="body-xs" className="text-muted">
              {generation.resolution}
            </Typography.Paragraph>
          </View>
        ) : null}
        {!revealed && !failed ? (
          // Inside the frame, so the caption below keeps its height when the image lands.
          <View className="absolute bottom-2.5 left-2.5 rounded-full bg-background/70 px-2.5 py-1" pointerEvents="none">
            <Typography.Paragraph type="body-xs" className="font-semibold text-foreground">
              {label}
            </Typography.Paragraph>
          </View>
        ) : null}
        {ready && file.uri ? (
          <GeneratedImageReveal
            uri={file.uri}
            width={frame.width}
            height={frame.height}
            prompt={generation.prompt}
            animate={watched}
            onLoad={(size) =>
              setLoaded((current) => (current?.width === size.width && current.height === size.height ? current : size))
            }
            onRevealed={() => setRevealed(true)}
            onError={() => setPreviewError(true)}
            hidden={sourceHidden}
            onPress={() => setViewing(true)}
          />
        ) : null}
      </View>
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
      {downloadFailed && attachment ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() => {
            setPreviewError(false);
            void file.query.refetch();
          }}
        >
          <Button.Label>{t("mobile.chat.attachment.retryImage")}</Button.Label>
        </Button>
      ) : null}
      {viewing && file.uri ? (
        <ImageViewer
          uri={file.uri}
          name={attachment?.name ?? t("mobile.chat.imageGeneration.image")}
          dimensions={dimensions ?? frame}
          measureOrigin={(report) =>
            frameRef.current
              ? frameRef.current.measureInWindow((x, y, width, height) => report({ x, y, width, height }))
              : report(null)
          }
          originRadius={22}
          busy={file.busy}
          onShare={file.share}
          onSave={file.saveToPhotos}
          onShown={() => setSourceHidden(true)}
          onDismissed={() => {
            setViewing(false);
            setSourceHidden(false);
          }}
        />
      ) : null}
    </View>
  );
}

const PLACEHOLDER: AttachmentSummary = {
  id: "image-generation-placeholder",
  name: "Generated image",
  size: 0,
  kind: "image",
  mimeType: "image/png",
  previewKind: "image",
  previewUrl: null,
};

/**
 * The image arrives through a feathered circle that grows from the centre of the canvas, where the
 * ripples started. Android masks in software, so it fades in instead, as does reduced motion.
 */
function GeneratedImageReveal({
  uri,
  width,
  height,
  prompt,
  animate,
  hidden,
  onLoad,
  onRevealed,
  onError,
  onPress,
}: {
  uri: string;
  width: number;
  height: number;
  prompt: string | undefined;
  animate: boolean;
  /** The viewer holds the image, so this copy steps aside until it returns. */
  hidden: boolean;
  onLoad: (size: ImageDimensions) => void;
  onRevealed: () => void;
  onError: () => void;
  onPress: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const masked = Platform.OS === "ios" && !reducedMotion && animate;
  const progress = useSharedValue(0);
  const { t } = useText();
  const [decoded, setDecoded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!decoded) return;
    progress.set(
      withTiming(
        1,
        {
          duration: animate && !reducedMotion ? REVEAL_DURATION : 150,
          easing: REVEAL_EASING,
          reduceMotion: ReduceMotion.Never,
        },
        (finished) => {
          if (finished) scheduleOnRN(setRevealed, true);
        },
      ),
    );
  }, [animate, decoded, progress, reducedMotion]);
  useEffect(() => {
    if (revealed) onRevealed();
  }, [revealed, onRevealed]);
  // The mask circle spans the frame's diagonal at full size, so its feathered edge clears the corners.
  const diameter = Math.hypot(width, height) * 1.25;
  const maskStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.04 + progress.get() * 0.96 }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: 1.03 - progress.get() * 0.03 }],
  }));
  const image = (
    // A plain pressable: a HeroUI button keeps its own side padding, which pushed the image off
    // the frame's right edge.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.imageGeneration.preview")}
      onPress={onPress}
      style={{ width, height }}
    >
      <Image
        source={uri}
        contentFit="cover"
        transition={0}
        accessibilityLabel={prompt ?? t("mobile.chat.imageGeneration.image")}
        style={{ width, height, opacity: hidden ? 0 : 1 }}
        onLoad={({ source }) => {
          setDecoded(true);
          if (source.width > 0 && source.height > 0) onLoad({ width: source.width, height: source.height });
        }}
        onError={onError}
      />
    </Pressable>
  );
  if (revealed || !masked)
    return (
      <Animated.View style={[{ position: "absolute", inset: 0 }, revealed ? null : fadeStyle]}>{image}</Animated.View>
    );
  return (
    <MaskedView
      style={{ position: "absolute", inset: 0 }}
      maskElement={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={[{ width: diameter, height: diameter }, maskStyle]}>
            <Svg width="100%" height="100%">
              <Defs>
                <RadialGradient id="generated-image-reveal" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#000" stopOpacity={1} />
                  <Stop offset="0.72" stopColor="#000" stopOpacity={1} />
                  <Stop offset="1" stopColor="#000" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#generated-image-reveal)" />
            </Svg>
          </Animated.View>
        </View>
      }
    >
      {image}
    </MaskedView>
  );
}
