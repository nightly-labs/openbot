import MaskedView from "@react-native-masked-view/masked-view";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { type ColorValue, StyleSheet, View } from "react-native";
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
import { isAndroid } from "@/shared/lib/platform";

export function ThinkingTextGradient({
  text,
  enabled,
  foreground,
  muted,
  type = "body-sm",
  numberOfLines,
}: {
  text: string;
  enabled: boolean;
  foreground: ColorValue;
  muted: ColorValue;
  type?: "body" | "body-sm";
  numberOfLines?: number;
}) {
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
  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -2 * width * (1 - interpolate(progress.get(), [0, 0.18, 0.82, 1], [0, 0, 1, 1])) }],
  }));
  const copy = (color: ColorValue) => (
    <Typography.Paragraph type={type} numberOfLines={numberOfLines} style={{ color }}>
      {text}
    </Typography.Paragraph>
  );
  const band = (color: ColorValue) => (
    <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: width * 3 }, bandStyle]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="thinking-text-band" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0.3" stopColor={color} stopOpacity={0} />
            <Stop offset="0.45" stopColor={color} stopOpacity={1} />
            <Stop offset="0.55" stopColor={color} stopOpacity={1} />
            <Stop offset="0.7" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#thinking-text-band)" />
      </Svg>
    </Animated.View>
  );
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {copy(foreground)}
      {enabled && width > 0 ? (
        <MaskedView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          renderToHardwareTextureAndroid
          maskElement={isAndroid ? copy("#000") : band("#000")}
        >
          {isAndroid ? band(muted) : copy(muted)}
        </MaskedView>
      ) : null}
    </View>
  );
}
