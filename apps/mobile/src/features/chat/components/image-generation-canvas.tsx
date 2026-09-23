import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { AppState, type ColorValue } from "react-native";
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";

// A dot grid with rings that travel out from the centre: the canvas the image is painted on.
// The dots near a crest brighten toward the accent, so the motion reads as work in progress
// without a percentage that the host never reports.
const SOURCE = `
uniform float2 resolution;
uniform float time;
uniform float failed;
uniform float3 base;
uniform float3 accent;

half4 main(float2 position) {
  float spacing = 11.0;
  float2 cell = floor(position / spacing);
  float2 local = position - (cell + 0.5) * spacing;
  float2 centre = resolution * 0.5;
  float distanceToCentre = length((cell + 0.5) * spacing - centre) / max(resolution.x, resolution.y);
  float wave = 0.5 + 0.5 * sin(distanceToCentre * 18.0 - time * 3.2);
  float crest = pow(wave, 6.0) * (1.0 - failed);
  float fade = 1.0 - smoothstep(0.35, 0.75, distanceToCentre);
  float radius = mix(1.0, 2.1, crest * fade);
  float mark = 1.0 - smoothstep(radius - 0.6, radius + 0.6, length(local));
  float3 color = mix(base, accent, crest * fade);
  float alpha = mark * mix(0.22, 0.95, crest * fade) * mix(1.0, 0.6, failed);
  float glow = (1.0 - smoothstep(0.0, 0.55, distanceToCentre)) * 0.08 * (1.0 - failed) * (0.6 + 0.4 * wave);
  return half4(half3(color * alpha + accent * glow), half(alpha + glow));
}
`;

const EFFECT = Skia.RuntimeEffect.Make(SOURCE);

function rgb(color: ColorValue): number[] {
  return Array.from(Skia.Color(String(color))).slice(0, 3);
}

/** Decorative: the frame around it carries the state for assistive technology. */
export function ImageGenerationCanvas({
  width,
  height,
  running,
  failed,
  base,
  accent,
}: {
  width: number;
  height: number;
  running: boolean;
  failed: boolean;
  base: ColorValue;
  accent: ColorValue;
}) {
  const reducedMotion = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const time = useSharedValue(0);
  const active = running && foreground && !reducedMotion && !failed;
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    time.set((value) => value + (timeSincePreviousFrame ?? 0) / 1000);
  }, false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    frame.setActive(active);
    return () => frame.setActive(false);
  }, [frame, active]);
  const baseColor = rgb(base);
  const accentColor = rgb(accent);
  const uniforms = useDerivedValue(() => ({
    resolution: [width, height],
    time: time.get(),
    failed: failed ? 1 : 0,
    base: baseColor,
    accent: accentColor,
  }));
  if (!EFFECT) return null;
  return (
    <Canvas style={{ position: "absolute", inset: 0 }} pointerEvents="none">
      <Fill>
        <Shader source={EFFECT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
