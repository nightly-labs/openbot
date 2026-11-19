import { CHAT_COLOR_PRESETS, type ChatColorPresetId } from "@openbot/brand/chat-colors";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { ScopedTheme } from "uniwind";
import { useReducedMotion } from "@/shared/lib/motion";
import { END_X } from "@/shared/lib/text-direction";

// Grey wireframe pictures for the picture choices in Settings. Each one is still until `play` grows,
// then plays its demonstration once. Reduced motion keeps them still. Colors come from the theme
// tokens; only a message color picture shows a real color, because the color is the setting.

/** The curve of an iOS sheet or keyboard: a fast start and a long, soft end. */
const SLIDE = Easing.bezier(0.32, 0.72, 0, 1);
const OUT = Easing.out(Easing.cubic);
const IN_OUT = Easing.inOut(Easing.quad);
/** A line types out from the start of the reading direction: the left, or the right in RTL. */
const LINE_START_ORIGIN = END_X === 1 ? "0% 50%" : "100% 50%";

/**
 * Runs `run` once for each new tap: when `play` grows. A change of reduced motion or of a prop does
 * not play the demonstration again. With reduced motion, the picture stays still.
 */
function useDemonstration(play: number, run: () => void) {
  const reduced = useReducedMotion();
  const played = useRef(play);
  useEffect(() => {
    // `play` goes back to 0 when another option is tapped. Only a larger value is a new tap.
    const grew = play > played.current;
    played.current = play;
    if (grew && !reduced) run();
  });
}

function presetColor(id: ChatColorPresetId): string {
  return CHAT_COLOR_PRESETS.find((preset) => preset.id === id)?.value ?? CHAT_COLOR_PRESETS[0].value;
}

/** A line of text or a bar in a picture. `strong` is a darker line, such as your own message. */
function Bar({ className, strong = false }: { className: string; strong?: boolean }) {
  return (
    <View
      className={`rounded-full ${strong ? "bg-grouped-secondary" : "bg-grouped-border"} ${className}`}
      style={strong ? { opacity: 0.55 } : undefined}
    />
  );
}

/** An agent face: the shape of an avatar with two eyes. */
function Face({ className, eyeStyle }: { className: string; eyeStyle?: ReturnType<typeof useAnimatedStyle> }) {
  return (
    <View className={`items-center justify-center rounded-[7px] ${className}`}>
      <View className="absolute inset-0 rounded-[7px] bg-grouped-secondary" style={{ opacity: 0.55 }} />
      <View className="flex-row gap-[5px]">
        <Animated.View className="h-[5px] w-[3px] rounded-full bg-sheet" style={eyeStyle} />
        <Animated.View className="h-[5px] w-[3px] rounded-full bg-sheet" style={eyeStyle} />
      </View>
    </View>
  );
}

/** Settings > Animations: an agent face and a reply. With full motion, the face moves and the reply types out. */
export function MotionPicture({ full, play }: { full: boolean; play: number }) {
  const lift = useSharedValue(0);
  const blink = useSharedValue(1);
  const line0 = useSharedValue(1);
  const line1 = useSharedValue(1);
  const line2 = useSharedValue(1);
  useDemonstration(play, () => {
    if (!full) return;
    const bob = { duration: 260, easing: IN_OUT };
    lift.value = withSequence(withTiming(-3, bob), withTiming(0, bob), withTiming(-3, bob), withTiming(0, bob));
    blink.value = withDelay(520, withSequence(withTiming(0.1, { duration: 80 }), withTiming(1, { duration: 120 })));
    [line0, line1, line2].forEach((line, index) => {
      line.value = 0;
      line.value = withDelay(120 + index * 160, withTiming(1, { duration: 380, easing: OUT }));
    });
  });
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  const lineStyles = [
    useAnimatedStyle(() => ({ transform: [{ scaleX: line0.value }] })),
    useAnimatedStyle(() => ({ transform: [{ scaleX: line1.value }] })),
    useAnimatedStyle(() => ({ transform: [{ scaleX: line2.value }] })),
  ];
  return (
    <View className="flex-1">
      {full ? (
        <>
          <View className="absolute bottom-[40px] left-[7px] size-3 rounded-full border-t-[1.5px] border-l-[1.5px] border-grouped-secondary" />
          <View
            className="absolute bottom-[44px] left-[3px] size-5 rounded-full border-t-[1.5px] border-l-[1.5px] border-grouped-secondary"
            style={{ opacity: 0.5 }}
          />
        </>
      ) : null}
      <Animated.View className="absolute bottom-3.5 left-3" style={faceStyle}>
        <Face className="size-[22px]" eyeStyle={eyeStyle} />
      </Animated.View>
      <View className="absolute right-3 bottom-3.5 left-[42px] gap-[5px]">
        {(["w-[92%]", "w-[74%]", "w-[46%]"] as const).map((width, index) => (
          <Animated.View
            key={width}
            className={`h-1.5 rounded-full bg-grouped-border ${width}`}
            style={[{ transformOrigin: LINE_START_ORIGIN }, lineStyles[index]]}
          />
        ))}
      </View>
    </View>
  );
}

/** A small chat in the theme around it: two messages and your reply. */
function ThemeScene() {
  return (
    <View className="absolute inset-0 bg-sheet">
      <Bar className="absolute bottom-[34px] left-2 h-1.5 w-[58%]" />
      <Bar strong className="absolute right-2 bottom-[23px] h-1.5 w-[44%]" />
      <Bar className="absolute bottom-3 left-2 h-1.5 w-1/2" />
    </View>
  );
}

/**
 * Settings > Appearance > Theme. System shows both themes side by side; its demonstration turns
 * the picture dark and then light, as the phone does through the day.
 */
export function ThemePicture({ mode, play }: { mode: "system" | "light" | "dark"; play: number }) {
  const dark = useSharedValue(0);
  const light = useSharedValue(0);
  useDemonstration(play, () => {
    if (mode !== "system") return;
    const fade = { duration: 280, easing: IN_OUT };
    dark.value = withSequence(withTiming(1, fade), withDelay(420, withTiming(0, fade)));
    light.value = withDelay(700, withSequence(withTiming(1, fade), withDelay(420, withTiming(0, fade))));
  });
  const darkStyle = useAnimatedStyle(() => ({ opacity: dark.value }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.value }));
  if (mode !== "system") {
    return (
      <ScopedTheme theme={mode}>
        <ThemeScene />
      </ScopedTheme>
    );
  }
  return (
    <View className="flex-1">
      <ScopedTheme theme="light">
        <ThemeScene />
      </ScopedTheme>
      {/* The dark half keeps the full width of the picture, so its lines continue those of the light half. */}
      <View className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
        <View className="absolute inset-y-0 right-0 w-[200%]">
          <ScopedTheme theme="dark">
            <ThemeScene />
          </ScopedTheme>
        </View>
      </View>
      <Animated.View className="absolute inset-0" style={darkStyle}>
        <ScopedTheme theme="dark">
          <ThemeScene />
        </ScopedTheme>
      </Animated.View>
      <Animated.View className="absolute inset-0" style={lightStyle}>
        <ScopedTheme theme="light">
          <ThemeScene />
        </ScopedTheme>
      </Animated.View>
    </View>
  );
}

/**
 * Settings > Appearance > Message color: your message above an agent's reply. With Agent color,
 * the demonstration changes your message through the colors of three agents.
 */
export function MessageColorPicture({
  mode,
  customColor,
  play,
}: {
  mode: "none" | "agent" | "custom";
  customColor: string;
  play: number;
}) {
  const second = useSharedValue(0);
  const third = useSharedValue(0);
  useDemonstration(play, () => {
    if (mode !== "agent") return;
    const fade = { duration: 240, easing: IN_OUT };
    second.value = withSequence(withTiming(1, fade), withDelay(900, withTiming(0, fade)));
    third.value = withDelay(660, withSequence(withTiming(1, fade), withDelay(700, withTiming(0, fade))));
  });
  const secondStyle = useAnimatedStyle(() => ({ opacity: second.value }));
  const thirdStyle = useAnimatedStyle(() => ({ opacity: third.value }));
  return (
    <View className="flex-1">
      <View className="absolute top-[22%] right-2.5 h-[18px] w-[56%] overflow-hidden rounded-[9px] rounded-br-[3px]">
        {mode === "none" ? (
          <View className="absolute inset-0 bg-grouped-secondary" style={{ opacity: 0.55 }} />
        ) : mode === "custom" ? (
          <View className="absolute inset-0" style={{ backgroundColor: customColor }} />
        ) : (
          <>
            <View className="absolute inset-0" style={{ backgroundColor: presetColor("yellow") }} />
            <Animated.View
              className="absolute inset-0"
              style={[{ backgroundColor: presetColor("blue") }, secondStyle]}
            />
            <Animated.View
              className="absolute inset-0"
              style={[{ backgroundColor: presetColor("green") }, thirdStyle]}
            />
          </>
        )}
      </View>
      <View className="absolute bottom-[34%] left-2.5 h-4 w-[52%] rounded-[9px] rounded-bl-[3px] bg-grouped-border" />
      <View
        className="absolute bottom-[14%] left-2.5 size-3.5 rounded-[5px] bg-grouped-secondary"
        style={{ opacity: 0.55 }}
      />
    </View>
  );
}

/** The height of the keyboard in a message field picture. */
const KEYBOARD_HEIGHT = 36;

/**
 * Settings > Conversations > Message field. The demonstration opens and closes the keyboard; a
 * compact field grows into the full field while the keyboard is open.
 */
export function ComposerPicture({ compact, play }: { compact: boolean; play: number }) {
  const open = useSharedValue(0);
  const small = useSharedValue(1);
  useDemonstration(play, () => {
    const slide = { duration: 300, easing: SLIDE };
    open.value = withSequence(withTiming(1, slide), withDelay(700, withTiming(0, slide)));
    if (compact)
      small.value = withSequence(withTiming(0, { duration: 160 }), withDelay(840, withTiming(1, { duration: 200 })));
  });
  const keyboardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - open.value) * KEYBOARD_HEIGHT }] }));
  const fieldStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -open.value * KEYBOARD_HEIGHT }] }));
  const smallStyle = useAnimatedStyle(() => ({ opacity: small.value }));
  const wideStyle = useAnimatedStyle(() => ({ opacity: 1 - small.value }));
  return (
    <View className="flex-1">
      <Bar className="absolute top-3 left-2.5 h-3 w-1/2" />
      <Animated.View className="absolute right-2.5 bottom-2.5 left-2.5 h-3.5" style={fieldStyle}>
        {compact ? (
          <>
            <Animated.View className="absolute inset-y-0 left-[26%] w-[48%]" style={smallStyle}>
              <Bar strong className="h-3.5 w-full" />
            </Animated.View>
            <Animated.View className="absolute inset-0" style={wideStyle}>
              <Bar strong className="h-3.5 w-full" />
            </Animated.View>
          </>
        ) : (
          <Bar strong className="h-3.5 w-full" />
        )}
      </Animated.View>
      <Animated.View
        className="absolute inset-x-0 bottom-0 gap-1 border-grouped-border border-t bg-grouped p-1.5"
        style={[{ height: KEYBOARD_HEIGHT }, keyboardStyle]}
      >
        <Bar className="h-[5px] w-full" />
        <Bar className="mx-2 h-[5px]" />
        <Bar className="mx-5 h-[5px]" />
      </Animated.View>
    </View>
  );
}

/** The part of the picture that the chat moves aside for the panel. */
const PANEL_SHARE = 0.54;

/** With "off", the chat moves a little with the swipe and comes back: no screen opens. */
const OFF_NUDGE = 0.08;

/**
 * Settings > Conversations > swipe in an agent chat. The picture shows the panel open beside the
 * chat; the demonstration closes it and opens it again, as a swipe does. "Off" shows only the chat.
 */
export function SwipePicture({ target, play }: { target: "question" | "threads" | "browser" | "off"; play: number }) {
  const width = useSharedValue(0);
  const shown = useSharedValue(1);
  useDemonstration(play, () => {
    const slide = { duration: 320, easing: SLIDE };
    shown.value =
      target === "off"
        ? withSequence(withTiming(0, { duration: 220, easing: OUT }), withTiming(1, { duration: 360, easing: SLIDE }))
        : withSequence(withTiming(0, slide), withDelay(600, withTiming(1, slide)));
  });
  // React Native mirrors the layout in RTL (the panel opens from the left), but not translateX.
  const chatStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          target === "off"
            ? -END_X * (1 - shown.value) * width.value * OFF_NUDGE
            : -END_X * shown.value * width.value * (PANEL_SHARE - 0.08),
      },
    ],
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: END_X * (1 - shown.value) * width.value * PANEL_SHARE }],
  }));
  return (
    <View
      className="flex-1"
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      <Animated.View className="absolute inset-0 gap-1.5 px-2.5 py-3" style={chatStyle}>
        <Bar className="h-[7px] w-[70%]" />
        <Bar strong className="h-[7px] w-1/2 self-end" />
        <Bar className="h-[7px] w-[70%]" />
      </Animated.View>
      {target === "off" ? null : (
        <Animated.View
          className="absolute inset-y-0 right-0 gap-1.5 border-grouped-border border-l bg-grouped px-2 py-2.5"
          style={[{ width: `${PANEL_SHARE * 100}%` }, panelStyle]}
        >
          {target === "question" ? (
            <>
              <Bar strong className="h-[7px] w-[60%] self-end" />
              <Bar className="h-1.5 w-full" />
              <Bar className="h-1.5 w-[70%]" />
            </>
          ) : target === "threads" ? (
            <>
              <Bar strong className="h-[7px] w-[55%]" />
              <Bar className="h-1.5 w-full" />
              <Bar className="h-1.5 w-[60%]" />
              <Bar className="h-1.5 w-full" />
            </>
          ) : (
            <>
              <Bar className="h-3 w-full" />
              <View className="h-[38px] w-full rounded-md bg-grouped-border" style={{ opacity: 0.7 }} />
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}
