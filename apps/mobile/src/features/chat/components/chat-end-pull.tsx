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

const PULL_DEAD_ZONE = isIOS ? 37 : 56;
const PULL_DISTANCE = 48;
const ANDROID_BAND = 320;
const ANDROID_BAND_FACTOR = 0.95;
const ANDROID_START = 6;
const ANDROID_HOLD_MS = 350;
const ANDROID_MOVE = 2;
const ANDROID_CANCEL = 12;
const ANDROID_SETTLE = { duration: 350, dampingRatio: 1, reduceMotion: ReduceMotion.System };
const PULL_STEPS = 12;
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
  else void haptics.impact("soft");
}

export function useChatEndPull({
  motion,
  enabled,
  onOpen,
}: {
  motion: Pick<ChatMotion, "dragging" | "atEnd" | "scrollOffset">;
  enabled: boolean;
  onOpen: () => void;
}) {
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
  const shift = useSharedValue(0);
  const touchStart = useSharedValue({ x: 0, y: 0, at: 0, moving: false });
  const pullStart = useSharedValue(0);
  const pulling = useSharedValue(false);
  const endOffset = useSharedValue<number | null>(null);

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
    if (opening) {
      scheduleOnRN(open);
      progress.set(0);
    } else if (progress.get() > 0) progress.set(withTiming(0, RESET));
  }, [armed, on, open, progress, endOffset]);

  useAnimatedReaction(
    () => (isIOS && dragging.get() ? { offset: scrollOffset.get(), end: atEnd.get() } : null),
    (current, previous) => {
      if (current === null) {
        if (previous) release();
        return;
      }
      if (!previous) {
        armed.set(false);
        endOffset.set(null);
      }
      if (!on.get()) return;
      if (!current.end) {
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

  const config = useMemo<PanGestureConfig>(
    () => ({
      enabled: isAndroid,
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
        if (!touch || pulling.get()) return;
        const start = touchStart.get();
        const up = start.y - touch.absoluteY;
        const side = touch.absoluteX - start.x;
        if (!start.moving && Math.hypot(up, side) > ANDROID_MOVE) {
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

const MAX_RING_COLORS = 4;

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

export function ChatEndPullRing({
  pull: { progress, armed },
  target,
  leadAgentId = null,
}: {
  pull: Pick<ReturnType<typeof useChatEndPull>, "progress" | "armed">;
  target: ChatTarget;
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
