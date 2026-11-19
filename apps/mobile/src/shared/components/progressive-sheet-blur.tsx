import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { memo, useId, useState } from "react";
import {
  Dimensions,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

const OUTER_BLUR_LAYER_END = 0.94;
export type BlurLayerCount = 2 | 3;
const BLUR_LAYER_COUNT: BlurLayerCount = 3;
const SHORT_BAND_HEIGHT = 40;
const SHORT_BAND_BLUR_LAYER_COUNT: BlurLayerCount = 2;
export const layerIntensity = (count: BlurLayerCount) => Math.round(12 * Math.sqrt(6 / count));
export const BLUR_LAYER_END_RATIOS: Record<BlurLayerCount, readonly number[]> = {
  2: [1, 0.36],
  3: [1, 0.595, 0.325],
};
const DARK_SHEET_TINT_OPACITY = 0.7;
const MASK_WIDTH = Math.ceil(Math.max(Dimensions.get("screen").width, Dimensions.get("screen").height));
const FADE_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16;
  return { progress, opacity: 1 - progress * progress * (3 - 2 * progress) };
});

export const ProgressiveSheetBlur = memo(function ProgressiveSheetBlur({
  style,
  edge = "top",
  surface = "sheet",
}: {
  style: StyleProp<ViewStyle>;
  edge?: "top" | "bottom";
  surface?: "canvas" | "sheet";
}) {
  const id = useId().replaceAll(":", "");
  const colorScheme = useColorScheme();
  const [height, setHeight] = useState<number | null>(null);
  const measure = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    setHeight((current) => (current === measured ? current : measured));
  };
  const size = height === null ? null : { width: MASK_WIDTH, height };
  const layerCount =
    height !== null && height * OUTER_BLUR_LAYER_END < SHORT_BAND_HEIGHT
      ? SHORT_BAND_BLUR_LAYER_COUNT
      : BLUR_LAYER_COUNT;

  function fadeMask(maskId: string, end: number, { width, height }: { width: number; height: number }) {
    return (
      <Svg key={`${width}x${height}`} width={width} height={height}>
        <Defs>
          <LinearGradient
            id={maskId}
            x1="0%"
            x2="0%"
            y1={edge === "top" ? "0%" : "100%"}
            y2={edge === "top" ? "100%" : "0%"}
          >
            {FADE_STOPS.map(({ progress, opacity }) => (
              <Stop key={progress} offset={progress * end} stopColor="#000000" stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${maskId})`} />
      </Svg>
    );
  }

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
      onLayout={measure}
    >
      {size === null
        ? null
        : BLUR_LAYER_END_RATIOS[layerCount].map((ratio, index) => {
            const maskId = `sheet-blur-${id}-${index}`;
            const end = ratio * OUTER_BLUR_LAYER_END;
            return (
              <MaskedView key={end} style={StyleSheet.absoluteFill} maskElement={fadeMask(maskId, end, size)}>
                <BlurView
                  tint="systemUltraThinMaterial"
                  intensity={layerIntensity(layerCount)}
                  style={StyleSheet.absoluteFill}
                />
              </MaskedView>
            );
          })}
      {colorScheme === "dark" && size !== null ? (
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={fadeMask(`sheet-tint-${id}`, OUTER_BLUR_LAYER_END, size)}
        >
          <View
            className={surface === "sheet" ? "flex-1 bg-sheet" : "flex-1 bg-background"}
            style={{ opacity: DARK_SHEET_TINT_OPACITY }}
          />
        </MaskedView>
      ) : null}
    </View>
  );
});
