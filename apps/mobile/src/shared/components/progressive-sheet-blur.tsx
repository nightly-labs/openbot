import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { memo, useId } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// Overlapping weak blurs approximate a radius ramp. Each layer is transparent
// before the physical view edge, so clipping cannot leave a visible seam.
const BLUR_LAYERS = [
  { start: 0, end: 0.94 },
  { start: 0, end: 0.8 },
  { start: 0, end: 0.66 },
  { start: 0, end: 0.52 },
  { start: 0, end: 0.38 },
  { start: 0, end: 0.24 },
];
const FADE_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16;
  return { progress, opacity: 1 - progress * progress * (3 - 2 * progress) };
});

export const ProgressiveSheetBlur = memo(function ProgressiveSheetBlur({
  style,
  edge = "top",
}: {
  style: StyleProp<ViewStyle>;
  edge?: "top" | "bottom";
}) {
  const id = useId().replaceAll(":", "");

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {BLUR_LAYERS.map((layer, index) => {
        const maskId = `sheet-blur-${id}-${index}`;
        return (
          <MaskedView
            key={layer.end}
            style={StyleSheet.absoluteFill}
            maskElement={
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient
                    id={maskId}
                    x1="0%"
                    x2="0%"
                    y1={edge === "top" ? "0%" : "100%"}
                    y2={edge === "top" ? "100%" : "0%"}
                  >
                    {FADE_STOPS.map(({ progress, opacity }) => (
                      <Stop
                        key={progress}
                        offset={layer.start + progress * (layer.end - layer.start)}
                        stopColor="#000000"
                        stopOpacity={opacity}
                      />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${maskId})`} />
              </Svg>
            }
          >
            <BlurView tint="systemUltraThinMaterial" intensity={12} style={StyleSheet.absoluteFill} />
          </MaskedView>
        );
      })}
    </View>
  );
});
