import type { AttachmentSummary } from "@openbot/contracts/ipc";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, type VideoPlayer } from "expo-video";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Pause from "lucide-react-native/icons/pause";
import Play from "lucide-react-native/icons/play";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Share from "lucide-react-native/icons/share";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useUniwind } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { useAudioWaveform, WAVEFORM_BARS } from "../model/audio-waveforms";
import type { AttachmentTint } from "./chat-attachment";
import { playbackTime, runFileAction } from "./chat-video.native";
import { useHistoryShown } from "./use-history-shown";
import { useListSettled } from "./use-list-settled";
import { useMediaFile } from "./use-media-file";

/** How often the position moves, in seconds. */
const TIME_STEP = 0.1;
const TABULAR = { fontVariant: ["tabular-nums" as const] };
/** The speeds the speed button goes through, in order, from normal speed. */
const SPEEDS = [1, 1.5, 2, 0.5] as const;
/** The waveform, in points: as on desktop, thin round bars from a dot to the full height. */
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MIN = 3;
const WAVE_HEIGHT = 24;
/**
 * A seek takes a moment, and the player reports the old time until it lands. The card shows the
 * new time until a report is this close to it, in seconds, or until the wait below has passed.
 */
const SEEK_TOLERANCE = 0.75;
const SEEK_WAIT_MS = 1_500;
/** How far a screen reader's swipe moves the position, in seconds. */
const ACCESSIBILITY_STEP = 5;

/** One audio file plays at a time: a second one pauses the first. */
let playing: VideoPlayer | null = null;

/**
 * Follows a player: whether it plays, where it is, its length, and whether it failed. `seekTo`
 * moves the player and shows the new time at once. Without a player nothing plays yet.
 */
function usePlayback(player: VideoPlayer | null) {
  const [state, setState] = useState({ playing: false, time: 0, duration: 0, failed: false, ready: false });
  const pendingSeek = useRef<{ target: number; until: number } | null>(null);
  const seekTo = useCallback(
    (seconds: number) => {
      if (!player) return;
      pendingSeek.current = { target: seconds, until: Date.now() + SEEK_WAIT_MS };
      player.currentTime = seconds;
      setState((current) => ({ ...current, time: seconds }));
    },
    [player],
  );
  useEffect(() => {
    if (!player) return;
    player.timeUpdateEventInterval = TIME_STEP;
    const update = (next: Partial<typeof state>) => setState((current) => ({ ...current, ...next }));
    const subscriptions = [
      player.addListener("playingChange", ({ isPlaying }) => update({ playing: isPlaying })),
      player.addListener("timeUpdate", ({ currentTime }) => {
        const pending = pendingSeek.current;
        if (pending) {
          // A report from before the seek landed would move the bars back for a moment.
          if (Math.abs(currentTime - pending.target) > SEEK_TOLERANCE && Date.now() < pending.until) return;
          pendingSeek.current = null;
        }
        update({ time: currentTime });
      }),
      player.addListener("sourceLoad", ({ duration }) => update({ duration, ready: true })),
      player.addListener("statusChange", ({ status }) => {
        if (status === "error") update({ failed: true, playing: false });
        else if (status === "readyToPlay")
          update(player.duration > 0 ? { ready: true, duration: player.duration } : { ready: true });
      }),
      // The player stays at the end; the next play starts again from the beginning.
      player.addListener("playToEnd", () => {
        player.pause();
        pendingSeek.current = null;
        player.currentTime = 0;
        update({ playing: false, time: 0 });
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      if (playing === player) playing = null;
    };
  }, [player]);
  return { ...state, seekTo };
}

interface AudioAttachmentProps {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
  tint?: AttachmentTint;
}

/**
 * An audio file from the chat, such as an MP3, drawn as desktop draws a voice message: a play
 * button, the waveform, which the user taps or drags to move the position, the time and the
 * speed. The card has the same height in every state. The file downloads when the chat shows its
 * history and does not scroll, so the card knows its length and shape before the first play.
 */
export function ChatAudioAttachment(props: AudioAttachmentProps) {
  const { attachment, serverId } = props;
  const settled = useListSettled();
  const historyShown = useHistoryShown();
  const query = useMediaFile(serverId, attachment, settled && historyShown);
  const uri = query.data ?? null;
  // The player is made with the file: each player is a native media player, and a card without its
  // file has nothing to play.
  return uri ? (
    <AudioWithPlayer {...props} query={query} uri={uri} />
  ) : (
    <AudioCard {...props} query={query} uri={null} player={null} />
  );
}

type MediaFileQuery = ReturnType<typeof useMediaFile>;

function AudioWithPlayer(props: AudioAttachmentProps & { query: MediaFileQuery; uri: string }) {
  const player = useVideoPlayer(props.uri);
  return <AudioCard {...props} player={player} />;
}

function AudioCard({
  attachment,
  serverId,
  alignment = "left",
  tint,
  query,
  uri,
  player,
}: AudioAttachmentProps & { query: MediaFileQuery; uri: string | null; player: VideoPlayer | null }) {
  const text = useText();
  const { t, format, sourceText } = text;
  const [muted, themeAccentForeground, foreground] = useThemeColor(["muted", "accent-foreground", "foreground"]);
  const { theme } = useUniwind();
  // On the agent color the icon is white in dark mode, and dark in light mode, as the user's
  // messages are. Without agent colors the button has the chat background and the text color.
  const accentForeground = tint
    ? theme === "dark"
      ? String(themeAccentForeground)
      : tint.foreground
    : String(foreground);
  const { width } = useWindowDimensions();
  const playback = usePlayback(player);
  const waveform = useAudioWaveform(`${serverId}:${attachment.id}`, uri);
  // While a finger is on the waveform, the bars follow it and the player waits for the release.
  const [scrub, setScrub] = useState<number | null>(null);
  const [resumeAfterScrub, setResumeAfterScrub] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [sharing, setSharing] = useState(false);
  const maxWidth = Math.min(MAX_FRAME_WIDTH, width - 80);
  const failed = Boolean(query.error) || playback.failed;
  const loading = !failed && (!uri || !playback.ready);
  const duration = playback.duration;
  const position = Math.min(scrub ?? playback.time, duration || 0);
  // A drag stops the sound only for a moment, so the button keeps its pause icon.
  const shownPlaying = playback.playing || resumeAfterScrub;
  const started = shownPlaying || position > 0;

  function toggle() {
    if (!player) return;
    void haptics.impact("soft");
    if (player.playing) {
      player.pause();
      return;
    }
    if (playing && playing !== player) playing.pause();
    playing = player;
    player.playbackRate = speed;
    player.play();
  }

  function seek(seconds: number) {
    playback.seekTo(Math.max(0, Math.min(duration, seconds)));
    setScrub(null);
  }

  // A drag stops the sound while the finger moves, and plays again from the new place on release.
  function startScrub() {
    if (!player?.playing) return;
    setResumeAfterScrub(true);
    player.pause();
  }

  function endScrub(seconds: number | null) {
    if (seconds === null) setScrub(null);
    else seek(seconds);
    if (!resumeAfterScrub) return;
    setResumeAfterScrub(false);
    player?.play();
  }

  function changeSpeed() {
    void haptics.selection();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    // On iOS a new rate starts a paused player, so a paused card takes the speed at the next play.
    if (player?.playing) player.playbackRate = next;
  }

  async function share() {
    if (!uri) return;
    setSharing(true);
    await runFileAction(
      async () => {
        if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
        await Sharing.shareAsync(uri, { mimeType: attachment.mimeType, dialogTitle: attachment.name });
      },
      t("mobile.chat.attachment.openFailed"),
      text,
    );
    setSharing(false);
  }

  const speedLabel = t("mobile.chat.audio.speedValue", { speed: format.number(speed) });

  return (
    <View className={`max-w-full ${alignment === "right" ? "items-end" : "items-start"}`}>
      <View
        className="flex-row items-center gap-3 rounded-2xl border border-border bg-control p-3"
        style={{ width: maxWidth, maxWidth: "100%", borderCurve: "continuous" }}
      >
        {query.error ? (
          <Button
            isIconOnly
            variant="secondary"
            className="size-11 rounded-full"
            accessibilityLabel={t("mobile.chat.audio.retry")}
            onPress={() => {
              void haptics.selection();
              void query.refetch();
            }}
          >
            <RotateCw size={20} color={String(muted)} />
          </Button>
        ) : (
          <Button
            isIconOnly
            variant="primary"
            className={`size-11 rounded-full ${tint ? "" : "bg-background"}`}
            style={tint ? { backgroundColor: tint.color } : undefined}
            // The press highlight is the theme accent, which would flash over the agent color.
            feedbackVariant="scale"
            isDisabled={loading || failed}
            accessibilityLabel={
              shownPlaying
                ? t("mobile.chat.audio.pause", { name: attachment.name })
                : t("mobile.chat.audio.play", { name: attachment.name })
            }
            accessibilityState={{ busy: loading }}
            onPress={toggle}
          >
            {loading ? (
              <Spinner size="sm" color={String(accentForeground)} />
            ) : shownPlaying ? (
              <Pause size={20} color={String(accentForeground)} fill={String(accentForeground)} />
            ) : (
              // Moved right by its own weight, so the triangle looks centred in the circle.
              <Play
                size={20}
                color={String(accentForeground)}
                fill={String(accentForeground)}
                style={{ marginLeft: 2 }}
              />
            )}
          </Button>
        )}
        <View className="min-w-0 flex-1 gap-1">
          <View className="h-6 flex-row items-center gap-1">
            <Typography.Paragraph
              type="body-sm"
              numberOfLines={1}
              className="min-w-0 flex-1 font-semibold text-foreground"
            >
              {attachment.name}
            </Typography.Paragraph>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              className="size-6 min-w-6"
              isDisabled={!uri || sharing}
              accessibilityLabel={t("mobile.chat.attachment.openOrSave", { name: attachment.name })}
              onPress={() => {
                void haptics.selection();
                void share();
              }}
            >
              <Share size={15} color={String(muted)} />
            </Button>
          </View>
          <View className="flex-row items-center gap-2" style={{ height: WAVE_HEIGHT + 4 }}>
            {failed ? (
              <Typography.Paragraph type="body-xs" numberOfLines={1} className="min-w-0 flex-1 text-muted">
                {query.error ? sourceText(query.error.message) : t("mobile.chat.audio.unplayable")}
              </Typography.Paragraph>
            ) : (
              <AudioWaveform
                peaks={Array.isArray(waveform) ? waveform : null}
                progress={duration > 0 ? position / duration : 0}
                showProgress={started || scrub !== null}
                playedColor={tint?.color ?? String(foreground)}
                disabled={loading || duration <= 0}
                label={t("mobile.chat.audio.position")}
                value={t("mobile.chat.audio.positionValue", {
                  elapsed: playbackTime(position, format),
                  duration: playbackTime(duration, format),
                })}
                onScrubStart={startScrub}
                onScrub={(fraction) => setScrub(fraction * duration)}
                onScrubEnd={(fraction) => endScrub(fraction === null ? null : fraction * duration)}
                onSeek={(fraction) => seek(fraction * duration)}
                onStep={(direction) => seek(position + direction * ACCESSIBILITY_STEP)}
              />
            )}
            <Typography.Paragraph
              type="body-xs"
              className="text-muted"
              style={[TABULAR, { minWidth: 30, textAlign: "right" }]}
            >
              {duration > 0 ? playbackTime(started || scrub !== null ? position : duration, format) : ""}
            </Typography.Paragraph>
            <Button
              variant="secondary"
              size="sm"
              // A fixed width, so the button does not change size with its label.
              className="h-6 w-12 min-w-0 rounded-full px-0"
              isDisabled={loading || failed}
              accessibilityLabel={t("mobile.chat.audio.speed")}
              accessibilityValue={{ text: speedLabel }}
              onPress={changeSpeed}
            >
              <Button.Label className="text-xs" style={[TABULAR, { color: tint?.color ?? String(foreground) }]}>
                {speedLabel}
              </Button.Label>
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Takes `count` bars from the peaks, each the loudest of the peaks it covers. */
function resample(peaks: readonly number[], count: number): number[] {
  if (count >= peaks.length) return [...peaks];
  return Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * peaks.length) / count);
    const stop = Math.max(start + 1, Math.floor(((bar + 1) * peaks.length) / count));
    return Math.max(...peaks.slice(start, stop));
  });
}

/**
 * The waveform as the position bar. A tap moves the position there; a drag follows the finger and
 * moves it on release. A vertical drag stays with the chat, so the list still scrolls. A file with
 * no shape yet shows flat bars, as desktop does.
 */
function AudioWaveform({
  peaks,
  progress,
  showProgress,
  playedColor,
  disabled,
  label,
  value,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onSeek,
  onStep,
}: {
  peaks: readonly number[] | null;
  progress: number;
  showProgress: boolean;
  /** The color of the played bars. */
  playedColor: string;
  disabled: boolean;
  label: string;
  value: string;
  onScrubStart: () => void;
  onScrub: (fraction: number) => void;
  /** The place where a drag ended, or null when the system cancelled it. */
  onScrubEnd: (fraction: number | null) => void;
  /** The place of a tap. */
  onSeek: (fraction: number) => void;
  onStep: (direction: 1 | -1) => void;
}) {
  const muted = useThemeColor("muted");
  const [trackWidth, setTrackWidth] = useState(0);
  const count = Math.max(1, Math.min(WAVEFORM_BARS, Math.floor((trackWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP))));
  // Each bar is its place in the waveform, which is a stable key.
  const bars = useMemo(
    () => (peaks ? resample(peaks, count) : new Array<number>(count).fill(0)).map((peak, place) => ({ peak, place })),
    [peaks, count],
  );
  const fraction = (x: number) => (trackWidth > 0 ? Math.max(0, Math.min(1, x / trackWidth)) : 0);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!disabled)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart(onScrubStart)
    .onUpdate((event) => onScrub(fraction(event.x)))
    .onEnd((event, success) => {
      if (!success) {
        onScrubEnd(null);
        return;
      }
      void haptics.selection();
      onScrubEnd(fraction(event.x));
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .enabled(!disabled)
    .onEnd((event, success) => {
      if (!success) return;
      void haptics.selection();
      onSeek(fraction(event.x));
    });
  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (disabled) return;
          if (nativeEvent.actionName === "increment") onStep(1);
          else if (nativeEvent.actionName === "decrement") onStep(-1);
        }}
        className="min-w-0 flex-1 flex-row items-center justify-between"
        style={{ height: WAVE_HEIGHT + 4 }}
        onLayout={(event) => setTrackWidth(Math.round(event.nativeEvent.layout.width))}
      >
        {bars.map(({ peak, place }) => {
          const played = showProgress && (place + 0.5) / bars.length <= progress;
          return (
            <View
              key={place}
              style={{
                width: BAR_WIDTH,
                height: BAR_MIN + peak * (WAVE_HEIGHT - BAR_MIN),
                borderRadius: BAR_WIDTH / 2,
                backgroundColor: played ? playedColor : String(muted),
                opacity: played ? 1 : 0.45,
              }}
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}
