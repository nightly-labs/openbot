import { HeaderHeightContext } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { type PropsWithChildren, type ReactNode, type RefObject, useContext, useRef, useState } from "react";
import { Pressable, View, type ViewInstance } from "react-native";
import Animated, {
  cubicBezier,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { AndroidBlurTarget, AndroidHeaderBlur } from "@/shared/components/android-header-blur";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { useReducedMotion } from "@/shared/lib/motion";
import { useBarTop } from "@/shared/lib/native-bar";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { typeScale } from "@/shared/lib/type-scale";
import { useDuoWindow, useVerticalBarShown } from "@/shared/lib/vertical-bar";

const TITLE_EASE = cubicBezier(0.23, 1, 0.32, 1);
const TITLE_BOTTOM_PADDING = isAndroid ? 16 : 10;
const TITLE_FADE = 24;
const IOS_BAR_HEIGHT = 44;
const BAR_TITLE_INSET = 78;
const VERTICAL_BAR_TITLE_INSET = 20;
const DUO_BAR_ITEM_CENTER_FROM_BOTTOM = 35;
const ANDROID_BAR_TITLE_INSET = 72;
const IOS_BAR_BUTTON_WIDTH = 46;
const ANDROID_BAR_BUTTON_WIDTH = 48;
const ANDROID_FADE = 32;

export interface LargeTitleScroll {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  scrolled: SharedValue<number>;
  titleHeight: SharedValue<number>;
  headerHeight: number;
  barTop: number;
  nativeBar: boolean;
  ownsInset: boolean;
}

export function useLargeTitleScroll(customBar?: { headerHeight: number }): LargeTitleScroll {
  const nativeHeaderHeight = useContext(HeaderHeightContext) ?? 0;
  const verticalBar = useVerticalBarShown();
  const barTop = useBarTop();
  const ownsInset = !isIOS || customBar !== undefined || verticalBar;
  const headerHeight = customBar?.headerHeight ?? (verticalBar ? barTop + IOS_BAR_HEIGHT : nativeHeaderHeight);
  const scrolled = useSharedValue(0);
  const titleHeight = useSharedValue(0);
  const rest = ownsInset ? 0 : -nativeHeaderHeight;
  const onScroll = useAnimatedScrollHandler((event) => {
    scrolled.set(event.contentOffset.y - rest);
  });
  return { onScroll, scrolled, titleHeight, headerHeight, barTop, ownsInset, nativeBar: customBar === undefined };
}

export function LargeTitle({
  scroll,
  title,
  caption,
  above,
  accessibilityLabel,
  onPress,
}: {
  scroll: LargeTitleScroll;
  title: string;
  caption?: string;
  above?: ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const { scrolled, titleHeight } = scroll;
  const titleStyle = useAnimatedStyle(() => {
    const height = titleHeight.get();
    const opacity =
      height > 0
        ? interpolate(
            scrolled.get(),
            [height - TITLE_BOTTOM_PADDING - TITLE_FADE, height - TITLE_BOTTOM_PADDING],
            [1, 0],
            Extrapolation.CLAMP,
          )
        : 1;
    if (!isIOS || reduced) return { opacity, transform: [{ scale: 1 }] };
    return {
      opacity,
      transform: [{ scale: interpolate(scrolled.get(), [-160, 0], [1.08, 1], Extrapolation.CLAMP) }],
    };
  });
  const heading = (
    <Animated.View style={[{ transformOrigin: "left center" }, titleStyle]}>
      <Typography.Heading
        className="font-bold"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        style={isAndroid ? typeScale.largeTitleAndroid : typeScale.largeTitle}
      >
        {title}
      </Typography.Heading>
    </Animated.View>
  );
  return (
    <View
      className={isAndroid ? "px-5 pt-2" : "px-5"}
      style={{ paddingBottom: TITLE_BOTTOM_PADDING }}
      onLayout={(event) => titleHeight.set(event.nativeEvent.layout.height)}
    >
      {above}
      {caption ? (
        <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
          {caption}
        </Typography.Paragraph>
      ) : null}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          hitSlop={8}
          className="self-start"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={onPress}
        >
          {heading}
        </Pressable>
      ) : (
        <View accessible accessibilityRole="header">
          {heading}
        </View>
      )}
    </View>
  );
}

export function LargeTitleBar({
  scroll,
  title,
  hidden = false,
  insetLeft = isAndroid ? ANDROID_BAR_TITLE_INSET : BAR_TITLE_INSET,
  insetRight = isAndroid ? ANDROID_BAR_TITLE_INSET : BAR_TITLE_INSET,
  surface = "canvas",
  blurTarget,
  androidSurfaceOnScroll = false,
  children,
}: PropsWithChildren<{
  scroll: LargeTitleScroll;
  title: string;
  hidden?: boolean;
  insetLeft?: number;
  insetRight?: number;
  surface?: "canvas" | "sheet";
  blurTarget?: RefObject<ViewInstance | null>;
  androidSurfaceOnScroll?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const nativeHeaderHeight = useContext(HeaderHeightContext) ?? 0;
  const verticalBar = useVerticalBarShown();
  const duoWindow = useDuoWindow();
  const duoNativeBar = duoWindow && !scroll.ownsInset;
  const titleTop = duoNativeBar
    ? Math.max(0, nativeHeaderHeight - DUO_BAR_ITEM_CENTER_FROM_BOTTOM - IOS_BAR_HEIGHT / 2)
    : scroll.barTop;
  const titleInsetLeft = verticalBar && scroll.nativeBar ? VERTICAL_BAR_TITLE_INSET : insetLeft;
  const titleInsetRight = verticalBar && scroll.nativeBar ? VERTICAL_BAR_TITLE_INSET : insetRight;
  const { scrolled, titleHeight } = scroll;
  const androidFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrolled.get(), [0, ANDROID_FADE], [0, 1], Extrapolation.CLAMP),
  }));
  const surfaceProgress = useDerivedValue(() =>
    androidSurfaceOnScroll ? interpolate(scrolled.get(), [0, TITLE_FADE], [0, 1], Extrapolation.CLAMP) : 1,
  );
  const solidBarStyle = useAnimatedStyle(() => ({ opacity: surfaceProgress.get() }));
  useAnimatedReaction(
    () => {
      const height = titleHeight.get();
      return height > 0 && scrolled.get() > height - TITLE_BOTTOM_PADDING;
    },
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setCollapsed, next);
    },
  );
  return (
    <>
      {isAndroid && ANDROID_BLUR && blurTarget ? (
        <AndroidHeaderBlur
          target={blurTarget}
          height={scroll.headerHeight}
          surface={surface}
          shape="screen"
          progress={surfaceProgress}
        />
      ) : isAndroid ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, height: scroll.headerHeight + ANDROID_FADE },
            solidBarStyle,
          ]}
        >
          <View
            pointerEvents="none"
            className={surface === "sheet" ? "bg-sheet" : "bg-background"}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: scroll.headerHeight }}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", top: scroll.headerHeight, left: 0, right: 0, height: ANDROID_FADE },
              androidFadeStyle,
            ]}
          >
            <SheetScrollEdgeEffect surface={surface} style={{ flex: 1 }} />
          </Animated.View>
        </Animated.View>
      ) : (
        <SheetScrollEdgeEffect
          surface={surface}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: scroll.headerHeight + 48,
          }}
        />
      )}
      {children}
      {hidden ? null : (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: "absolute",
              top: titleTop,
              height: isIOS ? IOS_BAR_HEIGHT : Math.max(0, scroll.headerHeight - scroll.barTop),
              left: insets.left + titleInsetLeft,
              right: insets.right + titleInsetRight,
              justifyContent: "center",
              opacity: collapsed ? 1 : 0,
              transform: [{ translateY: collapsed || reduced ? 0 : 4 }],
              transitionProperty: ["opacity", "transform"],
              transitionDuration: reduced ? 150 : 200,
              transitionTimingFunction: TITLE_EASE,
            },
          ]}
        >
          <Typography.Paragraph
            className={isAndroid ? "font-normal" : "font-semibold"}
            numberOfLines={1}
            style={isAndroid ? typeScale.barTitleAndroid : typeScale.barTitle}
          >
            {title}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </>
  );
}

export interface LargeTitleScrollProps {
  className: string;
  style: { marginLeft: number; marginRight: number };
  alwaysBounceVertical: boolean;
  contentInsetAdjustmentBehavior: "never" | "always";
  contentContainerClassName: string;
  contentContainerStyle: { paddingTop: number } | undefined;
  keyboardShouldPersistTaps: "handled";
  scrollEventThrottle: number;
  showsVerticalScrollIndicator: boolean;
  onScroll: LargeTitleScroll["onScroll"];
}

export function LargeTitleScrollView({
  title,
  caption,
  contentContainerClassName,
  barButtonsRight = 1,
  renderScroll,
  children,
}: PropsWithChildren<{
  title: string;
  caption?: string;
  contentContainerClassName?: string;
  barButtonsRight?: number;
  renderScroll?: (scrollProps: LargeTitleScrollProps, largeTitle: ReactNode) => ReactNode;
}>) {
  const scroll = useLargeTitleScroll();
  const insets = useSafeAreaInsets();
  const blurTarget = useRef<ViewInstance>(null);
  const scrollProps: LargeTitleScrollProps = {
    className: "flex-1",
    style: { marginLeft: insets.left, marginRight: insets.right },
    alwaysBounceVertical: false,
    contentInsetAdjustmentBehavior: scroll.ownsInset ? "never" : "always",
    contentContainerClassName: "pb-safe-offset-5",
    contentContainerStyle: scroll.ownsInset ? { paddingTop: scroll.headerHeight } : undefined,
    keyboardShouldPersistTaps: "handled",
    scrollEventThrottle: 16,
    showsVerticalScrollIndicator: false,
    onScroll: scroll.onScroll,
  };
  const largeTitle = <LargeTitle scroll={scroll} title={title} caption={caption} />;
  return (
    <View className="flex-1 bg-sheet">
      <AndroidBlurTarget target={blurTarget} surface="sheet">
        {renderScroll ? (
          renderScroll(scrollProps, largeTitle)
        ) : (
          <Animated.ScrollView {...scrollProps}>
            {largeTitle}
            <View className={contentContainerClassName}>{children}</View>
          </Animated.ScrollView>
        )}
      </AndroidBlurTarget>
      <LargeTitleBar
        scroll={scroll}
        title={title}
        surface="sheet"
        blurTarget={blurTarget}
        insetRight={
          (isAndroid ? ANDROID_BAR_TITLE_INSET : BAR_TITLE_INSET) +
          Math.max(0, barButtonsRight - 1) * (isAndroid ? ANDROID_BAR_BUTTON_WIDTH : IOS_BAR_BUTTON_WIDTH)
        }
      />
    </View>
  );
}
