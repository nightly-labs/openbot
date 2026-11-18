import { type AppLogoColor, DEFAULT_APP_LOGO_COLOR } from "@openbot/contracts/app-logo-color";
import {
  BlendColor,
  Blur,
  Canvas,
  Group,
  Image,
  LinearGradient,
  Paint,
  RoundedRect,
  type SkImage,
  type Transforms3d,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { I18nManager, Platform, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  cubicBezier,
  Easing,
  interpolateColor,
  ReduceMotion,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";
import eyesAsset from "@/assets/icons/app-icon.icon/Assets/eyes.png";
import { SettingsContent } from "@/features/settings/components/settings-content";
import {
  APP_ICON_LABELS,
  APP_ICONS,
  appIconLook,
  loadAppIcon,
  saveAppIcon,
  useAppIcon,
} from "@/features/settings/model/app-icon";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const COUNT = APP_ICONS.length;
const LAST = COUNT - 1;
/** Settles a release or a tap on the next icon. A flick keeps its speed. */
const SNAP = { duration: 400, dampingRatio: 0.8, reduceMotion: ReduceMotion.System } as const;
const DIGIT_SPRING = { duration: 350, dampingRatio: 0.9, reduceMotion: ReduceMotion.System } as const;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** The share of a drag past the first or the last icon that moves the row. */
const RUBBER = 0.35;
/** The eyes of the main icon: 72% of its width, on its middle line. */
const EYES_WIDTH = 0.72;
const EYES_ASPECT = 1584 / 3480;
const DIGIT_HEIGHT = 34;
/** The row runs from the bottom left to the top right: the rise for each point of width. */
const SLOPE = 0.42;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/** Past the ends the row follows the finger less, so the edge reads as an edge. */
function rubberBand(value: number): number {
  "worklet";
  if (value < 0) return value * RUBBER;
  if (value > LAST) return LAST + (value - LAST) * RUBBER;
  return value;
}

/** 1 when the icon `index` is in the middle, 0 one step or more away. */
function closeness(progress: number, index: number): number {
  "worklet";
  return 1 - clamp(Math.abs(progress - index), 0, 1);
}

function shade(hex: string, factor: number): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((at) =>
    Math.round(clamp(Number.parseInt(value.slice(at, at + 2), 16) * factor, 0, 255))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

/**
 * The app icon picker. The icons sit on a line from the bottom left to the top right: the selected one
 * in the middle, sharp and large; the others smaller, turned and blurred. A drag or a tap on a side icon moves the row, and the
 * number, the name and the button follow. All motion runs on the UI thread; React renders once per
 * step for the button and for assistive technology.
 */
export function AppIconSettingsScreen() {
  const { t } = useText();
  const reduced = useReducedMotion();
  const { value, ready, saving } = useAppIcon();
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const eyes = useImage(eyesAsset);

  const startIndex = Math.max(0, APP_ICONS.indexOf(value ?? DEFAULT_APP_LOGO_COLOR));
  const [index, setIndex] = useState(startIndex);
  const progress = useSharedValue(startIndex);
  const dragStart = useSharedValue(0);
  // The selected icon. The button blends from the old one to the new one, so it does not jump.
  const fromCurrent = useSharedValue(startIndex);
  const toCurrent = useSharedValue(startIndex);
  const currentMix = useSharedValue(1);
  const placed = useRef(value !== null);

  useEffect(() => {
    void loadAppIcon().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (value === null) return;
    const next = APP_ICONS.indexOf(value);
    if (!placed.current) {
      // The icon loaded after the first render: the row starts there, without motion.
      placed.current = true;
      progress.set(next);
      fromCurrent.set(next);
      toCurrent.set(next);
      setIndex(next);
      return;
    }
    if (next === toCurrent.get()) return;
    fromCurrent.set(toCurrent.get());
    toCurrent.set(next);
    currentMix.set(0);
    currentMix.set(withTiming(1, { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
  }, [value, progress, fromCurrent, toCurrent, currentMix]);

  const step = (next: number) => {
    setIndex(next);
    setError(null);
    void haptics.selection();
  };

  useAnimatedReaction(
    () => clamp(Math.round(progress.get()), 0, LAST),
    (next, previous) => {
      if (previous !== null && next !== previous) scheduleOnRN(step, next);
    },
  );

  const direction = I18nManager.isRTL ? -1 : 1;
  const size = Math.min(width * 0.4, 168);
  const spacing = width * 0.4;
  // Room for the neighbors above and below the middle icon, with their turn and blur.
  const canvasHeight = spacing * SLOPE * 2 + size * 0.95;

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => {
      cancelAnimation(progress);
      dragStart.set(progress.get());
    })
    .onUpdate((event) => {
      progress.set(rubberBand(dragStart.get() - (event.translationX * direction) / spacing));
    })
    .onEnd((event) => {
      const velocity = (-event.velocityX * direction) / spacing;
      const target = clamp(Math.round(progress.get() + velocity * 0.15), 0, LAST);
      progress.set(withSpring(target, { ...SNAP, velocity }));
    });

  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((event, success) => {
      if (!success) return;
      const offset = (event.x - width / 2) * direction;
      if (Math.abs(offset) < size / 2) return;
      const target = clamp(Math.round(progress.get()) + Math.sign(offset), 0, LAST);
      progress.set(withSpring(target, SNAP));
    });

  const moveTo = (target: number) => {
    progress.set(withSpring(clamp(target, 0, LAST), SNAP));
  };

  const color = APP_ICONS[index] ?? DEFAULT_APP_LOGO_COLOR;
  const name = t(APP_ICON_LABELS[color]);
  const isCurrent = value === color;
  const description =
    Platform.OS === "android"
      ? t("mobile.settings.appIcon.descriptionAndroid")
      : t("mobile.settings.appIcon.description");

  if (ready && value === null) return <SettingsContent />;

  return (
    <SettingsContent>
      <View className="items-center gap-5 pt-2">
        <Counter progress={progress} />
        <GestureDetector gesture={Gesture.Race(pan, tap)}>
          <View
            collapsable={false}
            className="-mx-4 self-stretch"
            style={{ height: canvasHeight || 240 }}
            onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t("mobile.settings.appearance.appIcon")}
            accessibilityValue={{
              text: t("mobile.settings.appIcon.position", { name, current: index + 1, total: COUNT }),
            }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) => moveTo(index + (event.nativeEvent.actionName === "increment" ? 1 : -1))}
          >
            {width > 0 ? (
              <Canvas style={{ width, height: canvasHeight }} pointerEvents="none">
                {APP_ICONS.map((icon, at) => (
                  <CarouselIcon
                    key={icon}
                    index={at}
                    progress={progress}
                    color={icon}
                    eyes={eyes}
                    size={size}
                    centerX={width / 2}
                    centerY={canvasHeight / 2}
                    spacing={spacing}
                    direction={direction}
                    reduced={reduced}
                  />
                ))}
              </Canvas>
            ) : null}
          </View>
        </GestureDetector>
        <Names progress={progress} current={name} />
        <Typography.Paragraph className="px-4 text-center text-grouped-secondary">{description}</Typography.Paragraph>
        <ActionButton
          progress={progress}
          fromCurrent={fromCurrent}
          toCurrent={toCurrent}
          currentMix={currentMix}
          isCurrent={isCurrent}
          disabled={!ready || saving || isCurrent}
          useLabel={t("mobile.settings.appIcon.use")}
          currentLabel={t("mobile.settings.appIcon.current")}
          onPress={() => {
            setError(null);
            void haptics.impact("soft");
            void saveAppIcon(color).catch(() => {
              setError(t("mobile.settings.appearance.appIconFailed"));
              void haptics.notification("error");
            });
          }}
        />
        {error ? (
          <Typography.Paragraph type="body-xs" className="text-center text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
      </View>
    </SettingsContent>
  );
}

function CarouselIcon({
  index,
  progress,
  color,
  eyes,
  size,
  centerX,
  centerY,
  spacing,
  direction,
  reduced,
}: {
  index: number;
  progress: SharedValue<number>;
  color: AppLogoColor;
  eyes: SkImage | null;
  size: number;
  centerX: number;
  centerY: number;
  spacing: number;
  direction: number;
  reduced: boolean;
}) {
  const look = appIconLook(color);
  const transform = useDerivedValue<Transforms3d>(() => {
    const distance = index - progress.get();
    const offsetX = distance * spacing * direction;
    return [
      { translateX: centerX - size / 2 + offsetX },
      // On the screen the right side is always up, also in right-to-left languages.
      { translateY: centerY - size / 2 - offsetX * SLOPE },
      { rotate: reduced ? 0 : clamp(distance, -2, 2) * direction * 0.28 },
      { scale: 1 - Math.min(Math.abs(distance), 1.6) * 0.34 },
    ];
  });
  const blur = useDerivedValue(() => (reduced ? 0 : Math.min(Math.abs(index - progress.get()), 2) * 5));
  const opacity = useDerivedValue(() => 1 - clamp((Math.abs(index - progress.get()) - 1.5) / 0.6, 0, 1));
  const eyesWidth = size * EYES_WIDTH;
  const eyesHeight = eyesWidth * EYES_ASPECT;
  return (
    <Group
      transform={transform}
      origin={vec(size / 2, size / 2)}
      opacity={opacity}
      layer={
        <Paint>
          <Blur blur={blur} />
        </Paint>
      }
    >
      <RoundedRect x={0} y={0} width={size} height={size} r={size * 0.225} color={look.body}>
        {Platform.OS === "ios" ? (
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, size * 0.7)}
            colors={[shade(look.body, 1.04), shade(look.body, 0.86)]}
          />
        ) : null}
      </RoundedRect>
      {eyes ? (
        <Image
          image={eyes}
          x={(size - eyesWidth) / 2}
          y={size / 2 - eyesHeight / 2}
          width={eyesWidth}
          height={eyesHeight}
          fit="contain"
        >
          <BlendColor color={look.eyes} mode="srcIn" />
        </Image>
      ) : null}
    </Group>
  );
}

/** The position, as `06 / 10`. Each digit rolls to its new value. */
function Counter({ progress }: { progress: SharedValue<number> }) {
  const text = String(useCSSVariable("--openbot-text-primary"));
  const tens = useSharedValue(0);
  const ones = useSharedValue(0);
  useAnimatedReaction(
    () => clamp(Math.round(progress.get()), 0, LAST) + 1,
    (position, previous) => {
      const nextTens = Math.floor(position / 10);
      const nextOnes = position % 10;
      if (previous === null) {
        tens.set(nextTens);
        ones.set(nextOnes);
        return;
      }
      tens.set(withSpring(nextTens, DIGIT_SPRING));
      ones.set(withSpring(nextOnes, DIGIT_SPRING));
    },
  );
  const total = String(COUNT).padStart(2, "0");
  return (
    <View className="flex-row items-end" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <RollingDigit digit={tens} color={text} />
      <RollingDigit digit={ones} color={text} />
      <Typography
        allowFontScaling={false}
        className="mb-1 ml-1 font-medium text-grouped-secondary"
        style={{ fontSize: 13, fontVariant: ["tabular-nums"] }}
      >
        {`/ ${total}`}
      </Typography>
    </View>
  );
}

function RollingDigit({ digit, color }: { digit: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -digit.get() * DIGIT_HEIGHT }] }));
  return (
    <View style={{ height: DIGIT_HEIGHT, overflow: "hidden" }}>
      <Animated.View style={style}>
        {DIGITS.map((value) => (
          <Typography
            key={value}
            allowFontScaling={false}
            className="font-bold"
            style={{ color, fontSize: 28, lineHeight: DIGIT_HEIGHT, fontVariant: ["tabular-nums"] }}
          >
            {String(value)}
          </Typography>
        ))}
      </Animated.View>
    </View>
  );
}

/** The names, one over the other. Each fades in as its icon reaches the middle. */
function Names({ progress, current }: { progress: SharedValue<number>; current: string }) {
  const { t } = useText();
  return (
    <View
      className="items-center self-stretch"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Sizes the row for the current text size. */}
      <Typography.Heading type="h4" align="center" className="opacity-0">
        {current}
      </Typography.Heading>
      {APP_ICONS.map((icon, index) => (
        <NameLabel key={icon} index={index} progress={progress} label={t(APP_ICON_LABELS[icon])} />
      ))}
    </View>
  );
}

function NameLabel({ index, progress, label }: { index: number; progress: SharedValue<number>; label: string }) {
  const style = useAnimatedStyle(() => {
    const near = closeness(progress.get(), index);
    const shown = clamp(near * 2 - 1, 0, 1);
    return { opacity: shown, transform: [{ translateY: (1 - shown) * 6 }, { scale: 0.96 + shown * 0.04 }] };
  });
  return (
    <Animated.View className="absolute inset-x-0 top-0 items-center" style={style}>
      <Typography.Heading type="h4" align="center">
        {label}
      </Typography.Heading>
    </Animated.View>
  );
}

/** “Use this icon”, or the muted “Current icon” while the selected icon is in the middle. */
function ActionButton({
  progress,
  fromCurrent,
  toCurrent,
  currentMix,
  isCurrent,
  disabled,
  useLabel,
  currentLabel,
  onPress,
}: {
  progress: SharedValue<number>;
  fromCurrent: SharedValue<number>;
  toCurrent: SharedValue<number>;
  currentMix: SharedValue<number>;
  /** The icon in the middle is the selected icon. */
  isCurrent: boolean;
  disabled: boolean;
  useLabel: string;
  currentLabel: string;
  onPress: () => void;
}) {
  const action = String(useCSSVariable("--openbot-action"));
  const actionText = String(useCSSVariable("--openbot-action-foreground"));
  const muted = String(useCSSVariable("--openbot-bg-control-active"));
  const mutedText = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const current = useDerivedValue(() => {
    const at = progress.get();
    const mix = currentMix.get();
    return closeness(at, fromCurrent.get()) * (1 - mix) + closeness(at, toCurrent.get()) * mix;
  });
  const background = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(current.get(), [0, 1], [action, muted]),
  }));
  const useStyle = useAnimatedStyle(() => ({ opacity: 1 - current.get() }));
  const currentStyle = useAnimatedStyle(() => ({ opacity: current.get() }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isCurrent ? currentLabel : useLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="self-stretch"
    >
      {({ pressed }) => (
        <Animated.View
          className="min-h-12 items-center justify-center rounded-full px-5 py-3"
          style={[
            background,
            {
              transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
              transitionProperty: "transform",
              transitionDuration: 120,
              transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
            },
          ]}
        >
          <Animated.View style={useStyle}>
            <Typography.Paragraph className="font-semibold" style={{ color: actionText }}>
              {useLabel}
            </Typography.Paragraph>
          </Animated.View>
          <Animated.View className="absolute" style={currentStyle}>
            <Typography.Paragraph className="font-semibold" style={{ color: mutedText }}>
              {currentLabel}
            </Typography.Paragraph>
          </Animated.View>
        </Animated.View>
      )}
    </Pressable>
  );
}
