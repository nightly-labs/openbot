import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useEffect } from "react";
import {
  type SharedValue,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import type { VoicePalette } from "../model/voice-palette";

// Four soft lobes rise from the bottom edge and sweep from side to side. Each
// one blends two neighbouring palette colours over time, so the glow moves
// through the agent's colour range without leaving it. The voice level pushes
// the lobes up; silence leaves a low, breathing glow.
const SOURCE = `
uniform float2 resolution;
uniform float time;
uniform float level;
uniform float presence;
uniform float3 c0;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;

float lobe(float2 uv, float centre, float width, float reach) {
  float dx = (uv.x - centre) / width;
  return exp(-dx * dx) * exp(-uv.y / max(reach, 0.001));
}

// The lobes rise together with the voice, with only a small offset each, and
// the top edge rolls slowly: separate jumps and fast ripples read as spikes.
float reachOf(float2 uv, float index, float phase) {
  float voice = level * (0.78 + 0.22 * sin(time * 1.8 + index * 1.9));
  float idle = 0.07 + 0.022 * sin(time * 0.9 + index);
  float wave = 1.0 + 0.11 * sin(uv.x * 5.0 + time * 0.95 + phase);
  return presence * (idle + 0.46 * voice) * wave;
}

half4 main(float2 position) {
  float2 uv = float2(position.x / resolution.x, 1.0 - position.y / resolution.y);

  float3 k0 = mix(c0, c1, 0.5 + 0.5 * sin(time * 0.35));
  float3 k1 = mix(c1, c2, 0.5 + 0.5 * sin(time * 0.35 + 1.57));
  float3 k2 = mix(c2, c3, 0.5 + 0.5 * sin(time * 0.35 + 3.14));
  float3 k3 = mix(c3, c0, 0.5 + 0.5 * sin(time * 0.35 + 4.71));

  // Wide lobes: a narrow one that rises far draws a peak.
  float w0 = lobe(uv, 0.5 + 0.32 * sin(time * 0.53), 0.35 + 0.055 * sin(time * 0.71), reachOf(uv, 0.0, 0.0));
  float w1 = lobe(uv, 0.5 + 0.37 * sin(time * 0.41 + 2.1), 0.31, reachOf(uv, 1.0, 1.3));
  float w2 = lobe(uv, 0.5 + 0.28 * sin(time * 0.67 + 4.2), 0.29 + 0.045 * sin(time * 0.5), reachOf(uv, 2.0, 2.6));
  float w3 = lobe(uv, 0.5 + 0.18 * sin(time * 0.37 + 1.3), 0.41, reachOf(uv, 3.0, 3.9));

  float weight = w0 + w1 + w2 + w3;
  float3 tint = (k0 * w0 + k1 * w1 + k2 * w2 + k3 * w3) / max(weight, 0.0001);
  // Faint vertical rays, so the glow reads as a curtain and not a flat haze.
  float rays = 0.92 + 0.08 * sin(uv.x * 28.0 + 1.8 * sin(uv.x * 7.0 + time * 0.7));
  float alpha = 1.0 - exp(-weight * 1.6);
  // Takes more off the bright peaks than off the middle tones, so a loud voice
  // does not flare and the glow keeps an even contrast.
  alpha = alpha * (1.0 - 0.18 * alpha) * rays;
  // The faint top of the glow has too little colour to read as the agent's:
  // it reads as a grey haze. Thin it out, so the glow fades on its own.
  alpha = pow(alpha, 1.4);

  // A brighter core along the bottom edge, where the voice button sits.
  float core = exp(-uv.y / (0.035 + 0.05 * level)) * (0.42 + 0.38 * level) * presence;
  tint = mix(tint, min(tint * 1.3 + 0.12, float3(1.0)), core * 0.5);
  alpha = alpha + core * 0.24;

  // The canvas edge must never show. A long fade, so it does not draw a ceiling.
  alpha *= presence * smoothstep(1.0, 0.45, uv.y);
  float noise = fract(sin(dot(position, float2(12.9898, 78.233))) * 43758.5453);
  alpha = clamp(alpha + (noise - 0.5) / 255.0, 0.0, 1.0);
  return half4(half3(tint * alpha), half(alpha));
}
`;

const EFFECT = Skia.RuntimeEffect.Make(SOURCE);
// The level rises fast and falls slowly, so the glow follows the voice without flicker.
const ATTACK_PER_SECOND = 8;
const RELEASE_PER_SECOND = 2.75;
// Reduced motion keeps one still glow at a fixed height.
const STILL_LEVEL = 0.25;

/** Decorative: the voice controls and the transcript carry the state for assistive technology. */
export function VoiceAurora({
  width,
  height,
  level,
  presence,
  palette,
}: {
  width: number;
  height: number;
  /** Microphone input level from 0 to 1. */
  level: SharedValue<number>;
  /** 0 hidden, 1 shown. */
  presence: SharedValue<number>;
  palette: VoicePalette;
}) {
  const reducedMotion = useReducedMotion();
  const time = useSharedValue(0);
  const smoothed = useSharedValue(0);
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    const seconds = (timeSincePreviousFrame ?? 16) / 1000;
    time.set(time.get() + seconds);
    const target = level.get();
    const current = smoothed.get();
    const rate = target > current ? ATTACK_PER_SECOND : RELEASE_PER_SECOND;
    smoothed.set(current + (target - current) * Math.min(1, seconds * rate));
  }, false);
  useEffect(() => {
    frame.setActive(!reducedMotion);
    return () => frame.setActive(false);
  }, [frame, reducedMotion]);
  const [c0, c1, c2, c3] = palette;
  const uniforms = useDerivedValue(() => ({
    resolution: [width, height],
    time: time.get(),
    level: reducedMotion ? STILL_LEVEL : smoothed.get(),
    presence: presence.get(),
    c0: [...c0],
    c1: [...c1],
    c2: [...c2],
    c3: [...c3],
  }));
  if (!EFFECT) return null;
  return (
    <Canvas
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}
    >
      <Fill>
        <Shader source={EFFECT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
