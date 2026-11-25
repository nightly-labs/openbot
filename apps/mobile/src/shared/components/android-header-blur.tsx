import MaskedView from "@react-native-masked-view/masked-view";
import { BlurTargetView, BlurView } from "expo-blur";
import type { NativeStackHeaderProps } from "expo-router/native-stack";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { ReactNode, RefObject } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { type SharedValue, useAnimatedProps, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { AndroidStackBackButton } from "@/shared/components/android-header-button";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { typeScale } from "@/shared/lib/type-scale";

const BLUR_INTENSITY = 40;
const SURFACE_OPACITY = 0.8;
const BLUR_SHAPES = {
  sheet: { belowBar: 28, full: 0.45 },
  screen: { belowBar: 32, full: 0.68 },
} as const;

function maskStops(full: number) {
  const fade = Array.from({ length: 13 }, (_, index) => {
    const progress = index / 12;
    return { offset: full + progress * (1 - full), opacity: 1 - progress * progress * (3 - 2 * progress) };
  });
  return [{ offset: 0, opacity: 1 }, ...fade];
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const BAR_HEIGHT = 64;
const TITLE_INSET = 72;

export function AndroidBlurTarget({
  target,
  surface,
  enabled = true,
  children,
}: {
  target: RefObject<ViewInstance | null>;
  surface: "canvas" | "sheet";
  enabled?: boolean;
  children: ReactNode;
}) {
  if (!ANDROID_BLUR || !enabled) return children;
  return (
    <BlurTargetView ref={target} style={{ flex: 1 }}>
      <View className={surface === "sheet" ? "flex-1 bg-sheet" : "flex-1 bg-background"}>{children}</View>
    </BlurTargetView>
  );
}

export function AndroidHeaderBlur({
  target,
  height,
  surface = "sheet",
  shape,
  progress,
}: {
  target: RefObject<ViewInstance | null>;
  height?: number;
  surface?: "canvas" | "sheet";
  shape: keyof typeof BLUR_SHAPES;
  progress?: SharedValue<number>;
}) {
  const { theme } = useUniwind();
  const fullBar = useSharedValue(1);
  const shown = progress ?? fullBar;
  const maskProps = useAnimatedProps(() => ({ opacity: shown.get() }));
  const { belowBar, full } = BLUR_SHAPES[shape];
  return (
    <MaskedView
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: "absolute", top: 0, left: 0, right: 0 },
        height === undefined ? { bottom: -belowBar } : { height: height + belowBar },
      ]}
      maskElement={
        <Svg height="100%" width="100%">
          <Defs>
            <LinearGradient id="android-header-mask" x1="0" x2="0" y1="0" y2="1">
              {maskStops(full).map(({ offset, opacity }) => (
                <Stop key={offset} offset={offset} stopColor="#000000" stopOpacity={opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <AnimatedRect fill="url(#android-header-mask)" height="100%" width="100%" animatedProps={maskProps} />
        </Svg>
      }
    >
      <BlurView
        blurTarget={target}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={BLUR_INTENSITY}
        tint={theme === "dark" ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
      <View
        className={surface === "sheet" ? "bg-sheet" : "bg-background"}
        style={[StyleSheet.absoluteFill, { opacity: SURFACE_OPACITY }]}
      />
    </MaskedView>
  );
}

export function AndroidBlurHeader({
  options,
  back,
  navigation,
  blurTarget,
  underStatusBar,
}: Pick<NativeStackHeaderProps, "options" | "back" | "navigation"> & {
  blurTarget: RefObject<ViewInstance | null>;
  underStatusBar: boolean;
}) {
  const insets = useSafeAreaInsets();
  const foreground = String(useThemeColor("foreground"));
  const itemProps = { tintColor: foreground, canGoBack: back !== undefined };
  const left =
    options.headerLeft?.(itemProps) ??
    (back && options.headerBackVisible !== false ? (
      <AndroidStackBackButton glass={underStatusBar} onPress={() => navigation.goBack()} />
    ) : undefined);
  const right = options.headerRight?.(itemProps);
  const title = typeof options.headerTitle === "string" ? options.headerTitle : (options.title ?? "");
  return (
    <View style={{ paddingTop: underStatusBar ? insets.top : 0 }}>
      <AndroidHeaderBlur target={blurTarget} shape={underStatusBar ? "screen" : "sheet"} />
      <View
        className="flex-row items-center"
        style={{ height: BAR_HEIGHT, paddingLeft: insets.left + 4, paddingRight: insets.right + 4 }}
      >
        <View className="flex-row items-center" style={{ width: left ? TITLE_INSET - 4 : 12 }}>
          {left}
        </View>
        <Typography.Paragraph
          accessibilityRole="header"
          className="flex-1 font-normal"
          numberOfLines={1}
          style={typeScale.barTitleAndroid}
        >
          {title}
        </Typography.Paragraph>
        {right ? <View className="flex-row items-center">{right}</View> : null}
      </View>
    </View>
  );
}
