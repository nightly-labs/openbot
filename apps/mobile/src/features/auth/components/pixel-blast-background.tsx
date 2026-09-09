import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";

import { PIXEL_BLAST_SHADER } from "./pixel-blast-shader";

const EFFECT = Skia.RuntimeEffect.Make(PIXEL_BLAST_SHADER);
const INITIAL_TIME = 100;

// This decorative GPU canvas is outside HeroUI's product-control ownership.
export function PixelBlastBackground({ active }: { active: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const reduceMotion = useReducedMotion();
  const time = useSharedValue(INITIAL_TIME);
  const clicks = useSharedValue(Array.from({ length: 10 }, () => [0, 0, 0, 0]));
  const clickIndex = useSharedValue(0);
  const brush = useSharedValue([0, 0, 0, 0]);
  const direction = useSharedValue([0, 0]);
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const color = Array.from(Skia.Color(brandColor)).slice(0, 3);
  const running = active && foreground && !reduceMotion;

  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    time.set((value) => value + (timeSincePreviousFrame ?? 0) * 0.0006);
  }, false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    frame.setActive(running);
    return () => frame.setActive(false);
  }, [frame, running]);

  useEffect(() => {
    if (!running) {
      clicks.set(Array.from({ length: 10 }, () => [0, 0, 0, 0]));
      brush.set([0, 0, 0, 0]);
    }
  }, [brush, clicks, running]);

  const uniforms = useDerivedValue(() => ({
    resolution: [size.width, size.height],
    time: time.get(),
    color,
    clicks: clicks.get(),
    brush: brush.get(),
    direction: direction.get(),
  }));

  // Only the empty background receives this gesture. Foreground controls stay above it.
  const touch = Gesture.Pan()
    .enabled(running)
    .minDistance(0)
    .onBegin((event) => {
      const index = clickIndex.get();
      clicks.set((values) =>
        values.map((value, i) => (i === index ? [event.x, size.height - event.y, time.get(), 1] : value)),
      );
      clickIndex.set((index + 1) % 10);
      brush.set([event.x / size.width, 1 - event.y / size.height, time.get(), 0]);
    })
    .onUpdate((event) => {
      const x = event.x / size.width;
      const y = 1 - event.y / size.height;
      const previous = brush.get();
      const dx = x - previous[0];
      const dy = y - previous[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) return;
      direction.set([dx / distance, dy / distance]);
      brush.set([x, y, time.get(), Math.min(distance * distance * 10_000, 1)]);
    });

  return (
    <GestureDetector gesture={touch}>
      <View
        accessibilityElementsHidden
        className="absolute inset-0 overflow-hidden"
        collapsable={false}
        importantForAccessibility="no-hide-descendants"
        onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}
      >
        {EFFECT && size.width > 0 && size.height > 0 ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Fill>
              <Shader source={EFFECT} uniforms={uniforms} />
            </Fill>
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}
