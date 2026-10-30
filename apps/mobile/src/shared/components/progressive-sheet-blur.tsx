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

// Overlapping weak blurs approximate a radius ramp. Each layer is transparent
// before the physical view edge, so clipping cannot leave a visible seam.
const OUTER_BLUR_LAYER_END = 0.94;
const BLUR_LAYER_ENDS = [OUTER_BLUR_LAYER_END, 0.8, 0.66, 0.52, 0.38, 0.24];
// The dark system material is lighter than the dark surface, so a masked
// surface color pulls the blurred edge back to the surface's tone.
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
  /** The color of the dark tint: a sheet, or the canvas of a full screen. */
  surface?: "canvas" | "sheet";
}) {
  const id = useId().replaceAll(":", "");
  const colorScheme = useColorScheme();
  // A mask keeps the size that it first drew at, so a percent size goes stale when the view resizes:
  // a rotation, or a column that the user resizes. The fade runs down the view only, so the masks are
  // as wide as the longest side of the screen, which no width outgrows, and take only the measured
  // height. A column that the user drags wider or narrower then does not render the blur again.
  const [height, setHeight] = useState<number | null>(null);
  const measure = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    setHeight((current) => (current === measured ? current : measured));
  };
  const size = height === null ? null : { width: MASK_WIDTH, height };

  function fadeMask(maskId: string, end: number, { width, height }: { width: number; height: number }) {
    return (
      // A new size mounts a new mask, so the masked view takes it as its mask again.
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
        : BLUR_LAYER_ENDS.map((end, index) => {
            const maskId = `sheet-blur-${id}-${index}`;
            return (
              <MaskedView key={end} style={StyleSheet.absoluteFill} maskElement={fadeMask(maskId, end, size)}>
                <BlurView tint="systemUltraThinMaterial" intensity={12} style={StyleSheet.absoluteFill} />
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
