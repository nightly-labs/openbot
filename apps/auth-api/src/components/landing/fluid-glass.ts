/*
 * Ported from the React Bits FluidGlass component (https://reactbits.dev).
 *
 * MIT + Commons Clause License Condition v1.0
 *
 * Copyright (c) 2026 David Haz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * Commons Clause Restriction
 *
 * You may use this Software, including for any commercial purpose, so long as you
 * do not sell, sublicense, or redistribute the components themselves-whether alone,
 * in a bundle, or as a ported version.
 *
 * No Warranty
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export type GlassShape = "lens" | "blob" | "cube" | "pill" | "torus" | "prism" | "diamond";
export type GlassInteraction = "follow" | "drag";

export interface GlassPoint {
  readonly x: number;
  readonly y: number;
}

export interface GlassArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface GlassView {
  readonly width: number;
  readonly height: number;
}

export interface GlassLensSettings {
  readonly scene: string;
  readonly home: GlassPoint;
  readonly area: GlassArea;
  readonly shape: GlassShape;
  readonly cycle: readonly GlassShape[];
  readonly size: number;
  readonly refraction: number;
  readonly color: string;
  readonly tint: number;
  readonly wobble: number;
  readonly interaction: GlassInteraction;
}

export interface GlassLensParts {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly handle: HTMLElement | undefined;
  readonly paint: (context: CanvasRenderingContext2D, view: GlassView) => void;
  readonly onLive: (live: boolean) => void;
}

export interface GlassLens {
  refresh(): void;
  dispose(): void;
}

type Rgb = readonly [number, number, number];
type Quat = readonly [number, number, number, number];
type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
type Uniforms = ReadonlyMap<string, WebGLUniformLocation | null>;

interface ProgramEntry {
  readonly program: WebGLProgram;
  readonly fragment: WebGLShader | null;
  uniforms: Uniforms | null;
  failed: boolean;
}

interface Spring {
  value: number;
  speed: number;
}

interface Settings {
  readonly scene: string;
  readonly home: GlassPoint;
  readonly area: GlassArea;
  readonly shape: GlassShape;
  readonly cycle: readonly GlassShape[];
  readonly size: number;
  readonly ior: number;
  readonly color: Rgb;
  readonly tint: number;
  readonly wobble: number;
  readonly interaction: GlassInteraction;
}

const PIXEL_BUDGET = 5e6;
const SHADOW_SIZE = 160;
const MAX_RATIO = 2;
const DISPERSION = 0.35;
const REFLECTION = 1;
const FROST = 0;
const SHADOW = 0;
const ELEVATION = 0.4;
const SMOOTHNESS = 0.5;
const SPIN_RATE = 0.3;
const LIGHT: readonly [number, number, number] = [-0.42, 0.55, 1];
const DOUBLE_TAP_MS = 400;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const IDENTITY: Quat = [0, 0, 0, 1];
const SHAPES: readonly GlassShape[] = ["lens", "blob", "cube", "pill", "torus", "prism", "diamond"];
const EXTENT: Record<GlassShape, number> = {
  lens: 1.02,
  blob: 1.08,
  cube: 1.32,
  pill: 1.02,
  torus: 1.0,
  prism: 1.18,
  diamond: 1.05,
};
const BASE: Record<GlassShape, readonly [number, number, number]> = {
  lens: [0, 0, 0],
  blob: [0.2, 0, 0],
  cube: [-0.48, 0.62, 0.0],
  pill: [0.0, 0.0, 0.0],
  torus: [-0.5, 0.18, 0.0],
  prism: [-0.3, 0.45, 0.0],
  diamond: [-0.35, 0.5, 0.0],
};
const SPIN: Record<GlassShape, readonly [number, number]> = {
  lens: [0, 0],
  blob: [1, 0],
  cube: [1, 0],
  pill: [0, 0],
  torus: [0, 1],
  prism: [1, 0],
  diamond: [1, 0],
};

const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

const CONTENT = `#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uRatio;
uniform sampler2D uMedia;
uniform vec4 uMediaRect;
uniform float uMediaOn;
uniform sampler2D uText;
uniform float uTextOn;
uniform vec4 uBackground;
out vec4 fragColor;

void main() {
  vec2 w = gl_FragCoord.xy / uRatio;
  vec2 uv = vec2(w.x, uView.y - w.y) / uView;
  vec4 color = uBackground;
  if (uMediaOn > 0.5) {
    vec2 m = (uv - uMediaRect.xy) / uMediaRect.zw;
    if (m.x >= 0.0 && m.y >= 0.0 && m.x <= 1.0 && m.y <= 1.0) {
      vec4 media = texture(uMedia, m);
      color = media + color * (1.0 - media.a);
    }
  }
  if (uTextOn > 0.5) {
    vec4 text = texture(uText, uv);
    color = text + color * (1.0 - text.a);
  }
  fragColor = color;
}`;

const SDF: Record<GlassShape, string> = {
  lens: `{
    float a = length(p - vec3(0.0, 0.0, -1.85)) - 2.13;
    float b = length(p - vec3(0.0, 0.0, 1.85)) - 2.13;
    float h = clamp(0.5 - 0.5 * (b - a) / 0.2, 0.0, 1.0);
    return mix(b, a, h) + 0.2 * h * (1.0 - h);
  }`,
  blob: `{
    vec3 q = p * 1.6;
    float t = uTime;
    float n = sin(q.x + t * 1.1) * sin(q.y * 1.15 - t * 0.9) * sin(q.z * 0.95 + t * 0.8);
    n += 0.45 * sin(q.x * 1.6 - t * 0.6 + q.z) * sin(q.y * 1.9 + t * 1.2 + q.x * 0.5);
    return (length(p) - 0.92 - 0.085 * n) * 0.78;
  }`,
  cube: `{
    vec3 q = abs(p) - vec3(0.6);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.16;
  }`,
  pill: `{
    float outline = length(vec2(max(abs(p.x) - 0.58, 0.0), p.y)) - 0.42;
    vec2 q = vec2(outline + 0.16, abs(p.z) - 0.16);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.16;
  }`,
  torus: `{
    vec2 q = vec2(length(p.xy) - 0.68, p.z);
    return length(q) - 0.3;
  }`,
  prism: `{
    vec3 q = abs(p);
    float side = max(q.x * 0.866025 + p.y * 0.5, -p.y) - 0.5;
    float d = max(q.z - 0.34, side);
    return d - 0.08;
  }`,
  diamond: `{
    vec3 q = abs(p);
    return (q.x + q.y * 0.92 + q.z * 1.25 - 0.98) * 0.5;
  }`,
};

const SUPERSAMPLE = `
  float rim = tr.mode > 1.5 ? 1.0 - smoothstep(0.3, 0.55, clamp(-dot(rd, tr.n), 0.0, 1.0)) : tr.mode;
  if (rim > 0.0) {
    vec2 offsets[3] = vec2[3](vec2(0.33, 0.33), vec2(-0.33, 0.25), vec2(0.25, -0.33));
    float scatter = (length(tx) + length(ty)) / max(uBound, 1.0);
    for (int k = 0; k < 3; k++) {
      vec2 sub = w + offsets[k] * pixel;
      vec3 subDir = normalize(vec3(sub, 0.0) - camera);
      Trace st = traceSurface(ro, subDir, eps, pixel);
      if (st.mode > 1.5 && (uTint.a > 0.0 || bandOf(clamp(-dot(subDir, st.n), 0.0, 1.0), scatter) < 1.0)) {
        traceInterior(st, subDir, eps);
      }
      color += shadeTrace(st, subDir, background, tone, sub, tx, ty, rx, ry);
    }
    color *= 0.25;
  }`;

const fragmentFor = (a: GlassShape, b: GlassShape, supersample: boolean) => `#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uRatio;
uniform float uFocal;
uniform vec3 uCenter;
uniform mat3 uInverse;
uniform float uScale;
uniform float uBound;
uniform float uMorph;
uniform float uRipple;
uniform float uTime;
uniform float uIor;
uniform float uDispersion;
uniform float uReflection;
uniform float uFrost;
uniform vec4 uTint;
uniform float uShadow;
uniform vec3 uLight;
uniform float uPresence;
uniform sampler2D uMedia;
uniform vec4 uMediaRect;
uniform float uMediaOn;
uniform sampler2D uText;
uniform float uTextOn;
uniform vec4 uBackground;
uniform float uPass;
uniform sampler2D uShadowMap;
uniform vec4 uShadowBox;
uniform vec2 uShadowSize;
out vec4 fragColor;

float shapeA(vec3 p) ${SDF[a]}
float shapeB(vec3 p) ${SDF[b]}

float field(vec3 p) {
  float d = shapeA(p);
  ${a !== b ? "d = mix(d, shapeB(p), uMorph);" : ""}
  if (uRipple > 0.0) {
    d += uRipple * sin(p.x * 3.1 + uTime * 2.3) * sin(p.y * 3.4 - uTime * 1.9) * sin(p.z * 2.9 + uTime * 1.6);
  }
  return d;
}

float map(vec3 w) {
  return field(uInverse * (w - uCenter)) * uScale;
}

vec3 normalAt(vec3 w) {
  float e = 0.35;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(w + k.xyy * e) +
    k.yyx * map(w + k.yyx * e) +
    k.yxy * map(w + k.yxy * e) +
    k.xxx * map(w + k.xxx * e)
  );
}

vec4 content(vec2 w, vec2 gx, vec2 gy) {
  vec2 uv = vec2(w.x, uView.y - w.y) / uView;
  vec2 dx = vec2(gx.x, -gx.y) / uView;
  vec2 dy = vec2(gy.x, -gy.y) / uView;
  vec4 color = uBackground;
  if (uMediaOn > 0.5) {
    vec2 m = (uv - uMediaRect.xy) / uMediaRect.zw;
    vec2 inside = step(vec2(0.0), m) * step(m, vec2(1.0));
    vec4 media = textureGrad(uMedia, m, dx / uMediaRect.zw, dy / uMediaRect.zw) * inside.x * inside.y;
    color = media + color * (1.0 - media.a);
  }
  if (uTextOn > 0.5) {
    vec4 text = textureGrad(uText, uv, dx, dy);
    color = text + color * (1.0 - text.a);
  }
  return color;
}

vec4 frosted(vec2 w, vec2 gx, vec2 gy) {
  if (uFrost <= 0.0) return content(w, gx, gy);
  float r = uFrost * 16.0;
  vec2 bx = gx + vec2(r * 0.35, 0.0);
  vec2 by = gy + vec2(0.0, r * 0.35);
  vec4 sum = content(w, bx, by) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.3;
    sum += content(w + vec2(cos(a), sin(a)) * r * (0.55 + 0.45 * float(i & 1)), bx, by) * 0.1;
  }
  return sum;
}

vec3 studio(vec3 d) {
  vec2 a = vec2(atan(d.x, d.z), d.y);
  float key = smoothstep(0.42, 0.22, abs(a.x + 0.62)) * smoothstep(0.3, 0.12, abs(a.y - 0.5));
  float strip = smoothstep(0.12, 0.05, abs(a.x - 0.95)) * smoothstep(0.8, 0.35, abs(a.y - 0.05));
  float dome = smoothstep(0.0, 1.0, d.z) * 0.04;
  return vec3(18.0) * key + vec3(8.0) * strip + vec3(dome);
}

vec4 light(vec3 d, float weight) {
  vec3 c = studio(d) * weight;
  float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
  return vec4(min(c, vec3(a)), a);
}

vec2 landing(vec3 o, vec3 d, vec2 fallback) {
  if (d.z > -0.0005) return fallback;
  return o.xy + d.xy * (-o.z / d.z);
}

float shadowAt(vec2 w, out float caustic) {
  caustic = 0.0;
  if (uShadow <= 0.0) return 0.0;
  vec3 p = vec3(w, 0.0);
  vec2 footprint = uCenter.xy + uLight.xy / uLight.z * uCenter.z;
  if (length(w - footprint) > uBound * 1.6) return 0.0;
  float t = 2.0;
  float occlusion = 1.0;
  float deepest = 1e5;
  for (int i = 0; i < 28; i++) {
    float h = map(p + uLight * t);
    deepest = min(deepest, h);
    if (h > 0.0) occlusion = min(occlusion, 6.0 * h / t);
    if (t > uCenter.z * 2.6 + uBound * 2.0) break;
    t += clamp(abs(h) * 0.8, 2.0, uBound * 0.25);
  }
  if (deepest > 0.0) return (1.0 - clamp(occlusion, 0.0, 1.0)) * 0.36;
  float depth = -deepest / max(uBound, 1.0);
  caustic = smoothstep(0.12, 0.5, depth) * (uIor - 1.0) * 2.0;
  return exp(-depth * 14.0) * 0.42;
}

vec2 shadowSample(vec2 w) {
  if (uShadow <= 0.0) return vec2(0.0);
  vec2 uv = (w - uShadowBox.xy) / uShadowBox.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
  vec2 s = textureLod(uShadowMap, uv, 0.0).rg;
  return vec2(s.x * 0.42, s.y * 2.0);
}

vec2 lighting(vec2 w, float under) {
  vec2 s = shadowSample(w);
  float dark = s.x * uShadow * uPresence;
  float glow = clamp(s.y * uShadow * uPresence, 0.0, 1.0) * mix(0.12, 0.3, under);
  return vec2(dark * mix(0.45, 1.0, under), glow);
}

vec4 shade(vec4 color, vec2 factors) {
  vec3 rgb = color.rgb * (1.0 - factors.x);
  float alpha = color.a + factors.x - color.a * factors.x;
  rgb = vec3(factors.y) + rgb * (1.0 - factors.y);
  alpha = factors.y + alpha * (1.0 - factors.y);
  return vec4(rgb, alpha);
}

struct Trace {
  float mode;
  float cover;
  vec3 p;
  vec3 n;
  vec3 q;
  vec3 inside;
  vec3 exitNormal;
  vec3 exitDir;
  float escaped;
  float travel;
  float bounces;
};

Trace traceSurface(vec3 ro, vec3 rd, float eps, float pixel) {
  Trace tr;
  tr.mode = 0.0;
  tr.cover = 0.0;
  tr.p = vec3(0.0);
  tr.n = vec3(0.0, 0.0, 1.0);
  tr.q = vec3(0.0);
  tr.inside = vec3(0.0, 0.0, -1.0);
  tr.exitNormal = vec3(0.0, 0.0, 1.0);
  tr.exitDir = vec3(0.0, 0.0, -1.0);
  tr.escaped = 0.0;
  tr.travel = 0.0;
  tr.bounces = 0.0;
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uBound * uBound;
  float disc = b * b - c;
  if (disc <= 0.0 || uPresence <= 0.0) return tr;
  float sq = sqrt(disc);
  float t = max(-b - sq, 0.0);
  float tEnd = -b + sq;
  float closest = 1e5;
  float closestT = t;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    float d = map(ro + rd * t);
    if (d < closest) {
      closest = d;
      closestT = t;
    }
    if (d < eps) {
      hit = true;
      break;
    }
    t += d * 0.9;
    if (t > tEnd) break;
  }
  if (!hit && closest < pixel * 0.35) {
    hit = true;
    t = closestT;
  }
  if (!hit) {
    tr.cover = clamp(1.0 - closest / (pixel * 1.2), 0.0, 1.0) * uPresence;
    if (tr.cover > 0.0) {
      tr.mode = 1.0;
      tr.p = ro + rd * closestT;
      tr.n = normalAt(tr.p);
    }
    return tr;
  }
  tr.mode = 2.0;
  tr.p = ro + rd * t;
  tr.n = normalAt(tr.p);
  return tr;
}

void traceInterior(inout Trace tr, vec3 rd, float eps) {
  vec3 inside = refract(rd, tr.n, 1.0 / uIor);
  vec3 q = tr.p + inside * eps * 4.0;
  vec3 exitDir = inside;
  bool escaped = false;
  for (int bounce = 0; bounce < 3; bounce++) {
    for (int i = 0; i < 64; i++) {
      float d = map(q);
      if (d > -eps) break;
      float stepLength = max(-d * 0.9, eps);
      q += inside * stepLength;
      tr.travel += stepLength;
    }
    vec3 n2 = normalAt(q);
    tr.exitNormal = n2;
    vec3 out1 = refract(inside, -n2, uIor);
    if (dot(out1, out1) > 0.0) {
      exitDir = out1;
      escaped = true;
      break;
    }
    inside = reflect(inside, -n2);
    q += inside * eps * 4.0;
    tr.bounces += 1.0;
  }
  if (!escaped) exitDir = inside;
  if (exitDir.z > -0.2) exitDir = normalize(vec3(exitDir.xy, -0.2 - abs(exitDir.z)));
  tr.q = q;
  tr.inside = inside;
  tr.exitDir = exitDir;
  tr.escaped = escaped ? 1.0 : 0.0;
}

float bandOf(float cosi, float scatter) {
  return max(smoothstep(0.42, 0.12, cosi), smoothstep(0.06, 0.24, scatter));
}

vec4 shadeTrace(Trace tr, vec3 rd, vec4 background, vec4 tone, vec2 w, vec2 tx, vec2 ty, vec2 rx, vec2 ry) {
  if (tr.mode < 0.5) return background;
  vec3 mirrorDir = reflect(rd, tr.n);
  if (tr.mode < 1.5) {
    vec4 edgeTone = tone * uReflection * 0.8 + light(mirrorDir, uReflection) * 0.5;
    return mix(background, edgeTone + background * (1.0 - edgeTone.a), tr.cover * 0.7);
  }
  float cosi = clamp(-dot(rd, tr.n), 0.0, 1.0);
  float f0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
  float band = bandOf(cosi, (length(tx) + length(ty)) / max(uBound, 1.0));

  vec4 mirror = tone * uReflection;
  vec4 transmitted = tone;
  if (band < 1.0) {
    mirror = mirrorDir.z < -0.0005 ? frosted(landing(tr.p, mirrorDir, w), rx, ry) * uReflection : light(mirrorDir, uReflection);
    vec2 hitT = landing(tr.q, tr.exitDir, w);
    vec4 green = frosted(hitT, tx, ty);
    vec4 red = green;
    vec4 blue = green;
    if (tr.escaped > 0.5 && uDispersion > 0.0) {
      vec3 spread = vec3(-1.0, 0.0, 1.0) * uDispersion * 0.06;
      vec3 dirR = refract(tr.inside, -tr.exitNormal, uIor + spread.x);
      vec3 dirB = refract(tr.inside, -tr.exitNormal, uIor + spread.z);
      if (dot(dirR, dirR) > 0.0 && dirR.z < -0.2) red = frosted(landing(tr.q, dirR, hitT), tx, ty);
      if (dot(dirB, dirB) > 0.0 && dirB.z < -0.2) blue = frosted(landing(tr.q, dirB, hitT), tx, ty);
    }
    vec2 factors = lighting(hitT, 0.0);
    red = shade(red, factors);
    green = shade(green, factors);
    blue = shade(blue, factors);
    transmitted = mix(vec4(red.r, green.g, blue.b, green.a), tone, band);
    mirror = mix(mirror, tone * uReflection, band);
  }

  vec3 tint = pow(max(uTint.rgb, vec3(0.001)), vec3(uTint.a * tr.travel / max(uBound, 1.0)));
  transmitted.rgb *= tint;
  float body = (1.0 - dot(tint, vec3(0.3333))) * 0.7;
  transmitted += vec4(uTint.rgb * body, body) * (1.0 - transmitted.a);

  vec4 reflected = mirrorDir.z < -0.0005 ? mirror * fresnel : light(mirrorDir, uReflection * fresnel);
  vec4 glass = reflected + transmitted * (1.0 - reflected.a);
  float edge = 1.0 - smoothstep(0.04, 0.3, cosi);
  glass = mix(glass, mirror + background * (1.0 - mirror.a), edge);
  vec2 facing = normalize(vec2(-0.42, 0.55));
  float rimLight = pow(1.0 - cosi, 3.0) * (0.25 + 0.75 * abs(dot(normalize(tr.n.xy + 1e-5), facing))) * 0.55 * uReflection;
  rimLight *= smoothstep(0.0, 0.08, cosi);
  glass = vec4(rimLight) + glass * (1.0 - rimLight);
  return mix(background, glass, uPresence);
}

void main() {
  if (uPass > 0.5) {
    float caustic;
    float dark = shadowAt(uShadowBox.xy + gl_FragCoord.xy / uShadowSize * uShadowBox.zw, caustic);
    fragColor = vec4(dark / 0.42, caustic * 0.5, 0.0, 1.0);
    return;
  }
  vec2 w = gl_FragCoord.xy / uRatio;
  vec3 camera = vec3(uView * 0.5, uFocal);
  vec3 ro = camera;
  vec3 rd = normalize(vec3(w, 0.0) - camera);
  float pixel = 1.0 / uRatio;
  float eps = 0.25 * pixel;

  Trace tr = traceSurface(ro, rd, eps, pixel);
  if (tr.mode > 1.5) traceInterior(tr, rd, eps);
  vec2 hitT = tr.mode > 1.5 ? landing(tr.q, tr.exitDir, w) : w;
  vec2 hitR = tr.mode > 0.5 ? landing(tr.p, reflect(rd, tr.n), w) : w;
  vec2 tx = dFdx(hitT);
  vec2 ty = dFdy(hitT);
  vec2 rx = dFdx(hitR);
  vec2 ry = dFdy(hitR);
  vec2 wx = dFdx(w);
  vec2 wy = dFdy(w);

  vec4 background = shade(content(w, wx, wy), lighting(w, 1.0));
  vec4 tone = tr.mode > 0.5 ? content(uCenter.xy, vec2(uBound * 1.4, 0.0), vec2(0.0, uBound * 1.4)) : vec4(0.0);
  vec4 color = shadeTrace(tr, rd, background, tone, w, tx, ty, rx, ry);
  ${supersample ? SUPERSAMPLE : ""}
  fragColor = color;
}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
};

const smoother = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const quaternion = (x: number, y: number, z: number): Quat => {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
};

const multiply = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const mixed: Quat = [
      a[0] + (target[0] - a[0]) * t,
      a[1] + (target[1] - a[1]) * t,
      a[2] + (target[2] - a[2]) * t,
      a[3] + (target[3] - a[3]) * t,
    ];
    const length = Math.hypot(...mixed);
    return [mixed[0] / length, mixed[1] / length, mixed[2] / length, mixed[3] / length];
  }
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [
    a[0] * wa + target[0] * wb,
    a[1] * wa + target[1] * wb,
    a[2] * wa + target[2] * wb,
    a[3] * wa + target[3] * wb,
  ];
};

const driftAt = (clock: number, size: number): readonly [number, number] => [
  Math.sin(clock * 0.37) * size * 0.35 + Math.sin(clock * 0.71 + 1.3) * size * 0.12,
  Math.sin(clock * 0.29 + 0.8) * size * 0.2 + Math.cos(clock * 0.53) * size * 0.08,
];

const toMatrix = ([x, y, z, w]: Quat): Mat3 => [
  1 - 2 * (y * y + z * z),
  2 * (x * y + z * w),
  2 * (x * z - y * w),
  2 * (x * y - z * w),
  1 - 2 * (x * x + z * z),
  2 * (y * z + x * w),
  2 * (x * z + y * w),
  2 * (y * z - x * w),
  1 - 2 * (x * x + y * y),
];

const advance = (spring: Spring, target: number, omega: number, zeta: number, dt: number) => {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let index = 0; index < steps; index++) {
    spring.speed += (omega * omega * (target - spring.value) - 2 * zeta * omega * spring.speed) * h;
    spring.value += spring.speed * h;
  }
  const settled = Math.abs(target - spring.value) < 0.0005 && Math.abs(spring.speed) < 0.002;
  if (settled) {
    spring.value = target;
    spring.speed = 0;
  }
  return !settled;
};

const colorCache = new Map<string, Rgb>();

const toRgb = (value: string): Rgb => {
  const known = colorCache.get(value);
  if (known) return known;
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const pen = probe.getContext("2d", { willReadFrequently: true });
  let rgb: Rgb = [1, 1, 1];
  if (pen) {
    pen.fillStyle = "#ffffff";
    pen.fillStyle = value;
    pen.fillRect(0, 0, 1, 1);
    const [r = 255, g = 255, b = 255] = pen.getImageData(0, 0, 1, 1).data;
    rgb = [r / 255, g / 255, b / 255];
  }
  colorCache.set(value, rgb);
  return rgb;
};

const range = (low: number, high: number, room: number) => {
  const min = low + room;
  const max = high - room;
  if (max >= min) return { min, max };
  const middle = (low + high) / 2;
  return { min: middle, max: middle };
};

const isShape = (value: string | undefined): value is GlassShape => SHAPES.some((shape) => shape === value);

const shapeOf = (value: string | undefined): GlassShape => (isShape(value) ? value : "lens");

const settingsOf = (raw: GlassLensSettings): Settings => ({
  scene: raw.scene,
  home: raw.home,
  area: raw.area,
  shape: shapeOf(raw.shape),
  cycle: raw.cycle.length ? raw.cycle : SHAPES,
  size: Math.max(16, raw.size),
  ior: 1 + 0.5 * clamp(raw.refraction, 0, 2),
  color: toRgb(raw.color),
  tint: clamp(raw.tint, 0, 1),
  wobble: clamp(raw.wobble, 0, 1),
  interaction: raw.interaction,
});

const uniformAt = (uniforms: Uniforms, name: string) => uniforms.get(name) ?? null;

function runGlass(parts: GlassLensParts, read: () => GlassLensSettings, intro: boolean, restart: () => void) {
  const { container, canvas, handle, paint } = parts;
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!context) return null;
  const gl = context;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  if (!vertex) return null;
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const programs = new Map<string, ProgramEntry>();
  const settings = () => settingsOf(read());
  const view = { width: 1, height: 1, ratio: 1 };

  const request = (name: string): ProgramEntry => {
    const key = name === "content" ? name : `${name}>${view.ratio < 1.75 ? 1 : 0}`;
    const known = programs.get(key);
    if (known) return known;
    const [a, b, sampled] = key.split(">");
    const fragment = compile(
      gl,
      gl.FRAGMENT_SHADER,
      key === "content" ? CONTENT : fragmentFor(shapeOf(a), shapeOf(b), sampled === "1"),
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    if (fragment) gl.attachShader(program, fragment);
    gl.linkProgram(program);
    const entry: ProgramEntry = { program, fragment, uniforms: null, failed: !fragment };
    programs.set(key, entry);
    return entry;
  };

  const ready = (entry: ProgramEntry) => {
    if (entry.failed) return false;
    if (entry.uniforms) return true;
    if (parallel && !gl.getProgramParameter(entry.program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      entry.failed = true;
      return false;
    }
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const count: number = gl.getProgramParameter(entry.program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index++) {
      const info = gl.getActiveUniform(entry.program, index);
      if (info) uniforms.set(info.name, gl.getUniformLocation(entry.program, info.name));
    }
    entry.uniforms = uniforms;
    return true;
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vao = gl.createVertexArray();
  const makeTexture = () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  };
  const mediaTexture = makeTexture();
  const textTexture = makeTexture();
  const shadowMap = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowMap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const shadowTarget = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowMap, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const textCanvas = document.createElement("canvas");
  const textState = { key: "", ready: false };

  const pointer = {
    x: 0,
    y: 0,
    inside: false,
    down: false,
    grabbed: false,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  };
  const body = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    ripple: 0,
    dirX: 1,
    dirY: 0,
    anchorX: 0,
    anchorY: 0,
  };
  const stretch: Spring = { value: 1, speed: 0 };
  const tiltX: Spring = { value: 0, speed: 0 };
  const tiltY: Spring = { value: 0, speed: 0 };
  const scaleSpring: Spring = { value: 0, speed: 0 };
  const first = settings();
  let placed = false;
  let flying = false;
  const morph: { from: GlassShape; to: GlassShape; t: number; pending: GlassShape | null } = {
    from: first.shape,
    to: first.shape,
    t: 1,
    pending: null,
  };
  let requested = first.shape;
  let presence = intro && !reduced ? 0 : 1;
  if (presence === 1) scaleSpring.value = 1;
  let time = 0;
  let idleClock = Math.random() * 20;
  let raf = 0;
  let disposed = false;
  let last = 0;
  let tick = 0;
  let pace = 1000 / 60;
  let skipped = 0;
  let calm = false;
  let visible = true;
  let pageVisible = document.visibilityState !== "hidden";
  let lost = false;
  let current: ProgramEntry | null = null;
  let pendingTap: ReturnType<typeof setTimeout> | undefined;

  const drawText = () => {
    const s = settings();
    const width = canvas.width;
    const height = canvas.height;
    const key = [s.scene, width, height].join("|");
    if (key === textState.key) return;
    textState.key = key;
    textCanvas.width = width;
    textCanvas.height = height;
    const ctx = textCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    paint(ctx, { width: view.width, height: view.height });
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    textState.ready = true;
  };

  const radius = () => Math.min(settings().size / 2, Math.min(view.width, view.height) * 0.36);

  const walls = (s: Settings) => {
    const edge = radius() * 1.08;
    const x = range(Math.max(0, s.area.left), Math.min(view.width, s.area.right), edge);
    const y = range(Math.max(0, s.area.top), Math.min(view.height, s.area.bottom), edge);
    return { left: x.min, right: x.max, top: y.min, bottom: y.max };
  };

  let resizePending = false;
  const applyResize = () => {
    const s = settings();
    const rect = container.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO, Math.sqrt(PIXEL_BUDGET / (cssWidth * cssHeight)));
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    view.width = cssWidth;
    view.height = cssHeight;
    view.ratio = width / cssWidth;
    drawText();
    const next = settings();
    if (!placed) {
      body.x = next.home.x;
      body.y = next.home.y;
      body.anchorX = body.x;
      body.anchorY = body.y;
      placed = true;
    } else if (s.interaction === "drag") {
      const wall = walls(next);
      body.anchorX = clamp(body.anchorX, wall.left, wall.right);
      body.anchorY = clamp(body.anchorY, wall.top, wall.bottom);
    }
  };

  const bindContent = (u: Uniforms) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mediaTexture);
    gl.uniform1i(uniformAt(u, "uMedia"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.uniform1i(uniformAt(u, "uText"), 1);
    gl.uniform2f(uniformAt(u, "uView"), view.width, view.height);
    gl.uniform1f(uniformAt(u, "uRatio"), view.ratio);
    gl.uniform4f(uniformAt(u, "uMediaRect"), 0, 0, 1, 1);
    gl.uniform1f(uniformAt(u, "uMediaOn"), 0);
    gl.uniform1f(uniformAt(u, "uTextOn"), textState.ready ? 1 : 0);
    gl.uniform4f(uniformAt(u, "uBackground"), 0, 0, 0, 0);
  };

  const settle = () => {
    const s = settings();
    const size = radius();
    const drift = reduced ? [0, 0] : driftAt(idleClock, size);
    const wall = walls(s);
    body.anchorX = clamp(body.x, wall.left, wall.right) - (drift[0] ?? 0);
    body.anchorY = clamp(body.y, wall.top, wall.bottom) - (drift[1] ?? 0);
  };

  const kick = (amount: number, s: Settings) => {
    stretch.speed -= amount * s.wobble;
  };

  function frame(now: number) {
    raf = 0;
    if (resizePending) {
      resizePending = false;
      applyResize();
    }
    if (lost) return;
    const gap = now - tick;
    tick = now;
    if (gap > 2 && gap < 100) pace += (gap - pace) * 0.1;
    if (calm && skipped < Math.round(12 / pace) - 1) {
      skipped += 1;
      if (visible && pageVisible) raf = requestAnimationFrame(frame);
      return;
    }
    skipped = 0;
    const s = settings();
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
    last = Math.max(last, now);
    time += dt;
    let busy = false;

    if (s.shape !== requested) {
      requested = s.shape;
      morph.pending = s.shape;
    }
    if (morph.pending && morph.t >= 1) {
      const entry = request(`${morph.to}>${morph.pending}`);
      if (ready(entry)) {
        request(`${morph.pending}>${morph.pending}`);
        morph.from = morph.to;
        morph.to = morph.pending;
        morph.pending = null;
        morph.t = 0;
        kick(2.5, s);
      }
      busy = true;
    }
    if (morph.t < 1) {
      morph.t = Math.min(1, morph.t + dt / (reduced ? 0.35 : 0.85));
      busy = true;
    }
    if (s.cycle.length > 1 && !morph.pending) {
      const index = s.cycle.indexOf(morph.to);
      const upcoming = s.cycle[(index + 1) % s.cycle.length];
      if (upcoming) request(`${morph.to}>${upcoming}`);
    }

    const size = radius();
    const wall = walls(s);
    if (!pointer.grabbed && s.interaction !== "drag") {
      body.anchorX = s.home.x;
      body.anchorY = s.home.y;
    }
    const drifting = !reduced;
    if (drifting && !pointer.grabbed) {
      idleClock += dt;
      busy = true;
    }
    const drift = drifting ? driftAt(idleClock, size) : [0, 0];
    let goalX = body.anchorX + (drift[0] ?? 0);
    let goalY = body.anchorY + (drift[1] ?? 0);
    if (s.interaction === "follow" && pointer.inside) {
      goalX = pointer.x;
      goalY = pointer.y;
    }
    const omega = (pointer.grabbed ? 34 : 24) * 0.18 ** SMOOTHNESS * (reduced ? 1.6 : 1);
    const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / substeps;
    if (pointer.grabbed) {
      goalX = pointer.x - pointer.offsetX;
      goalY = pointer.y - pointer.offsetY;
      flying = false;
    }
    goalX = clamp(goalX, wall.left, wall.right);
    goalY = clamp(goalY, wall.top, wall.bottom);
    if (flying) {
      for (let index = 0; index < substeps; index++) {
        body.x += body.vx * h;
        body.y += body.vy * h;
        const friction = Math.exp(-h * 1.4);
        body.vx *= friction;
        body.vy *= friction;
        if (body.x < wall.left || body.x > wall.right) {
          body.x = clamp(body.x, wall.left, wall.right);
          kick(Math.min(4, Math.abs(body.vx) * 0.0016), s);
          body.vx *= -0.62;
        }
        if (body.y < wall.top || body.y > wall.bottom) {
          body.y = clamp(body.y, wall.top, wall.bottom);
          kick(Math.min(4, Math.abs(body.vy) * 0.0016), s);
          body.vy *= -0.62;
        }
      }
      if (Math.hypot(body.vx, body.vy) < 30) {
        flying = false;
        settle();
      }
      busy = true;
    } else {
      for (let index = 0; index < substeps; index++) {
        body.vx += (omega * omega * (goalX - body.x) - 2 * 0.86 * omega * body.vx) * h;
        body.vy += (omega * omega * (goalY - body.y) - 2 * 0.86 * omega * body.vy) * h;
        body.x += body.vx * h;
        body.y += body.vy * h;
      }
      if (Math.abs(goalX - body.x) + Math.abs(goalY - body.y) > 0.05 || Math.hypot(body.vx, body.vy) > 0.5) busy = true;
    }

    const speed = Math.hypot(body.vx, body.vy);
    if (speed > 1) {
      body.dirX = body.vx / speed;
      body.dirY = body.vy / speed;
    }
    const stretchTarget = 1 + clamp(speed / 1800, 0, 0.55) * s.wobble * (reduced ? 0 : 1);
    busy = advance(stretch, stretchTarget, 13, 0.32, dt) || busy;
    const tiltGain = reduced ? 0 : 0.00045;
    busy = advance(tiltX, clamp(body.vy * tiltGain, -0.7, 0.7), 9, 0.5, dt) || busy;
    busy = advance(tiltY, clamp(body.vx * tiltGain, -0.7, 0.7), 9, 0.5, dt) || busy;
    if (!reduced && (morph.to === "blob" || (morph.from === "blob" && morph.t < 1))) busy = true;
    if (!reduced) {
      body.spin += dt * SPIN_RATE;
      busy = true;
    }
    const entry = request(morph.t < 1 ? `${morph.from}>${morph.to}` : `${morph.to}>${morph.to}`);
    if (ready(entry)) current = entry;
    else busy = true;
    if (current) {
      if (presence < 1) {
        presence = Math.min(1, presence + dt / 0.5);
        busy = true;
      }
      busy = advance(scaleSpring, 1, 11, 0.52, dt) || busy;
    }
    body.ripple +=
      ((morph.t < 1 ? 0.05 * s.wobble * Math.sin(Math.PI * morph.t) : 0) - body.ripple) * (1 - Math.exp(-dt / 0.08));

    if (!current?.uniforms) {
      const fallback = request("content");
      if (ready(fallback) && fallback.uniforms) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(fallback.program);
        gl.bindVertexArray(vao);
        bindContent(fallback.uniforms);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (visible && pageVisible) raf = requestAnimationFrame(frame);
      return;
    }

    const eased = smoother(morph.t);
    const extent = EXTENT[morph.from] + (EXTENT[morph.to] - EXTENT[morph.from]) * eased;
    const unit = size / extent;
    const scale = Math.max(0.001, scaleSpring.value);
    const qa = quaternion(...BASE[morph.from]);
    const qb = quaternion(...BASE[morph.to]);
    let orientation = slerp(qa, qb, eased);
    const tumble = SPIN[morph.from][0] + (SPIN[morph.to][0] - SPIN[morph.from][0]) * eased;
    const sway = SPIN[morph.from][1] + (SPIN[morph.to][1] - SPIN[morph.from][1]) * eased;
    const angle = body.spin % (Math.PI * 2);
    const turnY = slerp(IDENTITY, quaternion(0, angle, 0), tumble);
    const turnZ = slerp(IDENTITY, quaternion(0, 0, angle), sway);
    orientation = multiply(multiply(quaternion(Math.sin(body.spin * 0.6) * 0.18 * tumble, 0, 0), turnY), orientation);
    orientation = multiply(turnZ, orientation);
    orientation = multiply(quaternion(tiltX.value, tiltY.value, 0), orientation);
    const r = toMatrix(orientation);
    const sx = Math.max(0.2, stretch.value);
    const q = 1 / Math.sqrt(sx);
    const ux = body.dirX;
    const uy = -body.dirY;
    const inv: Mat3 = [
      1 / q + (1 / sx - 1 / q) * ux * ux,
      (1 / sx - 1 / q) * ux * uy,
      0,
      (1 / sx - 1 / q) * ux * uy,
      1 / q + (1 / sx - 1 / q) * uy * uy,
      0,
      0,
      0,
      1 / q,
    ];
    const transposeR: Mat3 = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
    const combined = new Float32Array(9);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += (transposeR[k * 3 + row] ?? 0) * (inv[col * 3 + k] ?? 0);
        combined[col * 3 + row] = sum / (unit * scale);
      }
    }
    const minScale = Math.min(sx, q);
    const maxScale = Math.max(sx, q);
    const focal = Math.max(view.width, view.height) * 1.6;
    const height = unit * (0.35 + ELEVATION);
    const worldY = view.height - body.y;
    const cx = view.width / 2 + (body.x - view.width / 2) * ((focal - height) / focal);
    const cy = view.height / 2 + (worldY - view.height / 2) * ((focal - height) / focal);

    if (handle) {
      const reach = size * scale * 2;
      handle.style.width = `${reach.toFixed(1)}px`;
      handle.style.height = `${reach.toFixed(1)}px`;
      handle.style.transform = `translate3d(${(body.x - reach / 2).toFixed(1)}px, ${(body.y - reach / 2).toFixed(1)}px, 0)`;
    }

    const u = current.uniforms;
    gl.useProgram(current.program);
    gl.bindVertexArray(vao);
    bindContent(u);
    gl.uniform1f(uniformAt(u, "uFocal"), focal);
    gl.uniform3f(uniformAt(u, "uCenter"), cx, cy, height);
    gl.uniformMatrix3fv(uniformAt(u, "uInverse"), false, combined);
    gl.uniform1f(uniformAt(u, "uScale"), unit * scale * minScale);
    const bound = size * scale * maxScale * 1.08 + 2;
    gl.uniform1f(uniformAt(u, "uBound"), bound);
    gl.uniform1f(uniformAt(u, "uMorph"), eased);
    gl.uniform1f(uniformAt(u, "uRipple"), body.ripple);
    gl.uniform1f(uniformAt(u, "uTime"), reduced ? 0 : time);
    gl.uniform1f(uniformAt(u, "uIor"), s.ior);
    gl.uniform1f(uniformAt(u, "uDispersion"), DISPERSION);
    gl.uniform1f(uniformAt(u, "uReflection"), REFLECTION);
    gl.uniform1f(uniformAt(u, "uFrost"), FROST);
    gl.uniform4f(uniformAt(u, "uTint"), s.color[0], s.color[1], s.color[2], s.tint * 1.6);
    gl.uniform1f(uniformAt(u, "uShadow"), SHADOW);
    const length = Math.hypot(...LIGHT);
    gl.uniform3f(uniformAt(u, "uLight"), LIGHT[0] / length, LIGHT[1] / length, LIGHT[2] / length);
    gl.uniform1f(uniformAt(u, "uPresence"), presence);
    const footprint = bound * 1.6 * (SHADOW_SIZE / (SHADOW_SIZE - 6)) + 1;
    const footX = cx + (LIGHT[0] / LIGHT[2]) * height;
    const footY = cy + (LIGHT[1] / LIGHT[2]) * height;
    gl.uniform4f(uniformAt(u, "uShadowBox"), footX - footprint, footY - footprint, footprint * 2, footprint * 2);
    gl.uniform2f(uniformAt(u, "uShadowSize"), SHADOW_SIZE, SHADOW_SIZE);
    gl.uniform1i(uniformAt(u, "uShadowMap"), 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (SHADOW > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.uniform1f(uniformAt(u, "uPass"), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, shadowMap);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniformAt(u, "uPass"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    calm =
      !pointer.grabbed &&
      !flying &&
      morph.t >= 1 &&
      !morph.pending &&
      presence >= 1 &&
      Math.hypot(body.vx, body.vy) < 120 &&
      Math.abs(stretch.speed) + Math.abs(tiltX.speed) + Math.abs(tiltY.speed) + Math.abs(scaleSpring.speed) < 0.05;
    if (busy && visible && pageVisible) raf = requestAnimationFrame(frame);
  }

  const wake = () => {
    if (raf || lost || disposed || !visible || !pageVisible) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    resizePending = true;
    wake();
  };

  const locate = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      inside:
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    };
  };

  const near = (x: number, y: number) => Math.hypot(x - body.x, y - body.y) < radius() * 1.1;

  const cancelTap = () => {
    clearTimeout(pendingTap);
    pendingTap = undefined;
  };

  const queueMorph = () => {
    if (pendingTap !== undefined) {
      cancelTap();
      return;
    }
    pendingTap = setTimeout(() => {
      pendingTap = undefined;
      const { cycle } = settings();
      if (cycle.length > 1) {
        const index = cycle.indexOf(morph.pending ?? morph.to);
        morph.pending = cycle[(index + 1) % cycle.length] ?? null;
      }
      calm = false;
      wake();
    }, DOUBLE_TAP_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    const spot = locate(event);
    pointer.x = spot.x;
    pointer.y = spot.y;
    pointer.inside = spot.inside;
    if (spot.inside || pointer.grabbed) calm = false;
    wake();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    const s = settings();
    const spot = locate(event);
    if (!spot.inside) return;
    pointer.x = spot.x;
    pointer.y = spot.y;
    pointer.inside = true;
    pointer.down = true;
    if (s.interaction === "drag" && near(spot.x, spot.y)) {
      pointer.grabbed = true;
      container.setAttribute("data-grabbing", "");
      flying = false;
      pointer.offsetX = spot.x - body.x;
      pointer.offsetY = spot.y - body.y;
    }
    pointer.startX = spot.x;
    pointer.startY = spot.y;
    calm = false;
    wake();
  };

  const onPointerUp = (event: PointerEvent) => {
    const s = settings();
    if (!pointer.down) return;
    pointer.down = false;
    const spot = locate(event);
    const moved = Math.hypot(spot.x - pointer.startX, spot.y - pointer.startY) > 6;
    const touched = near(spot.x, spot.y);
    if (pointer.grabbed) {
      pointer.grabbed = false;
      container.removeAttribute("data-grabbing");
      flying = Math.hypot(body.vx, body.vy) > 60;
      if (!flying) settle();
    }
    if (!moved && touched && spot.inside) {
      kick(3, s);
      queueMorph();
    }
    if (event.pointerType !== "mouse") pointer.inside = false;
    calm = false;
    wake();
  };

  const onLeave = () => {
    calm = false;
    pointer.inside = false;
    pointer.down = false;
    if (pointer.grabbed) {
      pointer.grabbed = false;
      container.removeAttribute("data-grabbing");
      settle();
    }
    wake();
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    parts.onLive(false);
  };

  const onVisibility = () => {
    pageVisible = document.visibilityState !== "hidden";
    wake();
  };

  const redrawText = () => {
    textState.key = "";
    drawText();
    calm = false;
    wake();
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onLeave, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", restart);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    wake();
  });
  intersection.observe(container);
  document.addEventListener("visibilitychange", onVisibility);
  const themeObserver = new MutationObserver(redrawText);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  void document.fonts?.ready.then(() => {
    if (!disposed) redrawText();
  });

  resize();
  request("content");
  request(`${first.shape}>${first.shape}`);
  wake();

  return {
    refresh() {
      calm = false;
      resize();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelTap();
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", restart);
      container.removeAttribute("data-grabbing");
      if (gl.isContextLost()) return;
      for (const entry of programs.values()) {
        gl.deleteProgram(entry.program);
        gl.deleteShader(entry.fragment);
      }
      gl.deleteShader(vertex);
      gl.deleteTexture(mediaTexture);
      gl.deleteTexture(textTexture);
      gl.deleteTexture(shadowMap);
      gl.deleteFramebuffer(shadowTarget);
      gl.deleteVertexArray(vao);
    },
  } satisfies GlassLens;
}

export function createGlassLens(parts: GlassLensParts, read: () => GlassLensSettings): GlassLens | null {
  let lens: GlassLens | null = null;
  const restart = () => {
    lens?.dispose();
    lens = runGlass(parts, read, false, restart);
    parts.onLive(lens !== null);
  };
  lens = runGlass(parts, read, true, restart);
  if (!lens) return null;
  return {
    refresh: () => lens?.refresh(),
    dispose: () => lens?.dispose(),
  };
}
