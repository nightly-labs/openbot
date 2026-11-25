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

export interface FluidGlassSettings {
  readonly scene: string;
  readonly home: GlassPoint;
  readonly area: GlassArea;
  readonly shape: GlassShape;
  readonly cycle: readonly GlassShape[];
  readonly size: number;
  readonly refraction: number;
  readonly dispersion: number;
  readonly color: string;
  readonly tint: number;
  readonly wobble: number;
  readonly interaction: GlassInteraction;
}

export interface FluidGlassParts {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly handle: HTMLElement | undefined;
  readonly paint: (context: CanvasRenderingContext2D, view: GlassView) => void;
}

export interface FluidGlass {
  refresh(): void;
  dispose(): void;
}

type Rgba = readonly [number, number, number, number];
type Quat = readonly [number, number, number, number];
type SpringKey = "stretch" | "tiltX" | "tiltY" | "scale";

interface ProgramEntry {
  readonly program: WebGLProgram;
  readonly fragment: WebGLShader;
  uniforms: Map<string, WebGLUniformLocation> | null;
  failed: boolean;
}

const PIXEL_BUDGET = 5e6;
const SHADOW_SIZE = 320;
const WALL_MARGIN = 1.1;
const WALL_BOUNCE = 0.35;
const MAX_RATIO = 2;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const REFLECTION = 1;
const SHADOW = 0.5;
const ELEVATION = 0.4;
const SMOOTHNESS = 0.5;
const SPIN_SPEED = 0.3;
const WHITE: Rgba = [1, 1, 1, 1];
const LIGHT_LENGTH = Math.hypot(-0.42, 0.55, 1);
const LIGHT = [-0.42 / LIGHT_LENGTH, 0.55 / LIGHT_LENGTH, 1 / LIGHT_LENGTH] as const;

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
  cube: [-0.48, 0.62, 0],
  pill: [0, 0, 0],
  torus: [-0.5, 0.18, 0],
  prism: [-0.3, 0.45, 0],
  diamond: [-0.35, 0.5, 0],
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
uniform sampler2D uText;
uniform float uTextOn;
out vec4 fragColor;

void main() {
  vec2 w = gl_FragCoord.xy / uRatio;
  vec2 uv = vec2(w.x, uView.y - w.y) / uView;
  vec4 color = vec4(0.0);
  if (uTextOn > 0.5) color = texture(uText, uv);
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

function fragmentFor(from: GlassShape, to: GlassShape, supersample: boolean): string {
  return `#version 300 es
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
uniform vec4 uTint;
uniform float uShadow;
uniform vec3 uLight;
uniform float uPresence;
uniform sampler2D uText;
uniform float uTextOn;
uniform float uPass;
uniform sampler2D uShadowMap;
uniform vec4 uShadowBox;
uniform vec2 uShadowSize;
out vec4 fragColor;

float shapeA(vec3 p) ${SDF[from]}
float shapeB(vec3 p) ${SDF[to]}

float field(vec3 p) {
  float d = shapeA(p);
  ${from !== to ? "d = mix(d, shapeB(p), uMorph);" : ""}
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
  if (uTextOn > 0.5) return textureGrad(uText, uv, dx, dy);
  return vec4(0.0);
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
    mirror = mirrorDir.z < -0.0005 ? content(landing(tr.p, mirrorDir, w), rx, ry) * uReflection : light(mirrorDir, uReflection);
    vec2 hitT = landing(tr.q, tr.exitDir, w);
    vec4 green = content(hitT, tx, ty);
    vec4 red = green;
    vec4 blue = green;
    if (tr.escaped > 0.5 && uDispersion > 0.0) {
      vec3 spread = vec3(-1.0, 0.0, 1.0) * uDispersion * 0.06;
      vec3 dirR = refract(tr.inside, -tr.exitNormal, uIor + spread.x);
      vec3 dirB = refract(tr.inside, -tr.exitNormal, uIor + spread.z);
      if (dot(dirR, dirR) > 0.0 && dirR.z < -0.2) red = content(landing(tr.q, dirR, hitT), tx, ty);
      if (dot(dirB, dirB) > 0.0 && dirB.z < -0.2) blue = content(landing(tr.q, dirB, hitT), tx, ty);
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
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexChannels(hex: string): Rgba {
  const full = hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex;
  const channel = (index: number) => Number.parseInt(full.slice(index, index + 2), 16) / 255;
  return [channel(0), channel(2), channel(4), 1];
}

function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)?.[1];
  if (hex) return hexChannels(hex);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/i.exec(text);
  if (!rgb) return null;
  const alphaText = rgb[4];
  const alpha =
    alphaText === undefined
      ? 1
      : alphaText.endsWith("%")
        ? Number.parseFloat(alphaText) / 100
        : Number.parseFloat(alphaText);
  const channel = (raw: string | undefined) => clamp(Number.parseFloat(raw ?? "0") / 255, 0, 1);
  return [channel(rgb[1]), channel(rgb[2]), channel(rgb[3]), clamp(alpha, 0, 1)];
}

function smoother(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function quaternion(x: number, y: number, z: number): Quat {
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
}

function multiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function blend(a: Quat, wa: number, b: Quat, wb: number): Quat {
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  const signed = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: Quat = signed < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  const dot = Math.abs(signed);
  if (dot > 0.9995) {
    const mixed = blend(a, 1 - t, target, t);
    const length = Math.hypot(...mixed);
    return blend(mixed, 1 / length, mixed, 0);
  }
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  return blend(a, Math.sin((1 - t) * theta) / sin, target, Math.sin(t * theta) / sin);
}

function driftAt(clock: number, size: number): readonly [number, number] {
  return [
    Math.sin(clock * 0.37) * size * 0.35 + Math.sin(clock * 0.71 + 1.3) * size * 0.12,
    Math.sin(clock * 0.29 + 0.8) * size * 0.2 + Math.cos(clock * 0.53) * size * 0.08,
  ];
}

function toMatrix([x, y, z, w]: Quat): Float32Array {
  return Float32Array.of(
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  );
}

function transposed(m: Float32Array): Float32Array {
  const at = (index: number) => m[index] ?? 0;
  return Float32Array.of(at(0), at(3), at(6), at(1), at(4), at(7), at(2), at(5), at(8));
}

function product(a: Float32Array, b: Float32Array, divisor: number): Float32Array {
  const result = new Float32Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (a[k * 3 + row] ?? 0) * (b[col * 3 + k] ?? 0);
      result[col * 3 + row] = sum / divisor;
    }
  }
  return result;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

function startEngine(
  parts: FluidGlassParts,
  read: () => FluidGlassSettings,
  intro: boolean,
  onRestored: () => void,
): FluidGlass | null {
  const { container, canvas, handle, paint } = parts;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  if (!vertex) return null;
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const programs = new Map<string, ProgramEntry | null>();
  const view = { width: 1, height: 1, ratio: 1 };

  const build = (key: string, source: string): ProgramEntry | null => {
    const existing = programs.get(key);
    if (existing !== undefined) return existing;
    const fragment = compile(gl, gl.FRAGMENT_SHADER, source);
    const program = gl.createProgram();
    if (!fragment || !program) {
      programs.set(key, null);
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    const entry: ProgramEntry = { program, fragment, uniforms: null, failed: false };
    programs.set(key, entry);
    return entry;
  };

  const requestMorph = (from: GlassShape, to: GlassShape) => {
    const supersample = view.ratio < 1.75;
    return build(`${from}>${to}>${supersample ? 1 : 0}`, fragmentFor(from, to, supersample));
  };
  const requestContent = () => build("content", CONTENT);

  const ready = (entry: ProgramEntry | null): entry is ProgramEntry => {
    if (!entry || entry.failed) return false;
    if (entry.uniforms) return true;
    if (parallel && !gl.getProgramParameter(entry.program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      entry.failed = true;
      return false;
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count: number = gl.getProgramParameter(entry.program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index++) {
      const info = gl.getActiveUniform(entry.program, index);
      const location = info ? gl.getUniformLocation(entry.program, info.name) : null;
      if (info && location) uniforms.set(info.name, location);
    }
    entry.uniforms = uniforms;
    return true;
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vao = gl.createVertexArray();
  const textTexture = makeTexture(gl);
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
  const body = { x: 0, y: 0, vx: 0, vy: 0, spin: 0, ripple: 0, dirX: 1, dirY: 0, anchorX: 0, anchorY: 0 };
  const spring: Record<SpringKey, number> = { stretch: 1, tiltX: 0, tiltY: 0, scale: 0 };
  const velocity: Record<SpringKey, number> = { stretch: 0, tiltX: 0, tiltY: 0, scale: 0 };
  const initialShape = read().shape;
  const morph: { from: GlassShape; to: GlassShape; t: number; pending: GlassShape | null } = {
    from: initialShape,
    to: initialShape,
    t: 1,
    pending: null,
  };
  let requested = initialShape;
  let presence = intro && !reduced ? 0 : 1;
  if (presence === 1) spring.scale = 1;
  let placed = false;
  let flying = false;
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
  let resizePending = false;
  let current: ProgramEntry | null = null;

  const radius = () => Math.min(read().size / 2, Math.min(view.width, view.height) * 0.36);

  const span = (low: number, high: number, edge: number) => {
    const min = low + edge;
    const max = high - edge;
    return max >= min ? { min, max } : { min: (low + high) / 2, max: (low + high) / 2 };
  };

  const walls = (area: GlassArea, size: number) => {
    const edge = size * WALL_MARGIN;
    const x = span(Math.max(0, area.left), Math.min(view.width, area.right), edge);
    const y = span(Math.max(0, area.top), Math.min(view.height, area.bottom), edge);
    return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
  };

  const drawScene = () => {
    const width = canvas.width;
    const height = canvas.height;
    const key = [read().scene, width, height].join("|");
    if (key === textState.key) return;
    textState.key = key;
    textCanvas.width = width;
    textCanvas.height = height;
    const ctx = textCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    paint(ctx, { width: view.width, height: view.height });
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    textState.ready = true;
  };

  const applyResize = () => {
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
    drawScene();
    const s = read();
    if (!placed) {
      body.x = s.home.x;
      body.y = s.home.y;
      body.anchorX = body.x;
      body.anchorY = body.y;
      placed = true;
    } else if (s.interaction === "drag") {
      const wall = walls(s.area, radius());
      body.anchorX = clamp(body.anchorX, wall.minX, wall.maxX);
      body.anchorY = clamp(body.anchorY, wall.minY, wall.maxY);
    }
  };

  const bindContent = (entry: ProgramEntry) => {
    const u = (name: string) => entry.uniforms?.get(name) ?? null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.uniform1i(u("uText"), 0);
    gl.uniform2f(u("uView"), view.width, view.height);
    gl.uniform1f(u("uRatio"), view.ratio);
    gl.uniform1f(u("uTextOn"), textState.ready ? 1 : 0);
    return u;
  };

  const settle = () => {
    const size = radius();
    const drift = reduced ? ([0, 0] as const) : driftAt(idleClock, size);
    const wall = walls(read().area, size);
    body.anchorX = clamp(body.x, wall.minX, wall.maxX) - drift[0];
    body.anchorY = clamp(body.y, wall.minY, wall.maxY) - drift[1];
  };

  const step = (key: SpringKey, target: number, omega: number, zeta: number, dt: number) => {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let index = 0; index < steps; index++) {
      velocity[key] += (omega * omega * (target - spring[key]) - 2 * zeta * omega * velocity[key]) * h;
      spring[key] += velocity[key] * h;
    }
    const settled = Math.abs(target - spring[key]) < 0.0005 && Math.abs(velocity[key]) < 0.002;
    if (settled) {
      spring[key] = target;
      velocity[key] = 0;
    }
    return !settled;
  };

  const schedule = () => {
    if (visible && pageVisible) raf = requestAnimationFrame(frame);
  };

  const advanceMorph = (s: FluidGlassSettings, dt: number) => {
    let busy = false;
    if (s.shape !== requested) {
      requested = s.shape;
      morph.pending = s.shape;
    }
    if (morph.pending && morph.t >= 1) {
      if (ready(requestMorph(morph.to, morph.pending))) {
        requestMorph(morph.pending, morph.pending);
        morph.from = morph.to;
        morph.to = morph.pending;
        morph.pending = null;
        morph.t = 0;
        velocity.stretch -= 2.5 * s.wobble;
      }
      busy = true;
    }
    if (morph.t < 1) {
      morph.t = Math.min(1, morph.t + dt / (reduced ? 0.35 : 0.85));
      busy = true;
    }
    if (s.cycle.length > 1 && !morph.pending) {
      const index = s.cycle.indexOf(morph.to);
      const next = s.cycle[(index + 1) % s.cycle.length];
      if (next) requestMorph(morph.to, next);
    }
    return busy;
  };

  const advanceBody = (s: FluidGlassSettings, dt: number, size: number) => {
    let busy = false;
    if (!pointer.grabbed && s.interaction !== "drag") {
      body.anchorX = s.home.x;
      body.anchorY = s.home.y;
    }
    if (!reduced && !pointer.grabbed) {
      idleClock += dt;
      busy = true;
    }
    const drift = reduced ? ([0, 0] as const) : driftAt(idleClock, size);
    let goalX = body.anchorX + drift[0];
    let goalY = body.anchorY + drift[1];
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
    const wall = walls(s.area, size);
    goalX = clamp(goalX, wall.minX, wall.maxX);
    goalY = clamp(goalY, wall.minY, wall.maxY);
    const hitWalls = (bounce: number) => {
      if (body.x < wall.minX || body.x > wall.maxX) {
        body.x = clamp(body.x, wall.minX, wall.maxX);
        velocity.stretch -= Math.min(4, Math.abs(body.vx) * 0.0016) * s.wobble;
        body.vx *= -bounce;
      }
      if (body.y < wall.minY || body.y > wall.maxY) {
        body.y = clamp(body.y, wall.minY, wall.maxY);
        velocity.stretch -= Math.min(4, Math.abs(body.vy) * 0.0016) * s.wobble;
        body.vy *= -bounce;
      }
    };
    if (flying) {
      for (let index = 0; index < substeps; index++) {
        body.x += body.vx * h;
        body.y += body.vy * h;
        const friction = Math.exp(-h * 1.4);
        body.vx *= friction;
        body.vy *= friction;
        hitWalls(0.62);
      }
      if (Math.hypot(body.vx, body.vy) < 30) {
        flying = false;
        settle();
      }
      return true;
    }
    for (let index = 0; index < substeps; index++) {
      body.vx += (omega * omega * (goalX - body.x) - 2 * 0.86 * omega * body.vx) * h;
      body.vy += (omega * omega * (goalY - body.y) - 2 * 0.86 * omega * body.vy) * h;
      body.x += body.vx * h;
      body.y += body.vy * h;
      hitWalls(WALL_BOUNCE);
    }
    if (Math.abs(goalX - body.x) + Math.abs(goalY - body.y) > 0.05 || Math.hypot(body.vx, body.vy) > 0.5) busy = true;
    return busy;
  };

  const drawFallback = () => {
    const fallback = requestContent();
    if (!ready(fallback)) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(fallback.program);
    gl.bindVertexArray(vao);
    bindContent(fallback);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const orientationMatrix = (eased: number) => {
    const tumble = SPIN[morph.from][0] + (SPIN[morph.to][0] - SPIN[morph.from][0]) * eased;
    const sway = SPIN[morph.from][1] + (SPIN[morph.to][1] - SPIN[morph.from][1]) * eased;
    const angle = body.spin % (Math.PI * 2);
    const identity: Quat = [0, 0, 0, 1];
    const turnY = slerp(identity, quaternion(0, angle, 0), tumble);
    const turnZ = slerp(identity, quaternion(0, 0, angle), sway);
    let orientation = slerp(quaternion(...BASE[morph.from]), quaternion(...BASE[morph.to]), eased);
    orientation = multiply(multiply(quaternion(Math.sin(body.spin * 0.6) * 0.18 * tumble, 0, 0), turnY), orientation);
    orientation = multiply(turnZ, orientation);
    orientation = multiply(quaternion(spring.tiltX, spring.tiltY, 0), orientation);
    return toMatrix(orientation);
  };

  const stretchMatrix = (sx: number, q: number) => {
    const ux = body.dirX;
    const uy = -body.dirY;
    const cross = (1 / sx - 1 / q) * ux * uy;
    return Float32Array.of(
      1 / q + (1 / sx - 1 / q) * ux * ux,
      cross,
      0,
      cross,
      1 / q + (1 / sx - 1 / q) * uy * uy,
      0,
      0,
      0,
      1 / q,
    );
  };

  const render = (entry: ProgramEntry, s: FluidGlassSettings, size: number) => {
    const eased = smoother(morph.t);
    const extent = EXTENT[morph.from] + (EXTENT[morph.to] - EXTENT[morph.from]) * eased;
    const unit = size / extent;
    const scale = Math.max(0.001, spring.scale);
    const sx = Math.max(0.2, spring.stretch);
    const q = 1 / Math.sqrt(sx);
    const combined = product(transposed(orientationMatrix(eased)), stretchMatrix(sx, q), unit * scale);
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

    const color = parseColor(s.color) ?? WHITE;
    const ior = 1 + 0.5 * clamp(s.refraction, 0, 2);
    gl.useProgram(entry.program);
    gl.bindVertexArray(vao);
    const u = bindContent(entry);
    gl.uniform1f(u("uFocal"), focal);
    gl.uniform3f(u("uCenter"), cx, cy, height);
    gl.uniformMatrix3fv(u("uInverse"), false, combined);
    gl.uniform1f(u("uScale"), unit * scale * minScale);
    const bound = size * scale * maxScale * 1.08 + 2;
    gl.uniform1f(u("uBound"), bound);
    gl.uniform1f(u("uMorph"), eased);
    gl.uniform1f(u("uRipple"), body.ripple);
    gl.uniform1f(u("uTime"), reduced ? 0 : time);
    gl.uniform1f(u("uIor"), ior);
    gl.uniform1f(u("uDispersion"), clamp(s.dispersion, 0, 1));
    gl.uniform1f(u("uReflection"), REFLECTION);
    gl.uniform4f(u("uTint"), color[0], color[1], color[2], clamp(s.tint, 0, 1) * 1.6);
    gl.uniform1f(u("uShadow"), SHADOW);
    gl.uniform3f(u("uLight"), LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(u("uPresence"), presence);
    const footprint = bound * 1.6 * (SHADOW_SIZE / (SHADOW_SIZE - 6)) + 1;
    const footX = cx + (LIGHT[0] / LIGHT[2]) * height;
    const footY = cy + (LIGHT[1] / LIGHT[2]) * height;
    gl.uniform4f(u("uShadowBox"), footX - footprint, footY - footprint, footprint * 2, footprint * 2);
    gl.uniform2f(u("uShadowSize"), SHADOW_SIZE, SHADOW_SIZE);
    gl.uniform1i(u("uShadowMap"), 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.uniform1f(u("uPass"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, shadowMap);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u("uPass"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
      schedule();
      return;
    }
    skipped = 0;
    const s = read();
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
    last = Math.max(last, now);
    time += dt;
    let busy = advanceMorph(s, dt);
    const size = radius();
    busy = advanceBody(s, dt, size) || busy;

    const speed = Math.hypot(body.vx, body.vy);
    if (speed > 1) {
      body.dirX = body.vx / speed;
      body.dirY = body.vy / speed;
    }
    const wobble = clamp(s.wobble, 0, 1);
    const stretchTarget = 1 + clamp(speed / 1800, 0, 0.55) * wobble * (reduced ? 0 : 1);
    busy = step("stretch", stretchTarget, 13, 0.32, dt) || busy;
    const tiltGain = reduced ? 0 : 0.00045;
    busy = step("tiltX", clamp(body.vy * tiltGain, -0.7, 0.7), 9, 0.5, dt) || busy;
    busy = step("tiltY", clamp(body.vx * tiltGain, -0.7, 0.7), 9, 0.5, dt) || busy;
    if (!reduced && (morph.to === "blob" || (morph.from === "blob" && morph.t < 1))) busy = true;
    if (!reduced) {
      body.spin += dt * SPIN_SPEED;
      busy = true;
    }
    const entry = requestMorph(morph.t < 1 ? morph.from : morph.to, morph.to);
    if (ready(entry)) current = entry;
    else busy = true;
    if (current) {
      if (presence < 1) {
        presence = Math.min(1, presence + dt / 0.5);
        busy = true;
      }
      busy = step("scale", 1, 11, 0.52, dt) || busy;
    }
    body.ripple +=
      ((morph.t < 1 ? 0.05 * wobble * Math.sin(Math.PI * morph.t) : 0) - body.ripple) * (1 - Math.exp(-dt / 0.08));

    if (!current) {
      drawFallback();
      schedule();
      return;
    }
    render(current, s, size);
    calm =
      !pointer.grabbed &&
      !flying &&
      morph.t >= 1 &&
      !morph.pending &&
      presence >= 1 &&
      Math.hypot(body.vx, body.vy) < 120 &&
      Math.abs(velocity.stretch) + Math.abs(velocity.tiltX) + Math.abs(velocity.tiltY) + Math.abs(velocity.scale) <
        0.05;
    if (busy) schedule();
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

  const isNear = (x: number, y: number) => Math.hypot(x - body.x, y - body.y) < radius() * 1.1;

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
    const spot = locate(event);
    if (!spot.inside) return;
    pointer.x = spot.x;
    pointer.y = spot.y;
    pointer.inside = true;
    pointer.down = true;
    if (read().interaction === "drag" && isNear(spot.x, spot.y)) {
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
    if (!pointer.down) return;
    const s = read();
    pointer.down = false;
    const spot = locate(event);
    const moved = Math.hypot(spot.x - pointer.startX, spot.y - pointer.startY) > 6;
    const near = isNear(spot.x, spot.y);
    if (pointer.grabbed) {
      pointer.grabbed = false;
      container.removeAttribute("data-grabbing");
      flying = Math.hypot(body.vx, body.vy) > 60;
      if (!flying) settle();
    }
    if (!moved && near && spot.inside) {
      velocity.stretch -= 3 * clamp(s.wobble, 0, 1);
      if (s.cycle.length > 1) {
        const index = s.cycle.indexOf(morph.pending ?? morph.to);
        morph.pending = s.cycle[(index + 1) % s.cycle.length] ?? null;
      }
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
  };

  const resizeObserver = new ResizeObserver(resize);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    wake();
  });
  const onVisibility = () => {
    pageVisible = document.visibilityState !== "hidden";
    wake();
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onLeave, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  resizeObserver.observe(container);
  intersection.observe(container);
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    textState.key = "";
    drawScene();
    wake();
  });

  resize();
  requestContent();
  requestMorph(initialShape, initialShape);

  return {
    refresh() {
      calm = false;
      resize();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      container.removeAttribute("data-grabbing");
      if (gl.isContextLost()) return;
      for (const entry of programs.values()) {
        if (!entry) continue;
        gl.deleteProgram(entry.program);
        gl.deleteShader(entry.fragment);
      }
      gl.deleteShader(vertex);
      gl.deleteTexture(textTexture);
      gl.deleteTexture(shadowMap);
      gl.deleteFramebuffer(shadowTarget);
      gl.deleteVertexArray(vao);
    },
  };
}

export function createFluidGlass(parts: FluidGlassParts, read: () => FluidGlassSettings): FluidGlass | null {
  let engine: FluidGlass | null = null;
  const restart = () => {
    engine?.dispose();
    engine = startEngine(parts, read, false, restart);
  };
  engine = startEngine(parts, read, true, restart);
  if (!engine) return null;
  return {
    refresh: () => engine?.refresh(),
    dispose: () => engine?.dispose(),
  };
}
