import { useCallback, useEffect, useId, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

const COLOR_EASING = Easing.bezier(0.23, 1, 0.32, 1);
const COLOR_DURATION_MS = 400;
const GLOW_MAX_WIDTH = 460;
const GLOW_OPACITY = 0.38;
const GLOW_FALLOFF = [
  [0, 1],
  [0.35, 0.6],
  [0.7, 0.16],
  [1, 0],
] as const;

export function AgentColorGlow({ color, centerY, height }: { color: string; centerY: number; height: number }) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth * 1.1, GLOW_MAX_WIDTH);
  const [layers, setLayers] = useState(() => [{ key: 0, color }]);
  const top = layers[layers.length - 1];
  if (top && top.color !== color) {
    setLayers([...layers.slice(-2), { key: top.key + 1, color }]);
  }
  const removeLayer = useCallback((key: number) => {
    setLayers((current) => current.filter((layer) => layer.key !== key));
  }, []);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        position: "absolute",
        top: centerY - height / 2,
        left: "50%",
        width,
        height,
        transform: [{ translateX: -width / 2 }],
      }}
    >
      {layers.map((layer) => (
        <GlowLayer
          key={layer.key}
          layerKey={layer.key}
          color={layer.color}
          shown={layer === top}
          width={width}
          height={height}
          onHidden={removeLayer}
        />
      ))}
    </View>
  );
}

function GlowLayer({
  layerKey,
  color,
  shown,
  width,
  height,
  onHidden,
}: {
  layerKey: number;
  color: string;
  shown: boolean;
  width: number;
  height: number;
  onHidden: (key: number) => void;
}) {
  const id = `${useId().replaceAll(":", "")}-glow`;
  const opacity = useSharedValue(layerKey === 0 ? 1 : 0);
  useEffect(() => {
    opacity.set(
      withTiming(
        shown ? 1 : 0,
        { duration: COLOR_DURATION_MS, easing: COLOR_EASING, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished && !shown) scheduleOnRN(onHidden, layerKey);
        },
      ),
    );
  }, [layerKey, onHidden, opacity, shown]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg accessible={false} width={width} height={height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            {GLOW_FALLOFF.map(([offset, strength]) => (
              <Stop key={offset} offset={offset} stopColor={color} stopOpacity={GLOW_OPACITY * strength} />
            ))}
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
