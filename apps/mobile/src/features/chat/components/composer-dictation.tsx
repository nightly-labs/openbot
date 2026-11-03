import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Lock from "lucide-react-native/icons/lock";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  type DerivedValue,
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import type { ComposerDictationStage } from "./use-composer-dictation";

/** A press longer than this is a hold: it dictates. A shorter one is a tap. */
const HOLD_MS = 250;
/** How far the finger slides up to lock dictation, and left to cancel it. */
const LOCK_DISTANCE = 72;
const CANCEL_DISTANCE = 96;
const PRESS_IN = { duration: 100, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System };
// A finger moved these, so they settle on springs that keep its velocity.
const SETTLE = { duration: 300, dampingRatio: 0.8, reduceMotion: ReduceMotion.System };
const SNAP = { duration: 400, dampingRatio: 0.8, reduceMotion: ReduceMotion.System };
const FADE = { duration: 160, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System };
const LEVEL_WEIGHTS = [0.55, 0.85, 1, 0.75, 0.6] as const;
/**
 * The slide ticks each time the finger travels this far toward the lock or toward cancel: 7 ticks on
 * the way to the lock, 10 to cancel. They grow stronger as the finger nears the threshold.
 */
const TICK_DISTANCE = 9;

/** What the hold drew so far. Every value lives on the UI thread. */
export interface HoldMotion {
  /** 0 at rest, 1 while the finger holds the mic. */
  held: SharedValue<number>;
  /** 0 or 1: the finger is down, before the hold starts. */
  pressed: SharedValue<number>;
  /** How far the finger slid, never past the mic: 0 or less. */
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  /** 0 nothing, 1 release locks, 2 release cancels. */
  armed: DerivedValue<0 | 1 | 2>;
}

export type HoldEnd = "release" | "lock" | "cancel";

function armFeedback(armed: number): void {
  // Stronger than the last detent, so the catch reads as the end of the slide.
  void haptics.impact(armed === 1 ? "heavy" : "rigid");
}

/** A detent of the slide, stronger near the threshold, so the finger feels how far it still has to go. */
function dragTick(progress: number): void {
  void haptics.impact(progress < 0.35 ? "soft" : progress < 0.7 ? "light" : "medium");
}

/** How far the finger slid toward a threshold, from 0 to 1. */
function slideProgress(drag: number, distance: number): number {
  "worklet";
  return Math.min(1, Math.max(0, -drag / distance));
}

/**
 * The gesture of a mic that dictates while held: a tap does `onTap`, a hold starts dictation, a slide
 * up locks it, and a slide left cancels it. The gesture and its motion run on the UI thread; only the
 * start and the end of a hold, and a crossed threshold, call into React.
 */
export function useHoldToDictate({
  enabled,
  onTap,
  onHoldStart,
  onHoldEnd,
}: {
  enabled: boolean;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: (end: HoldEnd) => void;
}) {
  const held = useSharedValue(0);
  const active = useSharedValue(false);
  const pressed = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const armed = useDerivedValue(() => {
    if (!active.get()) return 0;
    if (-dragX.get() >= CANCEL_DISTANCE) return 2;
    return -dragY.get() >= LOCK_DISTANCE ? 1 : 0;
  });
  // One firm hit when a threshold catches, on the frame the icons take the agent's colour.
  useAnimatedReaction(
    () => armed.get(),
    (now, previous) => {
      if (previous !== null && now !== previous && now !== 0) scheduleOnRN(armFeedback, now);
    },
  );
  // Detents on the way, a tick each few points of the slide that leads, so the finger feels the slide
  // build up before it catches. The step at the threshold itself is the firm hit above.
  useAnimatedReaction(
    () => {
      // No ticks outside a hold: the release and the slide home are not the user's slide.
      if (!active.get()) return -1;
      const up = -dragY.get();
      const left = -dragX.get();
      return left > up
        ? 1000 + Math.min(Math.floor(left / TICK_DISTANCE), Math.ceil(CANCEL_DISTANCE / TICK_DISTANCE) - 1)
        : Math.min(Math.floor(up / TICK_DISTANCE), Math.ceil(LOCK_DISTANCE / TICK_DISTANCE) - 1);
    },
    (now, previous) => {
      if (previous === null || previous === -1 || now === -1 || now === previous) return;
      if (now === 0 || now === 1000) return;
      const cancel = now >= 1000;
      const step = cancel ? now - 1000 : now;
      const progress = (step * TICK_DISTANCE) / (cancel ? CANCEL_DISTANCE : LOCK_DISTANCE);
      scheduleOnRN(dragTick, progress);
    },
  );
  // The gesture must outlive renders: a new gesture object re-attaches the detector and ends the hold
  // that the first words of dictation re-render the composer for.
  const handlers = useRef({ onTap, onHoldStart, onHoldEnd });
  useEffect(() => {
    handlers.current = { onTap, onHoldStart, onHoldEnd };
  });
  const tap = useCallback(() => handlers.current.onTap(), []);
  const holdStart = useCallback(() => handlers.current.onHoldStart(), []);
  const holdEnd = useCallback((end: HoldEnd) => handlers.current.onHoldEnd(end), []);
  const gesture = useMemo(() => {
    const hold = Gesture.Pan()
      .enabled(enabled)
      .hitSlop(4)
      .activateAfterLongPress(HOLD_MS)
      .onBegin(() => {
        pressed.set(withTiming(1, PRESS_IN));
      })
      .onStart(() => {
        active.set(true);
        held.set(withSpring(1, SETTLE));
        scheduleOnRN(holdStart);
      })
      .onUpdate((event) => {
        dragX.set(Math.min(0, event.translationX));
        dragY.set(Math.min(0, event.translationY));
      })
      .onEnd(() => {
        const state = armed.get();
        scheduleOnRN(holdEnd, state === 2 ? "cancel" : state === 1 ? "lock" : "release");
      })
      .onFinalize(() => {
        active.set(false);
        pressed.set(withTiming(0, PRESS_IN));
        held.set(withSpring(0, SETTLE));
        dragX.set(withSpring(0, SNAP));
        dragY.set(withSpring(0, SNAP));
      });
    const press = Gesture.Tap()
      .enabled(enabled)
      .hitSlop(4)
      .maxDuration(HOLD_MS)
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(tap);
      });
    return Gesture.Exclusive(hold, press);
  }, [enabled, active, armed, dragX, dragY, held, pressed, tap, holdStart, holdEnd]);
  const motion: HoldMotion = { held, pressed, dragX, dragY, armed };
  return { gesture, motion };
}

/**
 * The mic that dictates while held. It sinks under the finger on the press, fills with the agent's
 * colour when the hold starts, and shows the voice level in place of the mic. It stays where it is
 * while the finger slides: the lock and the cancel label answer the slide.
 */
export function HoldMic({
  gesture,
  motion,
  label,
  hint,
  dictateLabel,
  fill,
  glyph,
  onTap,
  onDictate,
  children,
}: {
  gesture: ReturnType<typeof useHoldToDictate>["gesture"];
  motion: HoldMotion;
  label: string;
  hint: string;
  /** The screen reader action that a hold stands for. */
  dictateLabel: string;
  fill: string;
  glyph: ReactNode;
  onTap: () => void;
  onDictate: () => void;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const { held, pressed } = motion;
  const bodyStyle = useAnimatedStyle(() => {
    const hold = held.get();
    return {
      // It keeps its size while held: Send sits right beside it, so a bigger mic would cover it.
      transform: reducedMotion ? [] : [{ scale: 1 - 0.06 * pressed.get() * (1 - Math.min(1, hold)) }],
    };
  });
  const fillStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, held.get()) }));
  const restGlyphStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, held.get()) }));
  const heldGlyphStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, held.get()) }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityActions={[{ name: "activate" }, { name: "dictate", label: dictateLabel }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "activate") onTap();
          else if (nativeEvent.actionName === "dictate") onDictate();
        }}
        style={[{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }, bodyStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", inset: 0, borderRadius: 20, backgroundColor: fill }, fillStyle]}
        />
        <Animated.View pointerEvents="none" style={restGlyphStyle}>
          {children}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: "absolute" }, heldGlyphStyle]}>
          {glyph}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** A glyph in the text colour that takes the agent's colour as `progress` goes from 0 to 1. */
function TintedGlyph({
  progress,
  from,
  to,
  children,
}: {
  progress: SharedValue<number>;
  from: number;
  to: number;
  children: (color: "rest" | "tint") => ReactNode;
}) {
  const restStyle = useAnimatedStyle(() => ({
    opacity: 1 - interpolate(progress.get(), [from, to], [0, 1], Extrapolation.CLAMP),
  }));
  const tintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [from, to], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={restStyle}>{children("rest")}</Animated.View>
      <Animated.View style={[{ position: "absolute" }, tintStyle]}>{children("tint")}</Animated.View>
    </View>
  );
}

/**
 * The lock above the held mic: the lock and two arrows, with no surface of their own. As the finger
 * slides up, the arrows and then the lock take the agent's colour, from the bottom; at the lock
 * distance all of it has the colour, and a release there keeps dictation on.
 */
export function DictationLockRail({
  motion,
  right,
  foreground,
  fill,
}: {
  motion: HoldMotion;
  /** From the right edge of the composer bar to the right edge of the held mic. */
  right: number;
  foreground: string;
  fill: string;
}) {
  const reducedMotion = useReducedMotion();
  const { held, dragY, armed } = motion;
  const railStyle = useAnimatedStyle(() => {
    const hold = Math.min(1, held.get());
    return { opacity: hold, transform: reducedMotion ? [] : [{ translateY: (1 - hold) * 12 }] };
  });
  // The slide fills the arrows; the catch at the lock fills the lock, on the frame of its tick.
  const progress = useDerivedValue(() =>
    armed.get() === 1 ? withTiming(1, FADE) : slideProgress(dragY.get(), LOCK_DISTANCE) * 0.85,
  );
  // The arrows nudge up while the hold waits, to say which way the finger goes.
  const nudge = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    nudge.set(withRepeat(withTiming(1, { duration: 700, easing: Easing.bezier(0.77, 0, 0.175, 1) }), -1, true));
    return () => cancelAnimation(nudge);
  }, [nudge, reducedMotion]);
  const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * nudge.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: "absolute", bottom: "100%", right, width: 40, marginBottom: 4, alignItems: "center", gap: 2 },
        railStyle,
      ]}
    >
      <TintedGlyph progress={progress} from={0.6} to={1}>
        {(tone) => <Lock color={tone === "tint" ? fill : foreground} size={18} strokeWidth={2} />}
      </TintedGlyph>
      <Animated.View style={[{ alignItems: "center", marginTop: 2 }, nudgeStyle]}>
        <TintedGlyph progress={progress} from={0.3} to={0.7}>
          {(tone) => <ChevronUp color={tone === "tint" ? fill : foreground} size={20} strokeWidth={2.2} />}
        </TintedGlyph>
        <View style={{ marginTop: -10 }}>
          <TintedGlyph progress={progress} from={0} to={0.4}>
            {(tone) => <ChevronUp color={tone === "tint" ? fill : foreground} size={20} strokeWidth={2.2} />}
          </TintedGlyph>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/** Bars that follow the microphone level, with round ends at every height. */
export function DictationLevel({ level, color }: { level: SharedValue<number>; color: string }) {
  return (
    <View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 20 }}>
      {LEVEL_WEIGHTS.map((weight) => (
        <DictationLevelBar key={weight} level={level} weight={weight} color={color} />
      ))}
    </View>
  );
}

function DictationLevelBar({ level, weight, color }: { level: SharedValue<number>; weight: number; color: string }) {
  const reducedMotion = useReducedMotion();
  // The height, not a scale: a scale squashes the round ends into squares. The bar is childless in a
  // box of fixed size, so its height lays out only itself.
  const style = useAnimatedStyle(() => ({
    height: reducedMotion ? 10 : 3 + 17 * Math.min(1, level.get() * weight * 1.4),
  }));
  return (
    <View style={{ width: 3, height: 20, justifyContent: "center" }}>
      <Animated.View
        style={[{ width: 3, borderRadius: 1.5, borderCurve: "continuous", backgroundColor: color }, style]}
      />
    </View>
  );
}

/** The time since dictation started. Its own component, so the tick re-renders only these digits. */
function DictationTimer({ color }: { color: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Typography.Paragraph
      accessible={false}
      type="body-sm"
      style={{ color, fontVariant: ["tabular-nums"], minWidth: 34 }}
    >
      {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
    </Typography.Paragraph>
  );
}

/** The red dot of a recording. It breathes while the user speaks, and holds still with reduced motion. */
function RecordingDot({ color }: { color: string }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    pulse.set(withRepeat(withTiming(1, { duration: 700, easing: Easing.bezier(0.77, 0, 0.175, 1) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reducedMotion]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - 0.6 * pulse.get() }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }, style]} />;
}

/**
 * The row under the dictated text, in place of the toolbar. While the finger holds the mic: the time
 * and "Slide to cancel". The label stays where it is and takes the agent's colour as the finger slides
 * left; at the cancel distance it turns into "Release to cancel". Once locked: the time; the control
 * at the end stops dictation and keeps the words.
 */
export function DictationStrip({
  stage,
  motion,
  presence,
  right,
  foreground,
  muted,
  accent,
}: {
  stage: ComposerDictationStage;
  motion: HoldMotion;
  presence: SharedValue<number>;
  /** The room the controls at the end of the row take. */
  right: number;
  foreground: string;
  muted: string;
  /** The agent's colour. */
  accent: string;
}) {
  const { t } = useText();
  const danger = String(useThemeColor("danger"));
  const reducedMotion = useReducedMotion();
  const { dragX, armed } = motion;
  const stripStyle = useAnimatedStyle(() => ({
    opacity: presence.get(),
    transform: reducedMotion ? [] : [{ translateY: (1 - presence.get()) * 6 }],
  }));
  const slide = useDerivedValue(() => slideProgress(dragX.get(), CANCEL_DISTANCE));
  const cancelArmed = useDerivedValue(() => withTiming(armed.get() === 2 ? 1 : 0, FADE));
  const slideStyle = useAnimatedStyle(() => ({ opacity: 1 - cancelArmed.get() }));
  const releaseStyle = useAnimatedStyle(() => ({ opacity: cancelArmed.get() }));
  const holding = stage === "holding";
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: 8,
          right,
          top: 0,
          bottom: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        stripStyle,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8 }}>
        <RecordingDot color={danger} />
        <DictationTimer color={foreground} />
      </View>
      {holding ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={slideStyle}>
            <TintedGlyph progress={slide} from={0} to={1}>
              {(tone) => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <ChevronLeft color={tone === "tint" ? accent : muted} size={16} strokeWidth={2} />
                  <Typography.Paragraph
                    numberOfLines={1}
                    type="body-sm"
                    style={{ color: tone === "tint" ? accent : muted }}
                  >
                    {t("mobile.chat.composer.slideToCancel")}
                  </Typography.Paragraph>
                </View>
              )}
            </TintedGlyph>
          </Animated.View>
          <Animated.View style={[{ position: "absolute" }, releaseStyle]}>
            <Typography.Paragraph numberOfLines={1} type="body-sm" style={{ color: accent, fontWeight: "600" }}>
              {t("mobile.chat.composer.releaseToCancel")}
            </Typography.Paragraph>
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  );
}
