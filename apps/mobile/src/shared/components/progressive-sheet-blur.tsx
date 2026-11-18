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
export type BlurLayerCount = 2 | 3;
/**
 * The number of blur layers. Each layer is a native blur that samples and blurs the content behind it
 * again on each scroll frame, so the GPU cost increases with each layer. More layers make smaller steps
 * in the ramp. The first version had 6 layers. 3 layers keep the steps smooth because their mask ends
 * (`BLUR_LAYER_END_RATIOS`) are fitted to the 6-layer ramp.
 */
const BLUR_LAYER_COUNT: BlurLayerCount = 3;
/** In a fade shorter than this many points, the steps are too small to see, so 2 layers are sufficient. */
const SHORT_BAND_HEIGHT = 40;
const SHORT_BAND_BLUR_LAYER_COUNT: BlurLayerCount = 2;
/**
 * The first version had 6 layers at intensity 12. Stacked Gaussian blurs add their radii as squares, so
 * each of `count` layers takes `12 * sqrt(6 / count)`: 17 for 3 layers, 21 for 2. The blur radius at the
 * edge stays approximately the same. The tint of the material is lighter, because the sum of the
 * intensities is lower (51 or 42 in place of 72).
 */
export const layerIntensity = (count: BlurLayerCount) => Math.round(12 * Math.sqrt(6 / count));
/**
 * Where the fade of each layer ends, as a fraction of the end of the outer layer. A least-squares fit of
 * the sum of the mask opacities to that of the 6 layers that ended at 0.94, 0.8, 0.66, 0.52, 0.38 and
 * 0.24. The largest difference is 2% of the full value with 3 layers, and 7% with 2 layers. The drawer
 * header uses the same values: its 6 layers had the same ramp.
 */
export const BLUR_LAYER_END_RATIOS: Record<BlurLayerCount, readonly number[]> = {
  2: [1, 0.36],
  3: [1, 0.595, 0.325],
};
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
  const layerCount =
    height !== null && height * OUTER_BLUR_LAYER_END < SHORT_BAND_HEIGHT
      ? SHORT_BAND_BLUR_LAYER_COUNT
      : BLUR_LAYER_COUNT;

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
