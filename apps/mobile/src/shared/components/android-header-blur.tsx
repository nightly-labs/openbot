import MaskedView from "@react-native-masked-view/masked-view";
import { BlurTargetView, BlurView } from "expo-blur";
import type { NativeStackHeaderProps } from "expo-router/native-stack";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { ReactNode, RefObject } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { AndroidStackBackButton } from "@/shared/components/android-header-button";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { typeScale } from "@/shared/lib/type-scale";

/** The blur strength. With the default reduction factor of 4, the native radius is 40 px. */
const BLUR_INTENSITY = 40;
/** The surface color over the blur, so the title reads over any content. */
const SURFACE_OPACITY = 0.8;
/**
 * How far the blur reaches below the bar, and the part of it that is at full strength before the eased
 * fade. A sheet bar is short and has no status bar. A full screen bar is taller, and its title sits
 * lower, so its blur reaches further and stays full longer.
 */
const BLUR_SHAPES = {
  sheet: { belowBar: 28, full: 0.45 },
  screen: { belowBar: 32, full: 0.68 },
} as const;

/** The mask is full from the top to `full`, then eases out to nothing at the bottom. */
function maskStops(full: number) {
  const fade = Array.from({ length: 13 }, (_, index) => {
    const progress = index / 12;
    return { offset: full + progress * (1 - full), opacity: 1 - progress * progress * (3 - 2 * progress) };
  });
  return [{ offset: 0, opacity: 1 }, ...fade];
}

/** The Material 3 small top app bar. */
const BAR_HEIGHT = 64;
/** The title starts on the 72 dp line after a navigation button, and 16 dp from the edge without one. */
const TITLE_INSET = 72;

/**
 * Android blurs only the content of a `BlurTargetView`. On Android 12 and later, with `enabled`, the
 * children go into one, on the surface color: a clear part of the target blurs as the window background.
 * Elsewhere they render as they are.
 */
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

/**
 * The backdrop of an Android bar over scrolling content, the usual Expo progressive blur: a `BlurView`
 * of the target with the surface color over it, in a `MaskedView` whose gradient keeps it full at the
 * top and fades it out a little below the bar. `height` is the bar's; without it the bar is the parent.
 */
export function AndroidHeaderBlur({
  target,
  height,
  surface = "sheet",
  shape,
}: {
  target: RefObject<ViewInstance | null>;
  height?: number;
  surface?: "canvas" | "sheet";
  shape: keyof typeof BLUR_SHAPES;
}) {
  const { theme } = useUniwind();
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
          <Rect fill="url(#android-header-mask)" height="100%" width="100%" />
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

/**
 * The header that a page draws on Android in place of the native one, over the blur of its content:
 * the Material 3 small top app bar, with the page's `headerLeft`, title and `headerRight`. The stack
 * measures it, so the content clears exactly its height. A sheet header does not reach the status bar.
 */
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
  // A stack without `androidBackOptions` (such as `SheetPageStack`) relies on the native back arrow, so
  // an inner page gets the same round back button here. Full screens put it in the glass circle.
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
