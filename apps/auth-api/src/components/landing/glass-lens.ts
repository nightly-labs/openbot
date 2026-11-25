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
  readonly dispersion: number;
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
const SPIN: Record<GlassShape, number> = { lens: 0, blob: 0.35, pill: 0.7, torus: 0.8, prism: 1, diamond: 0.9 };
const TILT: Record<GlassShape, number> = { lens: 0.35, blob: 0.5, pill: 0.6, torus: 0.7, prism: 0.8, diamond: 0.7 };
const TURN = Math.PI * 2;
const PIXEL_BUDGET = 5e6;
const MAX_RATIO = 2;
const STEP = 1 / 240;
const WALL_ROOM = 1.1;
const SOFT_BOUNCE = 0.35;
const HARD_BOUNCE = 0.62;
const TAP_SLOP = 6;
const THROW_SPEED = 60;
const REST_SPEED = 30;
const MORPH_SECONDS = 0.7;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const UNIFORMS = [
  "uScene",
  "uSceneOn",
  "uView",
  "uRatio",
  "uCenter",
  "uRadius",
  "uShapes",
  "uMorph",
  "uAxis",
  "uStretch",
  "uTurn",
  "uTime",
  "uRefraction",
  "uDispersion",
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
uniform vec2 uCenter;
uniform float uRadius;
uniform ivec2 uShapes;
uniform float uMorph;
uniform vec2 uAxis;
uniform float uStretch;
uniform mat3 uTurn;
uniform float uTime;
uniform float uRefraction;
uniform float uDispersion;
uniform vec3 uColor;
uniform float uTint;
out vec4 outColor;

const float REACH = 1.3;
const float BACKDROP = 1.7;
const float NEAR = 0.0015;
const vec3 KEY = vec3(-0.55, 0.62, 0.56);

vec4 sceneAt(vec2 point) {
  vec2 uv = point / uView;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uScene, uv) * uSceneOn;
}

float lensBody(vec3 p) {
  float faces = max(length(p - vec3(0.0, 0.0, -1.941)) - 2.161, length(p - vec3(0.0, 0.0, 1.941)) - 2.161);
  return max(faces, length(p.xy) - 0.82) - 0.17;
}

float blobBody(vec3 p) {
  float t = uTime;
  float wave = sin(2.6 * p.x + t * 1.1) * sin(2.4 * p.y - t * 0.9) * sin(2.2 * p.z + t * 0.7);
  float ripple = sin(5.0 * p.x - t * 1.6) * sin(4.6 * p.y + t * 1.3) * sin(4.2 * p.z + t);
  return (length(p) - 0.84 - 0.09 * wave - 0.03 * ripple) * 0.7;
}

float pillBody(vec3 p) {
  return length(p - vec3(clamp(p.x, -0.42, 0.42), 0.0, 0.0)) - 0.52;
}

float torusBody(vec3 p) {
  return length(vec2(length(p.xy) - 0.64, p.z)) - 0.3;
}

float prismBody(vec3 p) {
  p.y += 0.27;
  vec3 q = abs(p);
  float side = max(q.x * 0.866025 + p.y * 0.5, -p.y) - 0.5;
  return max(q.z - 0.4, side) - 0.03;
}

float diamondBody(vec3 p) {
  vec3 q = abs(p * vec3(1.0, 0.82, 1.0));
  return (q.x + q.y + q.z - 0.98) * 0.58;
}

float body(int id, vec3 p) {
  if (id == 1) return blobBody(p);
  if (id == 2) return pillBody(p);
  if (id == 3) return torusBody(p);
  if (id == 4) return prismBody(p);
  if (id == 5) return diamondBody(p);
  return lensBody(p);
}

float scale() {
  return max(1.0 / uStretch, sqrt(uStretch));
}

float map(vec3 p) {
  float along = dot(p.xy, uAxis);
  vec2 across = p.xy - uAxis * along;
  p.xy = uAxis * (along / uStretch) + across * sqrt(uStretch);
  vec3 o = uTurn * p;
  return mix(body(uShapes.x, o), body(uShapes.y, o), uMorph) / scale();
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.002;
  return normalize(
    k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h)
  );
}

vec3 environment(vec3 d) {
  float sky = smoothstep(-0.2, 1.0, d.y) * 0.32;
  float key = pow(max(dot(d, normalize(KEY)), 0.0), 16.0) * 1.3;
  float rim = smoothstep(0.55, 1.0, -d.x) * 0.18 + smoothstep(0.7, 1.0, d.x) * 0.12;
  return vec3(0.34 + sky + key + rim) * mix(vec3(1.0), uColor, uTint);
}

void main() {
  vec2 frag = gl_FragCoord.xy / uRatio;
  vec2 point = vec2(frag.x, uView.y - frag.y);
  vec4 scene = sceneAt(point);
  vec2 offset = point - uCenter;
  float reach = REACH * scale();
  if (uRadius < 0.5 || length(offset) > uRadius * reach + 2.0) {
    outColor = scene;
    return;
  }
  vec2 q = vec2(offset.x, -offset.y) / uRadius;
  vec3 rd = vec3(0.0, 0.0, -1.0);
  vec3 ro = vec3(q, sqrt(max(reach * reach - dot(q, q), 0.0)) + 0.01);
  float stop = ro.z * 2.0;
  float travel = 0.0;
  float closest = 1e9;
  bool hit = false;
  for (int i = 0; i < 56; i++) {
    float d = map(ro + rd * travel);
    closest = min(closest, d);
    if (d < NEAR) {
      hit = true;
      break;
    }
    travel += d;
    if (travel > stop) break;
  }
  if (!hit) {
    float edge = clamp(0.6 - closest * uRadius / 1.4, 0.0, 1.0);
    outColor = mix(scene, vec4(0.42) + scene * 0.58, edge);
    return;
  }
  vec3 p = ro + rd * travel;
  vec3 n = normalAt(p);
  float ior = 1.0 + 0.2 * uRefraction;
  vec3 r1 = refract(rd, n, 1.0 / ior);
  vec3 inner = p - n * 0.004;
  float span = 0.02;
  for (int i = 0; i < 36; i++) {
    float d = -map(inner + r1 * span);
    if (d < NEAR) break;
    span += max(d, 0.004);
  }
  vec3 exit = inner + r1 * span;
  vec3 n2 = normalAt(exit);
  vec3 r2 = refract(r1, -n2, ior);
  if (dot(r2, r2) < 0.5) r2 = reflect(r1, -n2);
  vec2 land = r2.z < -0.05 ? exit.xy + r2.xy * ((-BACKDROP - exit.z) / r2.z) : exit.xy + r2.xy * 2.5;
  vec2 shift = land - q;
  float split = 0.03 + 0.09 * uDispersion;
  vec2 toPoint = vec2(1.0, -1.0) * uRadius;
  vec4 red = sceneAt(uCenter + (q + shift * (1.0 - split)) * toPoint);
  vec4 green = sceneAt(uCenter + (q + shift) * toPoint);
  vec4 blue = sceneAt(uCenter + (q + shift * (1.0 + split)) * toPoint);
  vec4 seen = vec4(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
  vec3 absorb = mix(vec3(1.0), uColor, uTint * 0.6) * exp(-span * 0.12);
  seen.rgb *= absorb;

  float facing = clamp(n.z, 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 2.2);
  vec3 bounce = reflect(rd, n);
  vec3 shine = environment(bounce) * fresnel + vec3(pow(max(dot(bounce, normalize(KEY)), 0.0), 120.0) * 1.6);
  float fill = 0.05 + 0.035 * span + uTint * 0.22;
  vec3 tone = mix(vec3(0.78), uColor, uTint) * fill;
  vec3 glass = shine + tone;
  float alpha = clamp(max(fill + fresnel * 0.6, max(glass.r, max(glass.g, glass.b))), 0.0, 1.0);
  outColor = vec4(min(glass, vec3(alpha)) + seen.rgb * (1.0 - alpha), alpha + seen.a * (1.0 - alpha));
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
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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
  const spin = { yaw: 0, pitch: 0 };
  let sceneKey = "";
  let sceneReady = false;
  let placed = false;
  let flying = false;
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
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
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
    const rate = reduced ? 0 : SPIN[morph.to];
    spin.yaw = unwind(spin.yaw, rate * 0.75, dt);
    spin.pitch = unwind(spin.pitch, rate * 0.46, dt);
  };

  const turn = () => {
    const mixed = ease(morph.t);
    const tilt = reduced ? 0 : TILT[morph.from] + (TILT[morph.to] - TILT[morph.from]) * mixed;
    const leanX = reduced ? 0 : clamp(lens.vx * 0.00035, -0.5, 0.5);
    const leanY = reduced ? 0 : clamp(lens.vy * 0.00035, -0.5, 0.5);
    const yaw = spin.yaw + leanX + tilt * Math.sin(clock * 0.7) * 0.3;
    const pitch = spin.pitch + leanY + tilt * Math.cos(clock * 0.53) * 0.24;
    const roll = tilt * Math.sin(clock * 0.31 + 1.2) * 0.12 - leanX * 0.3;
    return orientation(yaw, pitch, roll);
  };

  const draw = (s: GlassLensSettings, size: number) => {
    const mixed = ease(morph.t);
    const [red, green, blue] = toRgb(s.color);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(at("uScene"), 0);
    gl.uniform1f(at("uSceneOn"), sceneReady ? 1 : 0);
    gl.uniform2f(at("uView"), view.width, view.height);
    gl.uniform1f(at("uRatio"), view.ratio);
    gl.uniform2f(at("uCenter"), lens.x, lens.y);
    gl.uniform1f(at("uRadius"), size * Math.max(0, grow.value));
    gl.uniform2i(at("uShapes"), SHAPE_ID[morph.from], SHAPE_ID[morph.to]);
    gl.uniform1f(at("uMorph"), mixed);
    gl.uniform2f(at("uAxis"), axis.x, -axis.y);
    gl.uniform1f(at("uStretch"), clamp(jelly.value, 0.6, 1.6));
    gl.uniformMatrix3fv(at("uTurn"), false, turn());
    gl.uniform1f(at("uTime"), clock);
    gl.uniform1f(at("uRefraction"), s.refraction);
    gl.uniform1f(at("uDispersion"), clamp(s.dispersion, 0, 1));
    gl.uniform3f(at("uColor"), red, green, blue);
    gl.uniform1f(at("uTint"), clamp(s.tint, 0, 1));
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
      const { cycle } = read();
      if (cycle.length > 1) morph.next = cycle[(cycle.indexOf(morph.next ?? morph.to) + 1) % cycle.length] ?? null;
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
    parts.onLive(lens !== null);
  };
  lens = runLens(parts, read, true, restart);
  if (!lens) return null;
  return {
    refresh: () => lens?.refresh(),
    dispose: () => lens?.dispose(),
  };
}
