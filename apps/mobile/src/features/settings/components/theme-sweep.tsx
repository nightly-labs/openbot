import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  type SkImage,
  Skia,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia";
import { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";
import { scheduleOnRN } from "react-native-worklets";
import { endThemeSweep, reportThemeSweepShown, useThemeSweep } from "@/features/settings/model/theme-sweep";
import { isIOS } from "@/shared/lib/platform";

// The values of the desktop sweep (`src/renderer/src/theme-sweep.ts`), in screen heights.
const SWEEP_MS = 1200;
const AHEAD = 0.14;
const BEHIND = 0.32;
const REVEAL_LAG = 0.03;
const REVEAL = 0.14;
const END_RADIUS = (1 + BEHIND * 2) / 0.86;
const CREST = 0.09;
const PUSH = 22;
const PULL = 8;
const EDGE_GAIN = 2.2;
const CHANNEL_SPREAD = 0.08;

// The old theme opens from the front of an ellipse at the bottom middle (or top middle) of the
// screen. The wash of the desktop shader moves with the front, and a ripple moves the old picture
// ahead of it, with a small split of its colors. Everything after the front is transparent, so the
// live app shows in the new theme.
const SOURCE = `
uniform shader image;
uniform float2 resolution;
uniform float radius;
uniform float progress;
uniform float time;
uniform float down;
uniform float alpha;

float3 spectrum(float t) {
  return float3(0.74, 0.72, 0.76) + float3(0.5, 0.52, 0.48) * cos(6.28318 * (t + float3(0.92, 0.25, 0.58)));
}

float3 washColor(float t) {
  return spectrum(t) * 0.5 + spectrum(t - 0.18) * 0.25 + spectrum(t + 0.18) * 0.25;
}

half4 main(float2 position) {
  float2 uv = float2(position.x / resolution.x, 1.0 - position.y / resolution.y);
  if (down > 0.5) uv.y = 1.0 - uv.y;
  float t = time;

  // The front without its wave: the old picture opens here.
  float plain = (length(float2(uv.x - 0.5, uv.y / radius)) - 1.0) * radius;
  float keep = clamp((plain + ${(REVEAL_LAG + REVEAL).toFixed(3)}) / ${REVEAL.toFixed(3)}, 0.0, 1.0);

  // The ripple moves the old picture ahead of the front, more at the sides of the screen.
  float u = plain / ${CREST.toFixed(3)};
  float move = ${PUSH.toFixed(1)} * exp(-u * u) - ${PULL.toFixed(1)} * exp(-((u + 2.6) / 1.4) * ((u + 2.6) / 1.4));
  float across = uv.x * 2.0 - 1.0;
  move *= (1.0 + ${(EDGE_GAIN - 1).toFixed(2)} * across * across) * smoothstep(0.0, 0.08, progress);
  float2 ahead = float2(0.0, down > 0.5 ? 1.0 : -1.0);
  half4 red = image.eval(position - ahead * move * ${(1 + CHANNEL_SPREAD).toFixed(2)});
  half4 green = image.eval(position - ahead * move);
  half4 blue = image.eval(position - ahead * move * ${(1 - CHANNEL_SPREAD).toFixed(2)});
  half4 old = half4(red.r, green.g, blue.b, 1.0) * half(keep);

  // The wash: the front bends and breathes as it moves.
  float x = uv.x - 0.5 + 0.05 * sin(uv.y * 6.0 + t * 2.5) + 0.02 * sin(uv.y * 13.0 - t * 3.6);
  float wave = radius * (1.0 + 0.08 * sin(uv.x * 7.0 - t * 3.2) + 0.04 * sin(uv.x * 15.0 + t * 4.1)
    + 0.02 * sin(uv.x * 29.0 - t * 5.3));
  float s = (length(float2(x, uv.y / max(wave, 0.001))) - 1.0) * radius;
  float reach = s > 0.0 ? ${AHEAD.toFixed(3)} : ${BEHIND.toFixed(3)};
  float wash = exp(-(s * s) / (reach * reach)) * alpha;
  float2 warp = uv + 0.08 * float2(sin(uv.y * 5.0 + t * 1.7), sin(uv.x * 6.0 - t * 2.1));
  float hue = progress * 0.75 + s * 0.9 + 0.1 * sin(warp.x * 7.0 + warp.y * 4.0 + t * 2.0);
  float3 color = clamp(washColor(hue), 0.0, 1.0);

  return half4(half3(color * wash), half(wash)) + old * half(1.0 - wash);
}
`;

// Compiled on first use, not when the app starts.
let effect: SkRuntimeEffect | null | undefined;
function sweepEffect(): SkRuntimeEffect | null {
  if (effect === undefined) effect = Skia.RuntimeEffect.Make(SOURCE);
  return effect;
}

function easeInOut(t: number): number {
  "worklet";
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function smoothstep(from: number, to: number, value: number): number {
  "worklet";
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * The theme change sweep of `sweepTheme`, above the whole app. On iOS it sits above sheets too.
 * Decorative and does not take touches: the live app under it already shows the new theme.
 */
export function ThemeSweep() {
  const image = useThemeSweep((state) => state.image);
  const shader = sweepEffect();
  useEffect(() => {
    // A phone that cannot compile the shader changes the theme at once.
    if (!image || shader) return;
    endThemeSweep();
    image.dispose();
    reportThemeSweepShown();
  }, [image, shader]);
  if (!image || !shader) return null;
  const canvas = <SweepCanvas image={image} shader={shader} />;
  return isIOS ? <FullWindowOverlay>{canvas}</FullWindowOverlay> : canvas;
}

function SweepCanvas({ image, shader }: { image: SkImage; shader: SkRuntimeEffect }) {
  const { width, height } = useWindowDimensions();
  const down = useThemeSweep((state) => state.down);
  const running = useThemeSweep((state) => state.running);
  const progress = useSharedValue(0);

  // The canvas draws the picture until it unmounts, so it frees the picture then.
  useEffect(() => () => image.dispose(), [image]);

  useEffect(() => {
    // The canvas draws the picture in the frame after it mounts.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(reportThemeSweepShown);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    progress.set(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(endThemeSweep);
      }),
    );
  }, [progress, running]);

  const uniforms = useDerivedValue(() => {
    const value = progress.get();
    return {
      resolution: [width, height],
      radius: Math.max(0.001, END_RADIUS * easeInOut(value)),
      progress: value,
      time: (value * SWEEP_MS) / 1000,
      down: down ? 1 : 0,
      // The wash fades in at the start and out at the end, so no tint stays in the corners when the canvas goes.
      alpha: 0.8 * smoothstep(0, 0.12, value) * (1 - smoothstep(0.85, 1, value)),
    };
  });

  return (
    <Canvas
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Fill>
        <Shader source={shader} uniforms={uniforms}>
          {/* The picture is the whole window, from its top edge. Its height follows its own aspect, so a
              window that is taller than the reported window height does not stretch it. */}
          <ImageShader
            image={image}
            fit="fill"
            rect={{ x: 0, y: 0, width, height: (width * image.height()) / image.width() }}
          />
        </Shader>
      </Fill>
    </Canvas>
  );
}
