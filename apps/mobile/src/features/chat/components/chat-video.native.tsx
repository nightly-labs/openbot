import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { createVideoPlayer, type VideoThumbnail } from "expo-video";
import { Button, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Play from "lucide-react-native/icons/play";
import VideoOff from "lucide-react-native/icons/video-off";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, useWindowDimensions, View } from "react-native";
import Animated, { type CSSTransitionProperties, cubicBezier } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { supportLog } from "@/features/support/model/support-log";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { type MobileText, useText } from "@/shared/lib/text";
import { attachmentFrame, FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { playbackTime } from "../model/playback-time";
import { shareTypeOptions } from "../model/share-file-type";
import { knownImageDimensions, rememberImageDimensions } from "./attachment-preview";
import { useListSettled } from "./use-list-settled";
import { useMediaDownloadedBytes, useMediaFile } from "./use-media-file";
import { VideoDownloadRing } from "./video-download-ring";
import { VideoViewer } from "./video-viewer";

const PLAY_OFFSET = { transform: [{ translateX: 1.5 }] };
// Digits of one width, so the text does not move as the numbers change.
const TABULAR = { fontVariant: ["tabular-nums" as const] };
// The percent leaves fast; the play button comes in a little after it, so the two do not overlap.
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const SWAP_OUT: CSSTransitionProperties = {
  transitionProperty: ["opacity", "transform"],
  transitionDuration: 160,
  transitionTimingFunction: EASE_OUT,
};
const SWAP_IN: CSSTransitionProperties = { ...SWAP_OUT, transitionDuration: 200, transitionDelay: 80 };

// The width reserved while the shape is still unknown: a screen recording from a desktop.
const UNKNOWN_RATIO = 16 / 9;
// A poster outlives its card, so a chat that scrolls back does not decode the video again.
const MAX_POSTERS = 24;
const POSTER_PIXELS = 720;
// How long the poster waits for the player to load the file.
const POSTER_WAIT_MS = 8000;

interface VideoPoster {
  thumbnail: VideoThumbnail;
  /** In seconds. Null when the player gave no length. */
  duration: number | null;
}

const posters = new Map<string, VideoPoster>();

function rememberPoster(key: string, poster: VideoPoster) {
  posters.delete(key);
  posters.set(key, poster);
  for (const oldest of posters.keys()) {
    if (posters.size <= MAX_POSTERS) break;
    posters.delete(oldest);
  }
}

/**
 * The first frame and the length of a video. A player that is never shown reads them, and is
 * released at once. `missing` is true when the video gives no frame; the card still plays then.
 */
function useVideoPoster(key: string, uri: string | null) {
  const [poster, setPoster] = useState(() => posters.get(key) ?? null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!uri) return;
    const known = posters.get(key);
    if (known) {
      setPoster(known);
      return;
    }
    let active = true;
    const player = createVideoPlayer(uri);
    player.muted = true;
    let released = false;
    let started = false;
    let frame: Promise<VideoThumbnail> | null = null;
    // Android reads the frame from the file, not from the player, so it can start before the player loads.
    const firstFrame = () =>
      (frame ??= player
        // An array, not one number: Android converts only an array to its list of times.
        .generateThumbnailsAsync([0], { maxWidth: POSTER_PIXELS, maxHeight: POSTER_PIXELS })
        .then(([thumbnail]) => {
          if (!thumbnail) throw new Error("The video has no frame.");
          return thumbnail;
        }));
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      loaded.remove();
      status.remove();
      player.release();
    };
    // No poster is not a failure: the card plays without one. The support log keeps the reason.
    const fail = (reason: string) => {
      supportLog.add("warn", "app", `Video poster: ${reason}`);
      if (active) setMissing(true);
      release();
    };
    const finish = (duration: number | null) => {
      if (started || released) return;
      started = true;
      void firstFrame()
        .then((thumbnail) => {
          const next = { thumbnail, duration };
          rememberPoster(key, next);
          if (active) setPoster(next);
          release();
        })
        .catch((error: unknown) => fail(`no frame (${error instanceof Error ? error.message : "unknown error"})`));
    };
    if (Platform.OS === "android") void firstFrame().catch(() => undefined);
    // A file the device cannot decode gives no `sourceLoad`, only an error status.
    const status = player.addListener("statusChange", ({ status: next }) => {
      // On Android the frame still comes from the file, without the length.
      if (next === "error") {
        if (Platform.OS === "android") finish(null);
        else fail("the player cannot read the file");
      } else if (next === "readyToPlay") finish(player.duration > 0 ? player.duration : null);
    });
    const loaded = player.addListener("sourceLoad", ({ duration }) => finish(duration > 0 ? duration : null));
    // A player with no view can stay unloaded on Android. The frame then still comes from the file, without the length.
    const timer = setTimeout(() => {
      if (Platform.OS === "android") finish(null);
      else fail(`the player did not load in ${POSTER_WAIT_MS} ms`);
    }, POSTER_WAIT_MS);
    return () => {
      active = false;
      release();
    };
  }, [key, uri]);
  return { poster, missing };
}

export async function runFileAction(action: () => Promise<void>, title: string, text: MobileText): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    void haptics.notification("error");
    showFailureAlert(
      error,
      "turn",
      title,
      error instanceof Error ? text.sourceText(error.message) : text.t("mobile.chat.tryAgain"),
    );
    return false;
  }
}

/**
 * A video from the chat: its first frame, its length and a play button, in a frame of the video's
 * shape. A tap opens it in the player.
 */
export function ChatVideoAttachment({
  attachment,
  serverId,
  alignment = "left",
  unknownRatio = UNKNOWN_RATIO,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
  /** The width over height of the frame until the video gives its first frame. */
  unknownRatio?: number;
}) {
  const text = useText();
  const { t, format, sourceText } = text;
  const muted = useThemeColor("muted");
  const { width } = useWindowDimensions();
  const settled = useListSettled();
  const query = useMediaFile(serverId, attachment, settled);
  const uri = query.data ?? null;
  const { poster, missing } = useVideoPoster(`${serverId}:${attachment.id}`, settled ? uri : null);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const maxWidth = Math.min(MAX_FRAME_WIDTH, width - 80);
  // The phone keeps the shape of a video that it showed before, as it does for an image. The frame
  // then has its final size before the video downloads, also in a later launch.
  const posterWidth = poster?.thumbnail.width;
  const posterHeight = poster?.thumbnail.height;
  useEffect(() => {
    if (posterWidth && posterHeight)
      rememberImageDimensions(attachment.id, { width: posterWidth, height: posterHeight });
  }, [attachment.id, posterWidth, posterHeight]);
  const frame = attachmentFrame(poster?.thumbnail ?? knownImageDimensions(attachment.id), maxWidth, unknownRatio);
  const failed = Boolean(query.error);
  const reducedMotion = useReducedMotion();
  const received = useMediaDownloadedBytes(serverId, attachment.id);
  // A file that is already on the phone shows no download line.
  const [downloads] = useState(() => !uri);
  const loading = !uri && !failed;
  const progress = uri ? 1 : received !== null && attachment.size > 0 ? Math.min(1, received / attachment.size) : 0;
  const percent = Math.floor(progress * 100);
  // Every byte is on the phone; the file is still handed over and written. A spinner, not a frozen 100%.
  const finishing = loading && received !== null && received >= attachment.size;
  const swapScale = (shown: boolean) => (shown || reducedMotion ? 1 : 0.9);

  async function share() {
    if (!uri) return;
    setBusy(true);
    await runFileAction(
      async () => {
        if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
        await Sharing.shareAsync(uri, { ...shareTypeOptions(uri, attachment.mimeType), dialogTitle: attachment.name });
      },
      t("mobile.chat.attachment.openFailed"),
      text,
    );
    setBusy(false);
  }

  async function saveToPhotos() {
    if (!uri) return false;
    setBusy(true);
    const saved = await runFileAction(
      async () => {
        const MediaLibrary = await import("expo-media-library").catch(() => null);
        if (!MediaLibrary) throw new Error(t("mobile.chat.attachment.photosNeedUpdate"));
        if (!(await MediaLibrary.requestPermissionsAsync(true, ["video"])).granted)
          throw new Error(t("mobile.chat.video.photosPermission"));
        await MediaLibrary.Asset.create(uri);
      },
      t("mobile.chat.video.saveFailed"),
      text,
    );
    setBusy(false);
    return saved;
  }

  return (
    <View className={`max-w-full gap-2 ${alignment === "right" ? "items-end" : "items-start"}`}>
      <View
        className="bg-control"
        style={{
          width: frame.width,
          height: frame.height,
          maxWidth: "100%",
          borderRadius: FRAME_RADIUS,
          borderCurve: "continuous",
          overflow: "hidden",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            loading
              ? t("mobile.chat.video.loading", { name: attachment.name })
              : t("mobile.chat.video.play", { name: attachment.name })
          }
          accessibilityValue={
            loading
              ? { min: 0, max: 100, now: percent }
              : poster?.duration
                ? { text: playbackTime(poster.duration, format) }
                : undefined
          }
          accessibilityState={{ disabled: !uri, busy: query.isFetching }}
          disabled={!uri}
          onPress={() => {
            void haptics.impact("soft");
            setViewing(true);
          }}
          style={FILL}
        >
          {failed ? (
            <View className="items-center justify-center gap-2 p-3" style={FILL}>
              <VideoOff size={24} color={String(muted)} />
              <Typography.Paragraph type="body-xs" align="center" className="text-muted">
                {query.error ? sourceText(query.error.message) : t("mobile.chat.attachment.unavailable")}
              </Typography.Paragraph>
            </View>
          ) : (
            <>
              <Skeleton
                isLoading={!posterLoaded && !missing}
                accessible={false}
                className="rounded-none"
                style={FILL}
              />
              {poster ? (
                <Image
                  source={poster.thumbnail}
                  contentFit="contain"
                  transition={220}
                  accessible={false}
                  style={FILL}
                  onLoad={() => setPosterLoaded(true)}
                />
              ) : null}
              {downloads ? (
                <VideoDownloadRing width={frame.width} height={frame.height} progress={progress} done={!loading} />
              ) : null}
              <View pointerEvents="none" className="items-center justify-center" style={FILL}>
                {/* While the file downloads, the circle of the play button shows how much has arrived. */}
                <Animated.View
                  className="absolute size-14 items-center justify-center rounded-full bg-black/50"
                  style={{ opacity: loading ? 1 : 0, transform: [{ scale: swapScale(loading) }], ...SWAP_OUT }}
                >
                  {finishing ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Typography.Paragraph type="body-sm" className="font-semibold text-white" style={TABULAR}>
                      {format.percent(percent / 100)}
                    </Typography.Paragraph>
                  )}
                </Animated.View>
                <Animated.View
                  className="size-14 items-center justify-center rounded-full bg-black/50"
                  style={{ opacity: loading ? 0 : 1, transform: [{ scale: swapScale(!loading) }], ...SWAP_IN }}
                >
                  {/* Moved right by its own weight, so the triangle looks centred in the circle. A transform,
                      because React Native moves a left margin to the right in a right-to-left layout. */}
                  <Play size={26} color="white" fill="white" style={PLAY_OFFSET} />
                </Animated.View>
              </View>
              {loading && received !== null && !finishing ? (
                <View pointerEvents="none" className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5">
                  <Typography.Paragraph type="body-xs" className="font-semibold text-white" style={TABULAR}>
                    {t("mobile.chat.video.downloaded", {
                      received: format.fileSizeAmount(received, attachment.size),
                      total: format.fileSize(attachment.size),
                    })}
                  </Typography.Paragraph>
                </View>
              ) : poster?.duration ? (
                <View pointerEvents="none" className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5">
                  <Typography.Paragraph type="body-xs" className="font-semibold text-white">
                    {playbackTime(poster.duration, format)}
                  </Typography.Paragraph>
                </View>
              ) : null}
            </>
          )}
        </Pressable>
      </View>
      {failed ? (
        <Button variant="ghost" size="sm" onPress={() => void query.refetch()}>
          <Button.Label>{t("mobile.chat.video.retry")}</Button.Label>
        </Button>
      ) : null}
      {viewing && uri ? (
        <VideoViewer
          uri={uri}
          name={attachment.name}
          busy={busy}
          onShare={() => void share()}
          onSave={saveToPhotos}
          onDismissed={() => setViewing(false)}
        />
      ) : null}
    </View>
  );
}
