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
import { supportLog } from "@/features/support/model/support-log";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { type MobileText, useText } from "@/shared/lib/text";
import { attachmentFrame, FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { playbackTime } from "../model/playback-time";
import { shareTypeOptions } from "../model/share-file-type";
import { knownImageDimensions, rememberImageDimensions, showFileFailure } from "./attachment-preview";
import { useListSettled } from "./use-list-settled";
import { useMediaDownloadedBytes, useMediaFile } from "./use-media-file";
import { VideoDownloadRing } from "./video-download-ring";
import { VideoViewer } from "./video-viewer";

const PLAY_OFFSET = { transform: [{ translateX: 1.5 }] };
const TABULAR = { fontVariant: ["tabular-nums" as const] };
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const SWAP_OUT: CSSTransitionProperties = {
  transitionProperty: ["opacity", "transform"],
  transitionDuration: 160,
  transitionTimingFunction: EASE_OUT,
};
const SWAP_IN: CSSTransitionProperties = { ...SWAP_OUT, transitionDuration: 200, transitionDelay: 80 };

const UNKNOWN_RATIO = 16 / 9;
const MAX_POSTERS = 24;
const POSTER_PIXELS = 720;
const POSTER_WAIT_MS = 8000;

interface VideoPoster {
  thumbnail: VideoThumbnail;
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
    let frameStarted = false;
    let lengthKnown = false;
    let thumbnail: VideoThumbnail | null = null;
    let duration: number | null = null;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      loaded.remove();
      status.remove();
      player.release();
    };
    const fail = (reason: string) => {
      supportLog.add("warn", "app", `Video poster: ${reason}`);
      if (active) setMissing(true);
      release();
    };
    const show = () => {
      if (!thumbnail) return;
      const next = { thumbnail, duration };
      if (active) setPoster(next);
      if (!lengthKnown) return;
      rememberPoster(key, next);
      release();
    };
    const takeFrame = () => {
      if (frameStarted || released) return;
      frameStarted = true;
      player
        .generateThumbnailsAsync([0], { maxWidth: POSTER_PIXELS, maxHeight: POSTER_PIXELS })
        .then(([frame]) => {
          if (!frame) throw new Error("The video has no frame.");
          thumbnail = frame;
          show();
        })
        .catch((error: unknown) => fail(`no frame (${error instanceof Error ? error.message : "unknown error"})`));
    };
    const setLength = (seconds: number) => {
      if (lengthKnown || released) return;
      lengthKnown = true;
      clearTimeout(timer);
      duration = seconds > 0 ? seconds : null;
      if (thumbnail) show();
      else takeFrame();
    };
    if (Platform.OS === "android") takeFrame();
    const status = player.addListener("statusChange", ({ status: next }) => {
      if (next === "error") {
        if (Platform.OS === "android") setLength(0);
        else fail("the player cannot read the file");
      } else if (next === "readyToPlay") setLength(player.duration);
    });
    const loaded = player.addListener("sourceLoad", (event) => setLength(event.duration));
    const timer = setTimeout(() => {
      if (Platform.OS === "android") setLength(0);
      else fail(`the player did not load in ${POSTER_WAIT_MS} ms`);
    }, POSTER_WAIT_MS);
    return () => {
      active = false;
      release();
    };
  }, [key, uri]);
  return { poster, missing };
}

async function runFileAction(action: () => Promise<void>, title: string, text: MobileText): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    showFileFailure(error, title, text);
    return false;
  }
}

export function shareMediaFile(uri: string, attachment: AttachmentSummary, text: MobileText): Promise<boolean> {
  return runFileAction(
    async () => {
      if (!(await Sharing.isAvailableAsync())) throw new Error(text.t("mobile.chat.attachment.sharingUnavailable"));
      await Sharing.shareAsync(uri, { ...shareTypeOptions(uri, attachment.mimeType), dialogTitle: attachment.name });
    },
    text.t("mobile.chat.attachment.openFailed"),
    text,
  );
}

export function ChatVideoAttachment({
  attachment,
  serverId,
  alignment = "left",
  unknownRatio = UNKNOWN_RATIO,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
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
  const posterWidth = poster?.thumbnail.width;
  const posterHeight = poster?.thumbnail.height;
  useEffect(() => {
    if (posterWidth && posterHeight)
      rememberImageDimensions(attachment.id, { width: posterWidth, height: posterHeight });
  }, [attachment.id, posterWidth, posterHeight]);
  const frame = attachmentFrame(poster?.thumbnail ?? knownImageDimensions(attachment.id), maxWidth, unknownRatio);
  const failed = Boolean(query.error);
  const reducedMotion = useReducedMotion();
  const live = useMediaDownloadedBytes(serverId, attachment.id);
  const [lastReceived, setLastReceived] = useState<number | null>(null);
  if (live !== null && live !== lastReceived) setLastReceived(live);
  const received = live ?? (uri || failed ? null : lastReceived);
  const downloads = lastReceived !== null;
  const waiting = !uri && !failed;
  const loading = waiting && received !== null;
  const progress = uri ? 1 : received !== null && attachment.size > 0 ? Math.min(1, received / attachment.size) : 0;
  const percent = Math.floor(progress * 100);
  const finishing = loading && received !== null && received >= attachment.size;
  const swapScale = (shown: boolean) => (shown || reducedMotion ? 1 : 0.9);

  async function share() {
    if (!uri) return;
    setBusy(true);
    await shareMediaFile(uri, attachment, text);
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
            waiting
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
                <Animated.View
                  className="absolute size-14 items-center justify-center rounded-full bg-black/50"
                  style={{ opacity: waiting ? 1 : 0, transform: [{ scale: swapScale(waiting) }], ...SWAP_OUT }}
                >
                  {loading && !finishing ? (
                    <Typography.Paragraph type="body-sm" className="font-semibold text-white" style={TABULAR}>
                      {format.percent(percent / 100)}
                    </Typography.Paragraph>
                  ) : (
                    <ActivityIndicator color="white" />
                  )}
                </Animated.View>
                <Animated.View
                  className="size-14 items-center justify-center rounded-full bg-black/50"
                  style={{ opacity: waiting ? 0 : 1, transform: [{ scale: swapScale(!waiting) }], ...SWAP_IN }}
                >
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
