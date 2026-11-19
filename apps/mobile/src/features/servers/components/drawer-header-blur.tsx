import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { memo, useId } from "react";
import { Dimensions, StyleSheet, useColorScheme, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BLUR_LAYER_END_RATIOS, type BlurLayerCount, layerIntensity } from "@/shared/components/progressive-sheet-blur";
import { isIOS } from "@/shared/lib/platform";

const BLUR_LAYER_COUNT: BlurLayerCount = 2;
const BLUR_LAYER_ENDS = BLUR_LAYER_END_RATIOS[BLUR_LAYER_COUNT];
const BLUR_LAYER_INTENSITY = layerIntensity(BLUR_LAYER_COUNT);
const DARK_TINT_OPACITY = 0.7;
const MASK_WIDTH = Math.ceil(Math.max(Dimensions.get("screen").width, Dimensions.get("screen").height));
const FADE_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16;
  return { progress, opacity: 1 - progress * progress * (3 - 2 * progress) };
});

export const DrawerHeaderBlur = memo(function DrawerHeaderBlur({
  left,
  solidHeight,
  fadeHeight,
}: {
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
