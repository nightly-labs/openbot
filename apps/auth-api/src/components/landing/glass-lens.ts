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
const SPIN: Record<GlassShape, { yaw: number; roll: number }> = {
  lens: { yaw: 0, roll: 0 },
  blob: { yaw: 0, roll: 0.12 },
  pill: { yaw: 0, roll: 0.25 },
  torus: { yaw: 0, roll: 0 },
  prism: { yaw: 0, roll: 0.3 },
  diamond: { yaw: 0.27, roll: 0 },
};
const TILT: Record<GlassShape, number> = { lens: 0.35, blob: 0.5, pill: 0.6, torus: 0.7, prism: 0.8, diamond: 0.7 };
const POSE: Record<GlassShape, readonly [number, number]> = {
  lens: [0, 0],
  blob: [0.2, 0],
  pill: [0, 0],
  torus: [-0.5, 0.18],
  prism: [-0.3, 0.45],
  diamond: [-0.35, 0.5],
};
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
const MORPH_SECONDS = 0.7;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const EXTENT: Record<GlassShape, number> = { lens: 1.03, blob: 1.08, pill: 1.02, torus: 1, prism: 1.18, diamond: 1.05 };
const FLOOR = 0.75;
const FOCAL = 1.6;
const SHADE_SIZE = 256;
const SUN_LENGTH = Math.hypot(-0.42, 0.55, 1);
const SUN = [-0.42 / SUN_LENGTH, 0.55 / SUN_LENGTH, 1 / SUN_LENGTH] as const;
const UNIFORMS = [
  "uScene",
  "uShade",
  "uSceneOn",
  "uPass",
  "uShadeBox",
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
  "uIor",
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
uniform sampler2D uShade;
uniform float uSceneOn;
uniform float uPass;
uniform vec4 uShadeBox;
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
uniform float uIor;
uniform vec3 uColor;
uniform float uTint;
out vec4 outColor;

const float FLOOR = ${FLOOR.toFixed(2)};
const float SHADE = ${SHADE_SIZE.toFixed(1)};
const float MAX_FOOTPRINT = 4.0;
const vec3 SUN = vec3(${SUN.map((value) => value.toFixed(4)).join(", ")});
const vec2 GLINT = vec2(-0.6, 0.8);
const vec2 JITTER[3] = vec2[3](vec2(0.3, 0.2), vec2(-0.2, 0.3), vec2(0.1, -0.35));

struct Hit {
  float kind;
  float cover;
  vec3 p;
  vec3 n;
  vec3 q;
  vec3 dir;
  float travel;
  float clarity;
};

vec4 sceneGrad(vec2 point, vec2 gx, vec2 gy) {
  vec2 uv = point / uView;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return textureGrad(uScene, uv, gx / uView, gy / uView) * uSceneOn;
}

vec2 lightAt(vec2 point) {
  vec2 uv = (point - uShadeBox.xy) / uShadeBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec2(0.0);
  return textureLod(uShade, uv, 0.0).rg;
}

vec4 lit(vec4 color, vec2 light) {
  vec4 shaded = vec4(color.rgb * (1.0 - light.x), color.a + light.x * (1.0 - color.a));
  return vec4(vec3(light.y) + shaded.rgb * (1.0 - light.y), light.y + shaded.a * (1.0 - light.y));
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
  vec3 o = uTurn * p;
  float d = body(uShapes.x, o);
  if (uMorph > 0.0) d = mix(d, body(uShapes.y, o), uMorph);
  return d / max(1.0 / uStretch, sqrt(uStretch));
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0025;
  return normalize(
    k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h)
  );
}

float softbox(vec2 at, vec2 size, float corner) {
  vec2 q = abs(at) - size + corner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  float w = 1.5 / max(uRatio * uUnit, 1.0);
  return 1.0 - smoothstep(-w, w, d);
}

vec4 studio(vec3 d, float gain) {
  float yaw = atan(d.x, d.z);
  float key = softbox(vec2(yaw + 0.62, d.y - 0.5), vec2(0.26, 0.16), 0.05);
  float strip = softbox(vec2(yaw - 0.95, d.y - 0.05), vec2(0.06, 0.5), 0.03);
  float level = (key * 7.0 + strip * 3.5 + smoothstep(0.0, 1.0, d.z) * 0.04) * gain;
  float cover = clamp(level, 0.0, 1.0);
  return vec4(vec3(cover), cover);
}

vec2 shadowAt(vec2 point) {
  vec3 p = toLocal(vec3(point, 0.0));
  float t = 0.05;
  float soft = 1.0;
  float deep = 1e3;
  for (int i = 0; i < 32; i++) {
    float d = map(p + SUN * t);
    deep = min(deep, d);
    if (d > 0.0) soft = min(soft, 6.0 * d / t);
    t += clamp(abs(d) * 0.8, 0.02, 0.27);
    if (t > FLOOR * 2.6 + uReach * 2.0) break;
  }
  if (deep > 0.0) return vec2((1.0 - clamp(soft, 0.0, 1.0)) * 0.18, 0.0);
  float depth = -deep;
  return vec2(exp(-depth * 14.0) * 0.21, clamp(smoothstep(0.12, 0.5, depth) * (uIor - 1.0), 0.0, 1.0));
}

Hit trace(vec3 ro, vec3 rd, float eps) {
  Hit hit = Hit(0.0, 0.0, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), vec3(0.0, 0.0, -1.0), 0.0, 1.0);
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

void crossGlass(inout Hit hit, vec3 rd, float eps) {
  vec3 dir = refract(rd, hit.n, 1.0 / uIor);
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
      leaving = outward;
      escaped = true;
      break;
    }
    dir = reflect(dir, -n);
    q += dir * eps * 4.0;
  }
  if (!escaped) leaving = dir;
  if (leaving.z > -0.2) leaving = normalize(vec3(leaving.xy, -0.2 - abs(leaving.z)));
  hit.q = q;
  hit.dir = leaving;
}

float entryBand(float cosi) {
  return smoothstep(0.42, 0.12, cosi);
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
    vec2 land = landing(hit.q, hit.dir, point);
    vec4 seen = lit(sceneGrad(land, tx, ty), lightAt(land) * vec2(0.45, 0.12));
    through = mix(seen, tone, band);
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
  if (uPass > 0.5) {
    vec2 light = uUnit < 0.5 ? vec2(0.0) : shadowAt(uShadeBox.xy + gl_FragCoord.xy / SHADE * uShadeBox.zw);
    outColor = vec4(light, 0.0, 1.0);
    return;
  }
  vec2 frag = gl_FragCoord.xy / uRatio;
  vec2 point = vec2(frag.x, uView.y - frag.y);
  vec4 back = lit(sceneGrad(point, vec2(0.0), vec2(0.0)), lightAt(point) * vec2(1.0, 0.3));
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
  outColor = color;
}`;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const orientation = (yaw: number, pitch: number, roll: number) => {
  const [cy, sy, cp, sp, cr, sr] = [
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  ];
  return new Float32Array([
    cr * cy,
    cr * sy * sp - sr * cp,
    cr * sy * cp + sr * sp,
    sr * cy,
    sr * sy * sp + cr * cp,
    sr * sy * cp - cr * sp,
    -sy,
    cy * sp,
    cy * cp,
  ]);
};

const unwind = (angle: number, rate: number, dt: number) => {
  if (rate > 0) return angle + dt * rate;
  const home = Math.round(angle / TURN) * TURN;
  return angle + (home - angle) * Math.min(1, dt * 3);
};

const ease = (t: number) => t * t * (3 - 2 * t);

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

const linkProgram = (gl: WebGL2RenderingContext) => {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
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
  const program = linkProgram(gl);
  if (!program) return null;
  const uniform = new Map<UniformName, WebGLUniformLocation | null>(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  const at = (name: UniformName) => uniform.get(name) ?? null;
  const vao = gl.createVertexArray();
  const texture = makeTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
  const anisotropic = gl.getExtension("EXT_texture_filter_anisotropic");
  if (anisotropic) {
    const most: number = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(MAX_ANISOTROPY, most));
  }
  const shadeTexture = makeTexture(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADE_SIZE, SHADE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const shadeTarget = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadeTarget);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadeTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sceneCanvas = document.createElement("canvas");
  const view = { width: 1, height: 1, ratio: 1 };
  const first = read();
  const lens = { x: first.home.x, y: first.home.y, vx: 0, vy: 0, restX: first.home.x, restY: first.home.y };
  const axis = { x: 1, y: 0 };
  const pointer = { x: 0, y: 0, inside: false, down: false, grabbed: false, grabX: 0, grabY: 0, startX: 0, startY: 0 };
  const jelly: Spring = { value: 1, speed: 0 };
  const grow: Spring = { value: intro && !reduced ? 0 : 1, speed: 0 };
  const morph: Morph = { from: first.shape, to: first.shape, t: 1, next: null, asked: first.shape };
  const spin = { yaw: 0, roll: 0 };
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
      x: (Math.sin(clock * 0.37) * 0.18 + Math.sin(clock * 0.83 + 1.7) * 0.06) * size,
      y: (Math.cos(clock * 0.29) * 0.1 + Math.sin(clock * 0.61 + 0.4) * 0.04) * size,
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
        kick(2);
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
      kick(Math.min(3, Math.abs(lens.vx) * 0.0016));
      lens.vx *= -keep;
    }
    if (lens.y < wall.top || lens.y > wall.bottom) {
      lens.y = clamp(lens.y, wall.top, wall.bottom);
      kick(Math.min(3, Math.abs(lens.vy) * 0.0016));
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
    const omega = (pointer.grabbed ? 26 : 12) * (reduced ? 1.6 : 1);
    for (let left = dt; left > 0; left -= STEP) {
      const h = Math.min(STEP, left);
      lens.vx += (omega * omega * (goalX - lens.x) - 1.7 * omega * lens.vx) * h;
      lens.vy += (omega * omega * (goalY - lens.y) - 1.7 * omega * lens.vy) * h;
      lens.x += lens.vx * h;
      lens.y += lens.vy * h;
      bounce(wall, SOFT_BOUNCE);
    }
    return Math.abs(goalX - lens.x) + Math.abs(goalY - lens.y) > 0.05 || Math.hypot(lens.vx, lens.vy) > 0.5;
  };

  const advanceJelly = (s: GlassLensSettings, dt: number) => {
    const speed = Math.hypot(lens.vx, lens.vy);
    if (speed > 20) {
      axis.x = lens.vx / speed;
      axis.y = lens.vy / speed;
    }
    const target = reduced ? 1 : 1 + Math.min(speed / 2200, 0.4) * clamp(s.wobble, 0, 1);
    const wobbling = pull(jelly, target, 14, 0.35, dt);
    const growing = pull(grow, 1, 9, 0.55, dt);
    return wobbling || growing;
  };

  const placeHandle = (size: number) => {
    if (!handle) return;
    const reach = size * 2.2;
    handle.style.width = `${reach.toFixed(1)}px`;
    handle.style.height = `${reach.toFixed(1)}px`;
    handle.style.transform = `translate3d(${(lens.x - reach / 2).toFixed(1)}px, ${(lens.y - reach / 2).toFixed(1)}px, 0)`;
  };

  const advanceSpin = (dt: number) => {
    const rate = SPIN[morph.to];
    spin.yaw = unwind(spin.yaw, reduced ? 0 : rate.yaw, dt);
    spin.roll = unwind(spin.roll, reduced ? 0 : rate.roll, dt);
  };

  const turn = () => {
    const mixed = ease(morph.t);
    const tilt = reduced ? 0 : TILT[morph.from] + (TILT[morph.to] - TILT[morph.from]) * mixed;
    const leanX = reduced ? 0 : clamp(lens.vx * 0.00035, -0.5, 0.5);
    const leanY = reduced ? 0 : clamp(lens.vy * 0.00035, -0.5, 0.5);
    const pose = (index: 0 | 1) => POSE[morph.from][index] + (POSE[morph.to][index] - POSE[morph.from][index]) * mixed;
    const yaw = spin.yaw + pose(1) + leanX + tilt * Math.sin(clock * 0.7) * 0.2;
    const pitch = pose(0) + leanY + tilt * Math.cos(clock * 0.53) * 0.16;
    const roll = spin.roll + tilt * Math.sin(clock * 0.31 + 1.2) * 0.12 - leanX * 0.3;
    return orientation(yaw, pitch, roll);
  };

  const draw = (s: GlassLensSettings, size: number) => {
    const mixed = ease(morph.t);
    const [red, green, blue] = toRgb(s.color);
    const extent = EXTENT[morph.from] + (EXTENT[morph.to] - EXTENT[morph.from]) * mixed;
    const unit = (size * Math.max(0, grow.value)) / extent;
    const stretch = clamp(jelly.value, 0.6, 1.6);
    const reach = 1.3 * Math.max(stretch, 1);
    const focal = Math.max(view.width, view.height) * FOCAL;
    const height = unit * FLOOR;
    const depth = (focal - height) / focal;
    const centerX = view.width / 2 + (lens.x - view.width / 2) * depth;
    const centerY = view.height / 2 + (lens.y - view.height / 2) * depth;
    const shadeHalf = unit * reach * 1.7;
    const shadeX = centerX - (SUN[0] / SUN[2]) * height;
    const shadeY = centerY + (SUN[1] / SUN[2]) * height;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(at("uScene"), 0);
    gl.uniform1i(at("uShade"), 1);
    gl.uniform1f(at("uSceneOn"), sceneReady ? 1 : 0);
    gl.uniform4f(at("uShadeBox"), shadeX - shadeHalf, shadeY - shadeHalf, shadeHalf * 2, shadeHalf * 2);
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
    gl.uniform1f(at("uTime"), clock);
    gl.uniform1f(at("uIor"), 1 + 0.5 * clamp(s.refraction, 0, 2));
    gl.uniform3f(at("uColor"), red, green, blue);
    gl.uniform1f(at("uTint"), clamp(s.tint, 0, 1));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadeTarget);
    gl.viewport(0, 0, SHADE_SIZE, SHADE_SIZE);
    gl.uniform1f(at("uPass"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, shadeTexture);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(at("uPass"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const schedule = () => {
    if (!frameId && !stopped && visible && pageVisible) frameId = requestAnimationFrame(frame);
  };

  function frame(now: number) {
    frameId = 0;
    if (stopped) return;
    if (!sized) measure();
    const s = read();
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
    last = now;
    clock += dt;
    const shaping = advanceShape(s, dt);
    const moving = advanceLens(s, dt);
    const wobbling = advanceJelly(s, dt);
    advanceSpin(dt);
    const size = radius();
    draw(s, size);
    placeHandle(size);
    if (shaping || moving || wobbling || !reduced) schedule();
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
      gl.deleteTexture(shadeTexture);
      gl.deleteFramebuffer(shadeTarget);
      gl.deleteVertexArray(vao);
    },
  } satisfies GlassLens;
}

export function createGlassLens(parts: GlassLensParts, read: () => GlassLensSettings): GlassLens | null {
  let lens: GlassLens | null = null;
  const restart = () => {
    lens?.dispose();
    lens = runLens(parts, read, false, restart);
    parts.onLive(lens !== null);
  };
  lens = runLens(parts, read, true, restart);
  if (!lens) return null;
  return {
    refresh: () => lens?.refresh(),
    dispose: () => lens?.dispose(),
  };
}
