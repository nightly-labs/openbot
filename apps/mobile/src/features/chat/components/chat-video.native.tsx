import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { createVideoPlayer, type VideoThumbnail } from "expo-video";
import { Button, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Play from "lucide-react-native/icons/play";
import VideoOff from "lucide-react-native/icons/video-off";
import { useEffect, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";
import { attachmentFrame, FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { useListSettled } from "./use-list-settled";
import { useMediaFile } from "./use-media-file";
import { VideoViewer } from "./video-viewer";

// The width reserved while the shape is still unknown: a screen recording from a desktop.
const UNKNOWN_RATIO = 16 / 9;
// A poster outlives its card, so a chat that scrolls back does not decode the video again.
const MAX_POSTERS = 24;
const POSTER_PIXELS = 720;

interface VideoPoster {
  thumbnail: VideoThumbnail;
  /** In seconds. */
  duration: number;
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
    const release = () => {
      if (released) return;
      released = true;
      loaded.remove();
      failed.remove();
      player.release();
    };
    // A file the device cannot decode gives no `sourceLoad`, only an error status.
    const failed = player.addListener("statusChange", ({ status }) => {
      if (status !== "error") return;
      if (active) setMissing(true);
      release();
    });
    const loaded = player.addListener("sourceLoad", ({ duration }) => {
      void player
        .generateThumbnailsAsync(0, { maxWidth: POSTER_PIXELS, maxHeight: POSTER_PIXELS })
        .then(([thumbnail]) => {
          if (!thumbnail) throw new Error("The video has no frame.");
          const next = { thumbnail, duration };
          rememberPoster(key, next);
          if (active) setPoster(next);
        })
        // No poster is not a failure: the card plays without one.
        .catch(() => {
          if (active) setMissing(true);
        })
        .finally(release);
    });
    return () => {
      active = false;
      release();
    };
  }, [key, uri]);
  return { poster, missing };
}

/** A length such as 0:42 or 1:02:05, as a player shows it. */
export function playbackTime(seconds: number, format: MobileText["format"]) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = format.number(total % 60, { minimumIntegerDigits: 2 });
  return hours > 0
    ? `${format.number(hours)}:${format.number(minutes, { minimumIntegerDigits: 2 })}:${rest}`
    : `${format.number(minutes)}:${rest}`;
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
}: {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
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
  const frame = attachmentFrame(poster?.thumbnail ?? null, maxWidth, UNKNOWN_RATIO);
  const failed = Boolean(query.error);

  async function share() {
    if (!uri) return;
    setBusy(true);
    await runFileAction(
      async () => {
        if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
        await Sharing.shareAsync(uri, { mimeType: attachment.mimeType, dialogTitle: attachment.name });
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
          accessibilityLabel={t("mobile.chat.video.play", { name: attachment.name })}
          accessibilityValue={poster ? { text: playbackTime(poster.duration, format) } : undefined}
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
              <View pointerEvents="none" className="items-center justify-center" style={FILL}>
                <View className="size-14 items-center justify-center rounded-full bg-black/50">
                  {/* Moved right by its own weight, so the triangle looks centred in the circle. */}
                  <Play size={26} color="white" fill="white" style={{ marginLeft: 3 }} />
                </View>
              </View>
              {poster ? (
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
