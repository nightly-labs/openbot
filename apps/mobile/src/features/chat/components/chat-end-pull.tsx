import { avatarHeadColor, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { GestureStateManager, type PanGestureConfig, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { knownChannelIcon } from "@/features/channels/model/channel-icons";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import type { ChatTarget } from "../model/chat-target";
import type { ChatMotion } from "./use-chat-motion";

/**
 * The list moves this far past its end before the ring starts: a short pull only moves the list, and
 * makes room above the message field, so the ring does not cover the last message. The iOS bounce
 * resists more than the Android pull, so iOS starts the ring at a smaller moved distance. On both
 * platforms the finger moves about 70 points before the ring starts.
 */
const PULL_DEAD_ZONE = isIOS ? 37 : 56;
/** After the dead zone, the list moves this much further while the ring fills. */
const PULL_DISTANCE = 48;
/**
 * Android does not bounce past the end, so the list moves up with the finger under this resistance,
 * as an iOS bounce does. The ring starts after about 70 dp of finger travel, as on iOS, and is full
 * after about 160 dp: the finger moves the list almost one to one at first.
 */
const ANDROID_BAND = 320;
const ANDROID_BAND_FACTOR = 0.95;
/**
 * An upward drag of this many points at the end of the list starts the Android pull. It must be less
 * than the touch slop of the Android scroll view, 8 dp: when the scroll view takes the touch, it
 * cancels the pull.
 */
const ANDROID_START = 6;
/**
 * A drag starts to move within this time. A finger that rests longer first is a touch and hold, such
 * as on a message, and its small drift is no pull.
 */
const ANDROID_HOLD_MS = 350;
/** The finger moved this far: it drags, it does not rest. */
const ANDROID_MOVE = 2;
/** A drag down or sideways of this many points is a scroll or a swipe: no pull. */
const ANDROID_CANCEL = 12;
const ANDROID_SETTLE = { duration: 350, dampingRatio: 1, reduceMotion: ReduceMotion.System };
/** The pull ticks at each part of its distance, and gives a heavy tap when it is full. */
const PULL_STEPS = 12;
/**
 * A full pull stays full until the reader pulls back under this share of it. A finger that stops at
 * the threshold often rolls back a little as it lifts, and that must not undo the pull.
 */
const DISARM_AT = 0.8;
const RESET = { duration: 200, reduceMotion: ReduceMotion.System };

const RING_SIZE = 44;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const AVATAR_SIZE = 26;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const POP_UP = { duration: 110, reduceMotion: ReduceMotion.System };
const POP_DOWN = { duration: 260, dampingRatio: 0.6, reduceMotion: ReduceMotion.System };

function pullHaptic(step: number) {
  if (step >= PULL_STEPS) void haptics.impact("heavy");
  else if (step > 0) void haptics.selection();
  // The reader pulled back from a full pull: a release now does nothing.
  else void haptics.impact("soft");
}

/**
 * A pull past the latest message of a chat. A ring above the message field fills while the reader
 * pulls, and a release with a full ring runs `onOpen`. The pull counts only from the place where the
 * list reached its end, as Legend List reports it: a touch or a scroll in the history is no pull. iOS
 * reads how far the list then bounces past its end. Android does not bounce, so a pan of the list
 * measures the pull there, and starts only at the end of the list. `gesture` is that pan: give it to
 * the list as `pullGesture`.
 */
export function useChatEndPull({
  motion,
  enabled,
  onOpen,
}: {
  motion: Pick<ChatMotion, "dragging" | "atEnd" | "scrollOffset">;
  enabled: boolean;
  onOpen: () => void;
}) {
  /** The pull, 0 to 1. */
  const progress = useSharedValue(0);
  const armed = useSharedValue(false);
  const on = useSharedValue(enabled);
  useEffect(() => {
    on.set(enabled);
  }, [enabled, on]);
  const openAction = useRef(onOpen);
  openAction.current = onOpen;
  const open = useCallback(() => openAction.current(), []);
  const { dragging, atEnd, scrollOffset } = motion;
  /** Android: how far the list moves up with the pull. Attach it to the list as `pullShift`. */
  const shift = useSharedValue(0);
  /** Android: the first touch of this drag, and the finger's travel when the pull started. */
  const touchStart = useSharedValue({ x: 0, y: 0, at: 0, moving: false });
  const pullStart = useSharedValue(0);
  /** Android: the pull has started. Its finger can then move sideways or back down freely. */
  const pulling = useSharedValue(false);
  /** The scroll offset where this drag reached the end of the list. Null while it is not at the end. */
  const endOffset = useSharedValue<number | null>(null);

  // Worklets: they run on the UI thread, from the scroll and from the pan.
  /** Takes how far the list has moved past its end, in points. */
  const update = useCallback(
    (moved: number) => {
      "worklet";
      const next = Math.min(1, Math.max(0, (moved - PULL_DEAD_ZONE) / PULL_DISTANCE));
      const previousStep = Math.floor(progress.get() * PULL_STEPS);
      const step = Math.floor(next * PULL_STEPS);
      const wasArmed = armed.get();
      const nowArmed = next >= 1 || (wasArmed && next >= DISARM_AT);
      progress.set(next);
      armed.set(nowArmed);
      // A tick for each part, the heavy tap once when the pull becomes full, and a soft tap when the
      // reader pulls back from it.
      if (nowArmed && !wasArmed) scheduleOnRN(pullHaptic, PULL_STEPS);
      else if (wasArmed && !nowArmed) scheduleOnRN(pullHaptic, 0);
      else if (step > previousStep && step < PULL_STEPS) scheduleOnRN(pullHaptic, step);
    },
    [progress, armed],
  );
  const release = useCallback(() => {
    "worklet";
    const opening = armed.get() && on.get();
    armed.set(false);
    endOffset.set(null);
    // The sheet takes the place of the ring at once. A pull that does not open empties the ring.
    if (opening) {
      scheduleOnRN(open);
      progress.set(0);
    } else if (progress.get() > 0) progress.set(withTiming(0, RESET));
  }, [armed, on, open, progress, endOffset]);

  // iOS: the bounce past the end while the finger is on the list. The release is the end of the drag.
  useAnimatedReaction(
    () => (isIOS && dragging.get() ? { offset: scrollOffset.get(), end: atEnd.get() } : null),
    (current, previous) => {
      if (current === null) {
        if (previous) release();
        return;
      }
      if (!previous) {
        // A new drag: it is no pull until it moves past the end.
        armed.set(false);
        endOffset.set(null);
      }
      if (!on.get()) return;
      if (!current.end) {
        // Back in the history: a later return to the end starts the pull again from there.
        endOffset.set(null);
        if (progress.get() > 0) update(0);
        return;
      }
      const start = endOffset.get();
      if (start === null) {
        endOffset.set(current.offset);
        return;
      }
      update(current.offset - start);
    },
  );

  // Android. A hook gesture, not `Gesture.Pan()`: gesture handler cancels the older gestures when a
  // native scroll view takes the touch, and the list does that at its end too. A hook gesture stays,
  // and takes the touch from the list when it starts. The memoized config keeps the gesture object
  // stable, so its callbacks need the worklet directive.
  const config = useMemo<PanGestureConfig>(
    () => ({
      enabled: isAndroid,
      // At the end of the list, an upward drag is the pull, and it starts before the scroll view can
      // take the touch. Elsewhere the list scrolls.
      manualActivation: true,
      onTouchesDown: (event) => {
        "worklet";
        const touch = event.allTouches[0];
        if (!on.get() || !touch) {
          GestureStateManager.fail(event.handlerTag);
          return;
        }
        touchStart.set({ x: touch.absoluteX, y: touch.absoluteY, at: Date.now(), moving: false });
        pulling.set(false);
      },
      onTouchesMove: (event) => {
        "worklet";
        const touch = event.allTouches[0];
        // Only the start of the drag decides between a pull, a scroll and a swipe.
        if (!touch || pulling.get()) return;
        const start = touchStart.get();
        const up = start.y - touch.absoluteY;
        const side = touch.absoluteX - start.x;
        if (!start.moving && Math.hypot(up, side) > ANDROID_MOVE) {
          // A finger that rested before it moved holds a message or a control: leave the touch to it.
          if (Date.now() - start.at > ANDROID_HOLD_MS) {
            GestureStateManager.fail(event.handlerTag);
            return;
          }
          touchStart.set({ ...start, moving: true });
        }
        if (Math.abs(side) > ANDROID_CANCEL || up < -ANDROID_CANCEL) GestureStateManager.fail(event.handlerTag);
        else if (up > ANDROID_START && atEnd.get()) GestureStateManager.activate(event.handlerTag);
      },
      onActivate: (event) => {
        "worklet";
        pulling.set(true);
        pullStart.set(event.translationY);
      },
      onUpdate: (event) => {
        "worklet";
        const travel = Math.max(0, pullStart.get() - event.translationY);
        const moved = ANDROID_BAND * (1 - 1 / ((travel * ANDROID_BAND_FACTOR) / ANDROID_BAND + 1));
        shift.set(moved);
        update(moved);
      },
      onFinalize: () => {
        "worklet";
        pulling.set(false);
        if (shift.get() > 0) shift.set(withSpring(0, ANDROID_SETTLE));
        release();
      },
    }),
    [on, atEnd, update, release, shift, touchStart, pullStart, pulling],
  );
  const gesture = usePanGesture(config);

  return { progress, armed, gesture, shift };
}

/** The most member colors in the gradient of a channel's ring. */
const MAX_RING_COLORS = 4;

/**
 * The colors of the ring, as the picture in it. An agent: its color. A channel with a picture: the
 * text color, white on dark and black on light. A channel with an icon: the icon's color. Else the
 * colors of the member faces, as a gradient, with the lead agent first.
 */
function ringColors(target: ChatTarget, leadAgentId: string | null, foreground: string, accent: string): string[] {
  if (target.kind === "agent") return [avatarHeadColor(target.avatarSeed, target.avatarHue, target.avatarColor)];
  if (target.imageUrl) return [foreground];
  const icon = knownChannelIcon(target.icon);
  if (icon) return [avatarHueSwatch(icon.hue)];
  const members = [...target.members].sort((a, b) => Number(b.id === leadAgentId) - Number(a.id === leadAgentId));
  const colors = [
    ...new Set(members.map((member) => avatarHeadColor(member.avatarSeed, member.avatarHue, member.avatarColor))),
  ];
  return colors.length ? colors.slice(0, MAX_RING_COLORS) : [accent];
}

/**
 * The ring of the pull past the latest message, above the message field, with the name of what a
 * release opens under it. It fills around the picture of the agent or the channel, in its colors, and
 * the picture pops when the pull is full. Screen readers skip it: the name in the header opens the
 * same info.
 */
export function ChatEndPullRing({
  pull: { progress, armed },
  target,
  leadAgentId = null,
}: {
  pull: Pick<ReturnType<typeof useChatEndPull>, "progress" | "armed">;
  target: ChatTarget;
  /** The lead agent of a channel: its color comes first in the gradient. */
  leadAgentId?: string | null;
}) {
  const { t } = useText();
  const [foreground, accent] = useThemeColor(["foreground", "accent"]);
  const colors = useMemo(
    () => ringColors(target, leadAgentId, String(foreground), String(accent)),
    [target, leadAgentId, foreground, accent],
  );
  const gradientId = `chat-pull-ring-${useId().replace(/:/g, "")}`;
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const pop = useSharedValue(1);
  // The ring is transparent until a pull, so its face holds still until then and draws no frames.
  const [pulling, setPulling] = useState(false);
  useAnimatedReaction(
    () => progress.get() > 0,
    (now, previous) => {
      if (now !== previous) scheduleOnRN(setPulling, now);
    },
  );
  useAnimatedReaction(
    () => armed.get(),
    (now, previous) => {
      if (now && previous === false) pop.set(withSequence(withTiming(1.15, POP_UP), withSpring(1, POP_DOWN)));
    },
  );
  const style = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: interpolate(value, [0, 0.15], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(value, [0, 1], [0.6, 1], Extrapolation.CLAMP) }],
    };
  });
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - progress.get()) }));
  const avatarStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute items-center gap-1 self-center"
      style={[{ bottom: "100%", marginBottom: 10 }, style]}
    >
      <View className="items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          {colors.length > 1 ? (
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                {colors.map((color, index) => (
                  <Stop key={color} offset={index / (colors.length - 1)} stopColor={color} />
                ))}
              </LinearGradient>
            </Defs>
          ) : null}
          <AnimatedCircle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.length > 1 ? `url(#${gradientId})` : colors[0]}
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_LENGTH}
            strokeLinecap="round"
            fill="none"
            animatedProps={ringProps}
          />
        </Svg>
        <Animated.View style={avatarStyle}>
          {target.kind === "agent" ? (
            <BloubAvatar
              agentId={target.id}
              serverId={target.serverId}
              hue={target.avatarHue}
              color={target.avatarColor}
              seed={target.avatarSeed}
              size={AVATAR_SIZE}
              paused={!pulling}
            />
          ) : (
            <ChannelAvatar
              channel={{
                id: target.id,
                members: target.members.map((member) => ({ agentId: member.id })),
                icon: target.icon,
                imageUrl: target.imageUrl,
              }}
              agents={members}
              size={AVATAR_SIZE}
              serverId={target.serverId}
            />
          )}
        </Animated.View>
      </View>
      <Typography.Paragraph type="body-sm" className="text-muted">
        {target.kind === "agent" ? t("mobile.chat.pullInfo.agent") : t("mobile.chat.pullInfo.channel")}
      </Typography.Paragraph>
    </Animated.View>
  );
}
