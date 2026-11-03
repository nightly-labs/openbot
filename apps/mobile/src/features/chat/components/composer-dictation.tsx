import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Mic from "lucide-react-native/icons/mic";
import Square from "lucide-react-native/icons/square";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/shared/lib/motion";

const PRESS_IN = { duration: 100, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System };
/** One bar of the wave, the space after it, and the box it moves in. */
const WAVE_BAR = 3;
const WAVE_PITCH = 5;
const WAVE_HEIGHT = 22;
/** The wave takes one sample of the voice each this many milliseconds, and moves one bar left. */
const WAVE_SAMPLE_MS = 70;
/** The samples kept: more than the widest strip has bars. */
const WAVE_SAMPLES = 120;
/** The first bars on the left fade in over this many bars, so the oldest speech leaves softly. */
const WAVE_FADE_BARS = 6;

/**
 * The mic beside the main control. A tap starts dictation hands-free; while dictation listens, the
 * mic turns into Stop, and a tap stops it and keeps the words. The press and the change of glyph run
 * on the UI thread; only the tap itself calls into React.
 */
export function DictationMic({
  active,
  presence,
  enabled,
  label,
  foreground,
  onPress,
}: {
  active: boolean;
  /** 0 with the mic, 1 with Stop. */
  presence: SharedValue<number>;
  enabled: boolean;
  label: string;
  foreground: string;
  onPress: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const danger = String(useThemeColor("danger"));
  const pressed = useSharedValue(0);
  // The gesture must outlive renders: each word of dictation re-renders the composer.
  const handler = useRef(onPress);
  useEffect(() => {
    handler.current = onPress;
  });
  const press = useCallback(() => handler.current(), []);
  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(enabled)
        .hitSlop(4)
        .onBegin(() => {
          pressed.set(withTiming(1, PRESS_IN));
        })
        .onEnd((_event, success) => {
          if (success) scheduleOnRN(press);
        })
        .onFinalize(() => {
          pressed.set(withTiming(0, PRESS_IN));
        }),
    [enabled, pressed, press],
  );
  const bodyStyle = useAnimatedStyle(() => ({
    transform: reducedMotion ? [] : [{ scale: 1 - 0.06 * pressed.get() }],
  }));
  const micStyle = useAnimatedStyle(() => ({
    opacity: 1 - presence.get(),
    transform: reducedMotion ? [] : [{ scale: 1 - 0.25 * presence.get() }],
  }));
  const stopStyle = useAnimatedStyle(() => ({
    opacity: presence.get(),
    transform: reducedMotion ? [] : [{ scale: 0.75 + 0.25 * presence.get() }],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled, selected: active }}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (enabled && nativeEvent.actionName === "activate") onPress();
        }}
        style={[{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }, bodyStyle]}
      >
        <Animated.View pointerEvents="none" style={micStyle}>
          <Mic color={foreground} size={21} strokeWidth={1.8} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: "absolute" }, stopStyle]}>
          <Square color={danger} fill={danger} size={15} strokeWidth={2} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * A wave of the user's speech: each bar is the loudest moment of a short slice of time, the newest
 * comes in at the right, and the wave glides left as the user speaks. The sampling and the glide run
 * in a frame callback on the UI thread; React only lays the bars out once for the width.
 */
function DictationWave({ level, color }: { level: SharedValue<number>; color: string }) {
  const reducedMotion = useReducedMotion();
  const [count, setCount] = useState(0);
  const [silence] = useState(() => new Array<number>(WAVE_SAMPLES).fill(0));
  const samples = useSharedValue(silence);
  const peak = useSharedValue(0);
  const elapsed = useSharedValue(0);
  useFrameCallback((frame) => {
    peak.set(Math.max(peak.get(), level.get()));
    const time = elapsed.get() + (frame.timeSincePreviousFrame ?? 0);
    if (time >= WAVE_SAMPLE_MS) {
      const loudest = peak.get();
      samples.modify((list) => {
        "worklet";
        list.shift();
        list.push(loudest);
        return list;
      });
      peak.set(0);
    }
    elapsed.set(time % WAVE_SAMPLE_MS);
  });
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reducedMotion ? 0 : (-WAVE_PITCH * elapsed.get()) / WAVE_SAMPLE_MS }],
  }));
  // One bar more than fits: it comes in from under the right edge while the wave glides.
  const bars = Math.min(WAVE_SAMPLES, count + 1);
  return (
    <View
      pointerEvents="none"
      style={{ flex: 1, height: WAVE_HEIGHT, overflow: "hidden" }}
      onLayout={({ nativeEvent }) => {
        const next = Math.floor(nativeEvent.layout.width / WAVE_PITCH);
        setCount((current) => (current === next ? current : next));
      }}
    >
      <Animated.View style={[{ flexDirection: "row", alignItems: "center", height: WAVE_HEIGHT }, rowStyle]}>
        {Array.from({ length: bars }, (_, index) => (
          <DictationWaveBar
            // The bars never reorder: the samples move through them.
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed slot of the wave, not an item.
            key={index}
            samples={samples}
            sample={WAVE_SAMPLES - bars + index}
            opacity={Math.min(1, (index + 1) / WAVE_FADE_BARS)}
            color={color}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function DictationWaveBar({
  samples,
  sample,
  opacity,
  color,
}: {
  samples: SharedValue<number[]>;
  sample: number;
  opacity: number;
  color: string;
}) {
  // The height, not a scale: a scale squashes the round ends into squares. The bar is childless in a
  // box of fixed size, so its height lays out only itself.
  const style = useAnimatedStyle(() => ({
    height: WAVE_BAR + (WAVE_HEIGHT - WAVE_BAR) * Math.min(1, (samples.get()[sample] ?? 0) * 1.4),
  }));
  return (
    <View style={{ width: WAVE_PITCH, height: WAVE_HEIGHT, justifyContent: "center", opacity }}>
      <Animated.View
        style={[
          { width: WAVE_BAR, borderRadius: WAVE_BAR / 2, borderCurve: "continuous", backgroundColor: color },
          style,
        ]}
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
 * The row under the dictated text, in place of the toolbar: the recording dot, the time, and the wave
 * of the user's speech up to the Stop control.
 */
export function DictationStrip({
  level,
  presence,
  right,
  foreground,
  accent,
}: {
  level: SharedValue<number>;
  presence: SharedValue<number>;
  /** The room the controls at the end of the row take. */
  right: number;
  foreground: string;
  /** The agent's colour. */
  accent: string;
}) {
  const danger = String(useThemeColor("danger"));
  const reducedMotion = useReducedMotion();
  const stripStyle = useAnimatedStyle(() => ({
    opacity: presence.get(),
    transform: reducedMotion ? [] : [{ translateY: (1 - presence.get()) * 6 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
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
      <DictationWave level={level} color={accent} />
    </Animated.View>
  );
}
