import MaskedView from "@react-native-masked-view/masked-view";
import { Typography } from "heroui-native";
import { type PropsWithChildren, useEffect, useState } from "react";
import { type ColorValue, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

export function ThinkingTextGradient({
  children,
  text,
  enabled,
  foreground,
  muted,
}: PropsWithChildren<{
  text: string;
  enabled: boolean;
  foreground: ColorValue;
  muted: ColorValue;
}>) {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    if (enabled)
      progress.set(
        withRepeat(
          withTiming(1, {
            duration: 2250,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          false,
        ),
      );
    return () => cancelAnimation(progress);
  }, [enabled, progress]);
  const gradientStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -2 * width * (1 - interpolate(progress.get(), [0, 0.18, 0.82, 1], [0, 0, 1, 1])) }],
  }));
  return (
    <MaskedView
      style={{ flex: 1 }}
      androidRenderingMode="software"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      maskElement={<View>{children}</View>}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Typography.Paragraph type="body-sm" style={{ opacity: 0 }}>
        {text}
      </Typography.Paragraph>
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: width * 3 }, gradientStyle]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="thinking-text-shine" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={foreground} />
              <Stop offset="0.3" stopColor={foreground} />
              <Stop offset="0.45" stopColor={muted} />
              <Stop offset="0.55" stopColor={muted} />
              <Stop offset="0.7" stopColor={foreground} />
              <Stop offset="1" stopColor={foreground} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#thinking-text-shine)" />
        </Svg>
      </Animated.View>
    </MaskedView>
  );
}
