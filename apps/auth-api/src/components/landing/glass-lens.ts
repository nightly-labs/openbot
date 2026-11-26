export type GlassShape = "lens" | "blob" | "pill" | "torus" | "prism" | "diamond";
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
type Rotation = readonly [number, number, number, number];

interface Morph {
  from: GlassShape;
  to: GlassShape;
  t: number;
  next: GlassShape | null;
  asked: GlassShape;
}

interface Spring {
  value: number;
  speed: number;
}

const SHAPE_ID: Record<GlassShape, number> = { lens: 0, blob: 1, pill: 2, torus: 3, prism: 4, diamond: 5 };
const SPIN: Record<GlassShape, { tumble: number; sway: number }> = {
  lens: { tumble: 0, sway: 0 },
  blob: { tumble: 1, sway: 0 },
  pill: { tumble: 0, sway: 0 },
  torus: { tumble: 0, sway: 1 },
  prism: { tumble: 1, sway: 0 },
  diamond: { tumble: 1, sway: 0 },
};
const POSE: Record<GlassShape, readonly [number, number, number]> = {
  lens: [0, 0, 0],
  blob: [0.2, 0, 0],
  pill: [0, 0, 0],
  torus: [-0.5, 0.18, 0],
  prism: [-0.3, 0.45, 0],
  diamond: [-0.35, 0.5, 0],
};
const SPIN_RATE = 0.3;
const SMOOTHING = Math.sqrt(0.18);
const FOLLOW_DAMPING = 0.86;
const TILT_GAIN = 0.00045;
const TILT_LIMIT = 0.7;
const TURN = Math.PI * 2;
const PIXEL_BUDGET = 5e6;
const MAX_RATIO = 2;
const MAX_ANISOTROPY = 16;
const STEP = 1 / 240;
const WALL_ROOM = 1.1;
const SOFT_BOUNCE = 0.35;
const HARD_BOUNCE = 0.62;
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 400;
const THROW_SPEED = 60;
const REST_SPEED = 30;
const MORPH_SECONDS = 0.85;
const FADE_SECONDS = 0.5;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const EXTENT: Record<GlassShape, number> = { lens: 1.03, blob: 1.08, pill: 1.02, torus: 1, prism: 1.18, diamond: 1.05 };
const FLOOR = 0.75;
const FOCAL = 1.6;
const DISPERSION = 0.014;
const UNIFORMS = [
  "uScene",
  "uSceneOn",
  "uView",
  "uRatio",
  "uCamera",
  "uCenter",
  "uUnit",
  "uReach",
  "uLod",
  "uShapes",
  "uMorph",
  "uAxis",
  "uStretch",
  "uTurn",
  "uTime",
  "uRipple",
  "uPresence",
  "uIor",
  "uSpread",
  "uColor",
  "uTint",
] as const;

type UniformName = (typeof UNIFORMS)[number];

const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uSceneOn;
uniform vec2 uView;
uniform float uRatio;
uniform vec3 uCamera;
uniform vec3 uCenter;
uniform float uUnit;
uniform float uReach;
uniform float uLod;
uniform ivec2 uShapes;
uniform float uMorph;
uniform vec2 uAxis;
uniform float uStretch;
uniform mat3 uTurn;
uniform float uTime;
uniform float uRipple;
uniform float uPresence;
uniform float uIor;
uniform float uSpread;
uniform vec3 uColor;
uniform float uTint;
out vec4 outColor;

const float FLOOR = ${FLOOR.toFixed(2)};
const float MAX_FOOTPRINT = 4.0;
const vec2 GLINT = vec2(-0.6, 0.8);
const vec2 JITTER[3] = vec2[3](vec2(0.3, 0.2), vec2(-0.2, 0.3), vec2(0.1, -0.35));

struct Hit {
  float kind;
  float cover;
  vec3 p;
  vec3 n;
  vec3 q;
  vec3 dir;
  vec3 entered;
  vec3 inner;
  vec3 exitNormal;
  float travel;
  float clarity;
};

vec4 sceneGrad(vec2 point, vec2 gx, vec2 gy) {
  vec2 uv = point / uView;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return textureGrad(uScene, uv, gx / uView, gy / uView) * uSceneOn;
}

vec3 toLocal(vec3 world) {
  vec3 d = (world - uCenter) / uUnit;
  return vec3(d.x, -d.y, d.z);
}

vec2 toWorld(vec2 local) {
  return uCenter.xy + vec2(local.x, -local.y) * uUnit;
}

vec2 landing(vec3 origin, vec3 dir, vec2 fallback) {
  if (dir.z > -0.0005) return fallback;
  return toWorld(origin.xy + dir.xy * ((-FLOOR - origin.z) / dir.z));
}

float smax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

float lensBody(vec3 p) {
  return smax(length(p - vec3(0.0, 0.0, -1.87)) - 2.15, length(p - vec3(0.0, 0.0, 1.87)) - 2.15, 0.18);
}

float blobBody(vec3 p) {
  float t = uTime;
  float wave = sin(1.6 * p.x + t * 1.1) * sin(1.8 * p.y - t * 0.9) * sin(1.5 * p.z + t * 0.8);
  float ripple = sin(2.6 * p.x - t * 0.6 + p.z) * sin(3.0 * p.y + t * 1.2 + 0.8 * p.x);
  return (length(p) - 0.92 - 0.085 * wave - 0.04 * ripple) * 0.78;
}

float pillBody(vec3 p) {
  float outline = length(vec2(max(abs(p.x) - 0.56, 0.0), p.y)) - 0.44;
  vec2 w = vec2(outline + 0.17, abs(p.z) - 0.15);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.17;
}

float torusBody(vec3 p) {
  return length(vec2(length(p.xy) - 0.68, p.z)) - 0.3;
}

float prismBody(vec3 p) {
  vec3 q = abs(p);
  float side = max(q.x * 0.866025 + p.y * 0.5, -p.y) - 0.52;
  return max(q.z - 0.34, side) - 0.07;
}

float diamondBody(vec3 p) {
  vec3 q = abs(p);
  return (q.x + q.y * 0.9 + q.z * 1.22 - 0.98) * 0.5;
}

float body(int id, vec3 p) {
  if (id == 1) return blobBody(p);
  if (id == 2) return pillBody(p);
  if (id == 3) return torusBody(p);
  if (id == 4) return prismBody(p);
  if (id == 5) return diamondBody(p);
  return lensBody(p);
}

float map(vec3 p) {
  float along = dot(p.xy, uAxis);
  vec2 across = p.xy - uAxis * along;
  p.xy = uAxis * (along / uStretch) + across * sqrt(uStretch);
  p.z *= sqrt(uStretch);
  vec3 o = uTurn * p;
  float d = body(uShapes.x, o);
  if (uMorph > 0.0) d = mix(d, body(uShapes.y, o), uMorph);
  if (uRipple > 0.0) {
    d += uRipple * sin(o.x * 3.2 + uTime * 2.2) * sin(o.y * 3.3 - uTime * 2.0) * sin(o.z * 3.0 + uTime * 1.7);
  }
  return d / max(1.0 / uStretch, sqrt(uStretch));
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0025;
  return normalize(
    k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h)
  );
}

float softbox(vec2 at, vec2 size, float corner, float blur) {
  vec2 q = abs(at) - size + corner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  return 1.0 - smoothstep(-blur, blur, d);
}

vec4 studio(vec3 d, float gain) {
  float yaw = atan(d.x, d.z);
  float key = softbox(vec2(yaw + 0.62, d.y - 0.5), vec2(0.24, 0.14), 0.12, 0.16);
  float strip = softbox(vec2(yaw - 0.95, d.y - 0.05), vec2(0.05, 0.5), 0.05, 0.06);
  float level = (key * 4.0 + strip * 3.0 + smoothstep(0.0, 1.0, d.z) * 0.04) * gain;
  float cover = clamp(level, 0.0, 1.0);
  return vec4(vec3(cover), cover);
}

Hit trace(vec3 ro, vec3 rd, float eps) {
  Hit hit = Hit(0.0, 0.0, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), vec3(0.0, 0.0, -1.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 1.0);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uReach * uReach;
  float disc = b * b - c;
  if (disc <= 0.0) return hit;
  float root = sqrt(disc);
  float t = max(-b - root, 0.0);
  float end = -b + root;
  float best = 1e5;
  float bestT = t;
  bool found = false;
  for (int i = 0; i < 88; i++) {
    float d = map(ro + rd * t);
    if (d < best) {
      best = d;
      bestT = t;
    }
    if (d < eps) {
      found = true;
      break;
    }
    t += d * 0.9;
    if (t > end) break;
  }
  if (!found && best < eps * 1.4) {
    found = true;
    t = bestT;
  }
  if (!found) {
    hit.cover = clamp(1.0 - best / (eps * 4.8), 0.0, 1.0);
    if (hit.cover > 0.0) {
      hit.kind = 1.0;
      hit.p = ro + rd * bestT;
      hit.n = normalAt(hit.p);
    }
    return hit;
  }
  hit.kind = 2.0;
  hit.p = ro + rd * t;
  hit.n = normalAt(hit.p);
  hit.q = hit.p;
  return hit;
}

vec3 downward(vec3 dir) {
  if (dir.z > -0.2) return normalize(vec3(dir.xy, -0.2 - abs(dir.z)));
  return dir;
}

void crossGlass(inout Hit hit, vec3 rd, float eps) {
  vec3 dir = refract(rd, hit.n, 1.0 / uIor);
  hit.entered = dir;
  vec3 q = hit.p + dir * eps * 4.0;
  bool escaped = false;
  vec3 leaving = dir;
  for (int turn = 0; turn < 3; turn++) {
    for (int i = 0; i < 56; i++) {
      float d = map(q);
      if (d > -eps) break;
      float stride = max(-d * 0.9, eps);
      q += dir * stride;
      hit.travel += stride;
    }
    vec3 n = normalAt(q);
    vec3 outward = refract(dir, -n, uIor);
    if (dot(outward, outward) > 0.0) {
      hit.clarity = dot(outward, n);
      hit.inner = dir;
      hit.exitNormal = n;
      leaving = outward;
      escaped = true;
      break;
    }
    dir = reflect(dir, -n);
    q += dir * eps * 4.0;
  }
  if (!escaped) leaving = dir;
  hit.q = q;
  hit.dir = downward(leaving);
}

float entryBand(float cosi) {
  return smoothstep(0.42, 0.12, cosi);
}

vec2 channelLanding(Hit hit, vec3 rd, float ior, vec2 point) {
  vec3 entered = refract(rd, hit.n, 1.0 / ior);
  vec3 bent = entered - hit.entered;
  vec3 inside = normalize(hit.inner + bent);
  vec3 leaving = refract(inside, -hit.exitNormal, ior);
  if (dot(leaving, leaving) == 0.0) leaving = hit.dir;
  return landing(hit.q + bent * hit.travel, downward(leaving), point);
}

vec4 seenThrough(Hit hit, vec3 rd, vec2 point, vec2 tx, vec2 ty) {
  vec4 green = sceneGrad(landing(hit.q, hit.dir, point), tx, ty);
  if (uSpread <= 0.0 || dot(hit.exitNormal, hit.exitNormal) < 0.5) return green;
  vec4 red = sceneGrad(channelLanding(hit, rd, uIor - uSpread, point), tx, ty);
  vec4 blue = sceneGrad(channelLanding(hit, rd, uIor + uSpread, point), tx, ty);
  return vec4(red.r, green.g, blue.b, max(max(red.a, green.a), blue.a));
}

vec4 mirrorOf(vec3 p, vec3 dir, vec2 point, vec2 rx, vec2 ry, float gain) {
  vec4 sky = studio(dir, gain);
  float onPage = smoothstep(0.0, 0.12, -dir.z);
  if (onPage <= 0.0) return sky;
  return mix(sky, sceneGrad(landing(p, dir, point), rx, ry) * gain, onPage);
}

vec4 shade(Hit hit, vec3 rd, vec4 back, vec4 tone, vec2 point, vec2 tx, vec2 ty, vec2 rx, vec2 ry) {
  if (hit.kind < 0.5) return back;
  vec3 mirrorDir = reflect(rd, hit.n);
  if (hit.kind < 1.5) {
    vec4 edge = tone * 0.8 + studio(mirrorDir, 1.0) * 0.5;
    return mix(back, edge + back * (1.0 - edge.a), hit.cover * 0.7);
  }
  float cosi = clamp(-dot(rd, hit.n), 0.0, 1.0);
  float f0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
  float band = max(entryBand(cosi), smoothstep(0.4, 0.05, hit.clarity));
  vec4 mirror = tone;
  vec4 through = tone;
  if (band < 1.0) {
    mirror = mirrorOf(hit.p, mirrorDir, point, rx, ry, 1.0);
    through = mix(seenThrough(hit, rd, point, tx, ty), tone, band);
    mirror = mix(mirror, tone, band);
  }
  vec3 absorb = pow(max(uColor, vec3(0.001)), vec3(uTint * 1.6 * hit.travel));
  through.rgb *= absorb;
  float cloud = (1.0 - dot(absorb, vec3(0.3333))) * 0.7;
  through += vec4(uColor * cloud, cloud) * (1.0 - through.a);
  vec4 reflected = mix(studio(mirrorDir, fresnel), mirror * fresnel, smoothstep(0.0, 0.12, -mirrorDir.z));
  vec4 glass = reflected + through * (1.0 - reflected.a);
  float grazing = 1.0 - smoothstep(0.04, 0.3, cosi);
  glass = mix(glass, mirror + back * (1.0 - mirror.a), grazing);
  float rim = pow(1.0 - cosi, 3.0) * (0.25 + 0.75 * abs(dot(normalize(hit.n.xy + 1e-5), GLINT))) * 0.55;
  rim *= smoothstep(0.0, 0.08, cosi);
  return vec4(rim) + glass * (1.0 - rim);
}

vec2 footprint(vec2 delta) {
  return delta * min(1.0, MAX_FOOTPRINT / max(length(delta), 1e-4));
}

void main() {
  vec2 frag = gl_FragCoord.xy / uRatio;
  vec2 point = vec2(frag.x, uView.y - frag.y);
  vec4 back = sceneGrad(point, vec2(0.0), vec2(0.0));
  if (uUnit < 0.5) {
    outColor = back;
    return;
  }
  vec3 ro = toLocal(uCamera);
  vec3 rd = normalize(toLocal(vec3(point, 0.0)) - ro);
  float eps = 0.25 / (uRatio * uUnit);
  Hit hit = trace(ro, rd, eps);
  if (hit.kind > 1.5) crossGlass(hit, rd, eps);
  vec2 hitT = hit.kind > 1.5 ? landing(hit.q, hit.dir, point) : point;
  vec2 hitR = hit.kind > 0.5 ? landing(hit.p, reflect(rd, hit.n), point) : point;
  vec2 tx = footprint(dFdx(hitT));
  vec2 ty = footprint(dFdy(hitT));
  vec2 rx = footprint(dFdx(hitR));
  vec2 ry = footprint(dFdy(hitR));
  vec4 tone = hit.kind > 0.5 ? textureLod(uScene, uCenter.xy / uView, uLod) * uSceneOn : vec4(0.0);
  vec4 color = shade(hit, rd, back, tone, point, tx, ty, rx, ry);
  float edgy = hit.kind > 1.5 ? 1.0 - smoothstep(0.3, 0.55, clamp(-dot(rd, hit.n), 0.0, 1.0)) : hit.kind;
  if (edgy > 0.0) {
    for (int k = 0; k < 3; k++) {
      vec2 sub = point + JITTER[k] / uRatio;
      vec3 subDir = normalize(toLocal(vec3(sub, 0.0)) - ro);
      Hit extra = trace(ro, subDir, eps);
      bool clear = entryBand(clamp(-dot(subDir, extra.n), 0.0, 1.0)) < 1.0;
      if (extra.kind > 1.5 && (uTint > 0.0 || clear)) crossGlass(extra, subDir, eps);
      color += shade(extra, subDir, back, tone, sub, tx, ty, rx, ry);
    }
    color *= 0.25;
  }
  outColor = mix(back, color, uPresence);
}`;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const IDENTITY: Rotation = [0, 0, 0, 1];

const around = (x: number, y: number, z: number, angle: number): Rotation => {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};

const compose = (a: Rotation, b: Rotation): Rotation => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const fromAngles = ([x, y, z]: readonly [number, number, number]) =>
  compose(compose(around(0, 0, 1, z), around(0, 1, 0, y)), around(1, 0, 0, x));

const blend = (a: Rotation, b: Rotation, t: number): Rotation => {
  const cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = cosine < 0 ? -1 : 1;
  const near = Math.abs(cosine);
  let wa = 1 - t;
  let wb = t * sign;
  if (near < 0.9995) {
    const theta = Math.acos(near);
    const sine = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sine;
    wb = (Math.sin(t * theta) / sine) * sign;
  }
  const mixed: Rotation = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
  const length = Math.hypot(...mixed) || 1;
  return [mixed[0] / length, mixed[1] / length, mixed[2] / length, mixed[3] / length];
};

const inverseMatrix = ([x, y, z, w]: Rotation) =>
  new Float32Array([
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ]);

const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const pull = (spring: Spring, target: number, omega: number, ratio: number, dt: number) => {
  for (let left = dt; left > 0; left -= STEP) {
    const h = Math.min(STEP, left);
    spring.speed += (omega * omega * (target - spring.value) - 2 * ratio * omega * spring.speed) * h;
    spring.value += spring.speed * h;
  }
  const resting = Math.abs(target - spring.value) < 5e-4 && Math.abs(spring.speed) < 2e-3;
  if (resting) {
    spring.value = target;
    spring.speed = 0;
  }
  return !resting;
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

const makeTexture = (gl: WebGL2RenderingContext, minify: number) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minify);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

const shader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const unit = gl.createShader(type);
  if (!unit) return null;
  gl.shaderSource(unit, source);
  gl.compileShader(unit);
  return unit;
};

const startProgram = (gl: WebGL2RenderingContext) => {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
};

function runLens(parts: GlassLensParts, read: () => GlassLensSettings, intro: boolean, restart: () => void) {
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
  const program = startProgram(gl);
  if (!program) return null;
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const uniform = new Map<UniformName, WebGLUniformLocation | null>();
  let linked = false;
  const at = (name: UniformName) => uniform.get(name) ?? null;
  const vao = gl.createVertexArray();
  const texture = makeTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
  const anisotropic = gl.getExtension("EXT_texture_filter_anisotropic");
  if (anisotropic) {
    const most: number = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(MAX_ANISOTROPY, most));
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sceneCanvas = document.createElement("canvas");
  const view = { width: 1, height: 1, ratio: 1 };
  const first = read();
  const lens = { x: first.home.x, y: first.home.y, vx: 0, vy: 0, restX: first.home.x, restY: first.home.y };
  const axis = { x: 1, y: 0 };
  const pointer = { x: 0, y: 0, inside: false, down: false, grabbed: false, grabX: 0, grabY: 0, startX: 0, startY: 0 };
  const fading = intro && !reduced;
  const jelly: Spring = { value: 1, speed: 0 };
  const tiltX: Spring = { value: 0, speed: 0 };
  const tiltY: Spring = { value: 0, speed: 0 };
  const grow: Spring = { value: fading ? 0 : 1, speed: 0 };
  const morph: Morph = { from: first.shape, to: first.shape, t: 1, next: null, asked: first.shape };
  let presence = fading ? 0 : 1;
  let ripple = 0;
  let spin = 0;
  let idleClock = 0;
  let sceneKey = "";
  let sceneReady = false;
  let placed = false;
  let flying = false;
  let pendingTap: ReturnType<typeof setTimeout> | undefined;
  let clock = Math.random() * 30;
  let frameId = 0;
  let last = 0;
  let stopped = false;
  let sized = false;
  let visible = true;
  let pageVisible = document.visibilityState !== "hidden";

  const radius = () => Math.min(read().size / 2, Math.min(view.width, view.height) * 0.36);

  const bounds = (area: GlassArea) => {
    const room = radius() * WALL_ROOM;
    const x = range(Math.max(0, area.left), Math.min(view.width, area.right), room);
    const y = range(Math.max(0, area.top), Math.min(view.height, area.bottom), room);
    return { left: x.min, right: x.max, top: y.min, bottom: y.max };
  };

  const drift = (size: number) => {
    if (reduced) return { x: 0, y: 0 };
    return {
      x: (Math.sin(idleClock * 0.37) * 0.35 + Math.sin(idleClock * 0.71 + 1.3) * 0.12) * size,
      y: (Math.sin(idleClock * 0.29 + 0.8) * 0.2 + Math.cos(idleClock * 0.53) * 0.08) * size,
    };
  };

  const kick = (amount: number) => {
    if (!reduced) jelly.speed -= amount * clamp(read().wobble, 0, 1);
  };

  const paintScene = () => {
    const key = [read().scene, canvas.width, canvas.height].join("|");
    if (key === sceneKey) return;
    sceneKey = key;
    sceneCanvas.width = canvas.width;
    sceneCanvas.height = canvas.height;
    const pen = sceneCanvas.getContext("2d");
    if (!pen) return;
    pen.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    pen.clearRect(0, 0, view.width, view.height);
    paint(pen, { width: view.width, height: view.height });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    sceneReady = true;
  };

  const measure = () => {
    sized = true;
    const box = container.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO, Math.sqrt(PIXEL_BUDGET / (width * height)));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    view.width = width;
    view.height = height;
    view.ratio = pixelWidth / width;
    paintScene();
    const s = read();
    if (!placed) {
      placed = true;
      lens.x = s.home.x;
      lens.y = s.home.y;
      lens.restX = s.home.x;
      lens.restY = s.home.y;
      return;
    }
    const wall = bounds(s.area);
    lens.restX = clamp(lens.restX, wall.left, wall.right);
    lens.restY = clamp(lens.restY, wall.top, wall.bottom);
  };

  const rest = () => {
    const wall = bounds(read().area);
    const sway = drift(radius());
    lens.restX = clamp(lens.x, wall.left, wall.right) - sway.x;
    lens.restY = clamp(lens.y, wall.top, wall.bottom) - sway.y;
  };

  const advanceShape = (s: GlassLensSettings, dt: number) => {
    if (s.shape !== morph.asked) {
      morph.asked = s.shape;
      morph.next = s.shape;
    }
    if (morph.next && morph.t >= 1) {
      if (morph.next !== morph.to) {
        morph.from = morph.to;
        morph.to = morph.next;
        morph.t = 0;
        kick(2.5);
      }
      morph.next = null;
    }
    if (morph.t >= 1) return false;
    morph.t = Math.min(1, morph.t + dt / (reduced ? MORPH_SECONDS / 2 : MORPH_SECONDS));
    return true;
  };

  const bounce = (wall: ReturnType<typeof bounds>, keep: number) => {
    if (lens.x < wall.left || lens.x > wall.right) {
      lens.x = clamp(lens.x, wall.left, wall.right);
      kick(Math.min(4, Math.abs(lens.vx) * 0.0016));
      lens.vx *= -keep;
    }
    if (lens.y < wall.top || lens.y > wall.bottom) {
      lens.y = clamp(lens.y, wall.top, wall.bottom);
      kick(Math.min(4, Math.abs(lens.vy) * 0.0016));
      lens.vy *= -keep;
    }
  };

  const advanceLens = (s: GlassLensSettings, dt: number) => {
    const wall = bounds(s.area);
    if (flying) {
      for (let left = dt; left > 0; left -= STEP) {
        const h = Math.min(STEP, left);
        lens.x += lens.vx * h;
        lens.y += lens.vy * h;
        const drag = Math.exp(-1.4 * h);
        lens.vx *= drag;
        lens.vy *= drag;
        bounce(wall, HARD_BOUNCE);
      }
      if (Math.hypot(lens.vx, lens.vy) < REST_SPEED) {
        flying = false;
        rest();
      }
      return true;
    }
    if (s.interaction === "follow" && !pointer.grabbed) {
      lens.restX = s.home.x;
      lens.restY = s.home.y;
    }
    const sway = drift(radius());
    let goalX = lens.restX + sway.x;
    let goalY = lens.restY + sway.y;
    if (s.interaction === "follow" && pointer.inside) {
      goalX = pointer.x;
      goalY = pointer.y;
    }
    if (pointer.grabbed) {
      goalX = pointer.x - pointer.grabX;
      goalY = pointer.y - pointer.grabY;
    }
    goalX = clamp(goalX, wall.left, wall.right);
    goalY = clamp(goalY, wall.top, wall.bottom);
    const omega = (pointer.grabbed ? 34 : 24) * SMOOTHING * (reduced ? 1.6 : 1);
    for (let left = dt; left > 0; left -= STEP) {
      const h = Math.min(STEP, left);
      lens.vx += (omega * omega * (goalX - lens.x) - 2 * FOLLOW_DAMPING * omega * lens.vx) * h;
      lens.vy += (omega * omega * (goalY - lens.y) - 2 * FOLLOW_DAMPING * omega * lens.vy) * h;
      lens.x += lens.vx * h;
      lens.y += lens.vy * h;
      bounce(wall, SOFT_BOUNCE);
    }
    return Math.abs(goalX - lens.x) + Math.abs(goalY - lens.y) > 0.05 || Math.hypot(lens.vx, lens.vy) > 0.5;
  };

  const advanceJelly = (s: GlassLensSettings, dt: number) => {
    const speed = Math.hypot(lens.vx, lens.vy);
    if (speed > 1) {
      axis.x = lens.vx / speed;
      axis.y = lens.vy / speed;
    }
    const wobble = reduced ? 0 : clamp(s.wobble, 0, 1);
    const gain = reduced ? 0 : TILT_GAIN;
    const wobbling = pull(jelly, 1 + clamp(speed / 1800, 0, 0.55) * wobble, 13, 0.32, dt);
    const leaningX = pull(tiltX, clamp(lens.vy * gain, -TILT_LIMIT, TILT_LIMIT), 9, 0.5, dt);
    const leaningY = pull(tiltY, clamp(lens.vx * gain, -TILT_LIMIT, TILT_LIMIT), 9, 0.5, dt);
    const growing = pull(grow, 1, 11, 0.52, dt);
    presence = Math.min(1, presence + dt / FADE_SECONDS);
    const shaking = morph.t < 1 ? 0.05 * wobble * Math.sin(Math.PI * morph.t) : 0;
    ripple += (shaking - ripple) * (1 - Math.exp(-dt / 0.08));
    return wobbling || leaningX || leaningY || growing || presence < 1 || ripple > 1e-4;
  };

  const placeHandle = (size: number) => {
    if (!handle) return;
    const reach = size * 2.2;
    handle.style.width = `${reach.toFixed(1)}px`;
    handle.style.height = `${reach.toFixed(1)}px`;
    handle.style.transform = `translate3d(${(lens.x - reach / 2).toFixed(1)}px, ${(lens.y - reach / 2).toFixed(1)}px, 0)`;
  };

  const advanceIdle = (dt: number) => {
    if (reduced) return false;
    if (!pointer.grabbed) idleClock += dt;
    spin += dt * SPIN_RATE;
    return true;
  };

  const turn = () => {
    const mixed = ease(morph.t);
    const between = (pick: (rate: (typeof SPIN)[GlassShape]) => number) =>
      pick(SPIN[morph.from]) + (pick(SPIN[morph.to]) - pick(SPIN[morph.from])) * mixed;
    const tumble = between((rate) => rate.tumble);
    const sway = between((rate) => rate.sway);
    const angle = spin % TURN;
    const pose = blend(fromAngles(POSE[morph.from]), fromAngles(POSE[morph.to]), mixed);
    const nod = around(1, 0, 0, Math.sin(spin * 0.6) * 0.18 * tumble);
    const spun = compose(compose(nod, blend(IDENTITY, around(0, 1, 0, angle), tumble)), pose);
    const swayed = compose(blend(IDENTITY, around(0, 0, 1, angle), sway), spun);
    return inverseMatrix(compose(fromAngles([tiltX.value, tiltY.value, 0]), swayed));
  };

  const draw = (s: GlassLensSettings, size: number) => {
    const mixed = ease(morph.t);
    const [red, green, blue] = toRgb(s.color);
    const extent = EXTENT[morph.from] + (EXTENT[morph.to] - EXTENT[morph.from]) * mixed;
    const unit = (size * Math.max(0, grow.value)) / extent;
    const stretch = Math.max(0.2, jelly.value);
    const reach = 1.3 * Math.max(stretch, 1 / Math.sqrt(stretch));
    const focal = Math.max(view.width, view.height) * FOCAL;
    const height = unit * FLOOR;
    const depth = (focal - height) / focal;
    const centerX = view.width / 2 + (lens.x - view.width / 2) * depth;
    const centerY = view.height / 2 + (lens.y - view.height / 2) * depth;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(at("uScene"), 0);
    gl.uniform1f(at("uSceneOn"), sceneReady ? 1 : 0);
    gl.uniform2f(at("uView"), view.width, view.height);
    gl.uniform1f(at("uRatio"), view.ratio);
    gl.uniform3f(at("uCamera"), view.width / 2, view.height / 2, focal);
    gl.uniform3f(at("uCenter"), centerX, centerY, height);
    gl.uniform1f(at("uUnit"), unit);
    gl.uniform1f(at("uReach"), reach);
    gl.uniform1f(at("uLod"), Math.log2(Math.max(1, unit * reach * 0.7 * view.ratio)));
    gl.uniform2i(at("uShapes"), SHAPE_ID[morph.from], SHAPE_ID[morph.to]);
    gl.uniform1f(at("uMorph"), mixed);
    gl.uniform2f(at("uAxis"), axis.x, -axis.y);
    gl.uniform1f(at("uStretch"), stretch);
    gl.uniformMatrix3fv(at("uTurn"), false, turn());
    gl.uniform1f(at("uTime"), reduced ? 0 : clock);
    gl.uniform1f(at("uRipple"), ripple);
    gl.uniform1f(at("uPresence"), presence);
    const strength = clamp(s.refraction, 0, 2);
    gl.uniform1f(at("uIor"), 1 + 0.5 * strength);
    gl.uniform1f(at("uSpread"), DISPERSION * (0.5 + 0.5 * strength));
    gl.uniform3f(at("uColor"), red, green, blue);
    gl.uniform1f(at("uTint"), clamp(s.tint, 0, 1));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const schedule = () => {
    if (!frameId && !stopped && visible && pageVisible) frameId = requestAnimationFrame(frame);
  };

  const linkReady = () => {
    if (linked) return true;
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      stop();
      return false;
    }
    linked = true;
    for (const name of UNIFORMS) uniform.set(name, gl.getUniformLocation(program, name));
    parts.onLive(true);
    return true;
  };

  function frame(now: number) {
    frameId = 0;
    if (stopped) return;
    if (!linkReady()) {
      last = now;
      schedule();
      return;
    }
    if (!sized) measure();
    const s = read();
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
    last = now;
    clock += dt;
    const shaping = advanceShape(s, dt);
    const moving = advanceLens(s, dt);
    const wobbling = advanceJelly(s, dt);
    const idling = advanceIdle(dt);
    const size = radius();
    draw(s, size);
    placeHandle(size);
    if (shaping || moving || wobbling || idling) schedule();
  }

  const wake = () => {
    if (frameId || stopped) return;
    last = performance.now();
    schedule();
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    parts.onLive(false);
  };

  const locate = (event: PointerEvent) => {
    const box = container.getBoundingClientRect();
    return {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      inside:
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom,
    };
  };

  const touches = (x: number, y: number) => Math.hypot(x - lens.x, y - lens.y) < radius() * 1.1;

  const release = () => {
    pointer.grabbed = false;
    container.removeAttribute("data-grabbing");
  };

  const onPointerMove = (event: PointerEvent) => {
    const spot = locate(event);
    pointer.x = spot.x;
    pointer.y = spot.y;
    pointer.inside = spot.inside;
    wake();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    const spot = locate(event);
    if (!spot.inside) return;
    Object.assign(pointer, { x: spot.x, y: spot.y, inside: true, down: true, startX: spot.x, startY: spot.y });
    if (read().interaction === "drag" && touches(spot.x, spot.y)) {
      pointer.grabbed = true;
      pointer.grabX = spot.x - lens.x;
      pointer.grabY = spot.y - lens.y;
      flying = false;
      container.setAttribute("data-grabbing", "");
    }
    wake();
  };

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
      const { cycle } = read();
      if (cycle.length > 1) morph.next = cycle[(cycle.indexOf(morph.next ?? morph.to) + 1) % cycle.length] ?? null;
      wake();
    }, DOUBLE_TAP_MS);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointer.down) return;
    pointer.down = false;
    const spot = locate(event);
    if (pointer.grabbed) {
      release();
      flying = Math.hypot(lens.vx, lens.vy) > THROW_SPEED;
      if (!flying) rest();
    }
    const tapped = Math.hypot(spot.x - pointer.startX, spot.y - pointer.startY) <= TAP_SLOP;
    if (tapped && spot.inside && touches(spot.x, spot.y)) {
      kick(3);
      queueMorph();
    }
    if (event.pointerType !== "mouse") pointer.inside = false;
    wake();
  };

  const onLeave = () => {
    pointer.inside = false;
    pointer.down = false;
    if (pointer.grabbed) {
      release();
      rest();
    }
    wake();
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    stop();
  };

  const onVisibility = () => {
    pageVisible = document.visibilityState !== "hidden";
    wake();
  };

  const onResize = () => {
    sized = false;
    wake();
  };

  const sizeObserver = new ResizeObserver(onResize);
  const viewObserver = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    wake();
  });

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onLeave, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", restart);
  sizeObserver.observe(container);
  viewObserver.observe(container);
  void document.fonts?.ready.then(() => {
    sceneKey = "";
    onResize();
  });
  measure();
  wake();

  return {
    refresh() {
      onResize();
    },
    dispose() {
      stopped = true;
      cancelAnimationFrame(frameId);
      cancelTap();
      sizeObserver.disconnect();
      viewObserver.disconnect();
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
      gl.deleteProgram(program);
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
    },
  } satisfies GlassLens;
}

export function createGlassLens(parts: GlassLensParts, read: () => GlassLensSettings): GlassLens | null {
  let lens: GlassLens | null = null;
  const restart = () => {
    lens?.dispose();
    lens = runLens(parts, read, false, restart);
    if (!lens) parts.onLive(false);
  };
  lens = runLens(parts, read, true, restart);
  if (!lens) return null;
  return {
    refresh: () => lens?.refresh(),
    dispose: () => lens?.dispose(),
  };
}
