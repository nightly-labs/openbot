import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { memo, useId } from "react";
import { Dimensions, StyleSheet, useColorScheme, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { isIOS } from "@/shared/lib/platform";

// The same layers as the scroll edge of the other screens: overlapping weak blurs approximate a
// radius ramp. Here each layer stays at full strength behind the header text and fades out below it.
/**
 * Where the fade of each layer ends, for each layer count. A least-squares fit of the sum of the mask
 * opacities to that of the 6 layers that ended at 1, 0.85, 0.7, 0.55, 0.4 and 0.25. The largest
 * difference is 7% of the full value with 2 layers, and 2% with 3 layers.
 */
const BLUR_LAYER_ENDS_BY_COUNT: Record<2 | 3, readonly number[]> = { 2: [1, 0.36], 3: [1, 0.595, 0.32] };
/**
 * The number of blur layers. Each layer is a native blur that samples and blurs the rows behind it again
 * on each scroll frame, so the GPU cost increases with each layer. More layers make smaller steps in the
 * fade. The fade is only 32 points, so 2 layers are sufficient (the first version had 6). For a longer
 * fade, set 3.
 */
const BLUR_LAYER_COUNT: keyof typeof BLUR_LAYER_ENDS_BY_COUNT = 2;
const BLUR_LAYER_ENDS = BLUR_LAYER_ENDS_BY_COUNT[BLUR_LAYER_COUNT];
/**
 * The first version had 6 layers at intensity 12. Stacked Gaussian blurs add their radii as squares, so
 * each layer takes `12 * sqrt(6 / count)`: 21 for 2 layers, 17 for 3. The blur radius behind the header
 * stays approximately the same. The tint of the material is lighter, because the sum of the intensities
 * is lower.
 */
const BLUR_LAYER_INTENSITY = Math.round(12 * Math.sqrt(6 / BLUR_LAYER_COUNT));
const DARK_TINT_OPACITY = 0.7;
const MASK_WIDTH = Math.ceil(Math.max(Dimensions.get("screen").width, Dimensions.get("screen").height));
const FADE_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16;
  return { progress, opacity: 1 - progress * progress * (3 - 2 * progress) };
});

/**
 * The blur under the drawer header. The rows scroll under it. It is at full strength down to
 * `solidHeight` and fades out over `fadeHeight` below. Android has no cheap blur, so there the
 * drawer color covers the header and fades out.
 */
export const DrawerHeaderBlur = memo(function DrawerHeaderBlur({
  left,
  solidHeight,
  fadeHeight,
}: {
  /** The offset of the left edge, so the blur reaches the screen edge across the drawer padding. */
  left: number;
  solidHeight: number;
  fadeHeight: number;
}) {
  const id = useId().replaceAll(":", "");
  const colorScheme = useColorScheme();
  const height = solidHeight + fadeHeight;
  if (height <= 0) return null;
  const hold = solidHeight / height;

  function fadeMask(maskId: string, end: number) {
    return (
      // A new height mounts a new mask, so the masked view takes it as its mask again.
      <Svg key={`${MASK_WIDTH}x${height}x${hold}`} width={MASK_WIDTH} height={height}>
        <Defs>
          <LinearGradient id={maskId} x1="0%" x2="0%" y1="0%" y2="100%">
            {FADE_STOPS.map(({ progress, opacity }) => (
              <Stop
                key={progress}
                offset={hold + progress * end * (1 - hold)}
                stopColor="#000000"
                stopOpacity={opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={MASK_WIDTH} height={height} fill={`url(#${maskId})`} />
      </Svg>
    );
  }

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, left, position: "absolute", right: 0, top: 0, zIndex: 10 }}
    >
      {isIOS
        ? BLUR_LAYER_ENDS.map((end, index) => (
            <MaskedView
              key={end}
              style={StyleSheet.absoluteFill}
              maskElement={fadeMask(`drawer-blur-${id}-${index}`, end)}
            >
              <BlurView
                tint="systemUltraThinMaterial"
                intensity={BLUR_LAYER_INTENSITY}
                style={StyleSheet.absoluteFill}
              />
            </MaskedView>
          ))
        : null}
      {!isIOS || colorScheme === "dark" ? (
        <MaskedView style={StyleSheet.absoluteFill} maskElement={fadeMask(`drawer-tint-${id}`, 1)}>
          <View className="flex-1 bg-sidebar" style={{ opacity: isIOS ? DARK_TINT_OPACITY : 1 }} />
        </MaskedView>
      ) : null}
    </View>
  );
});
