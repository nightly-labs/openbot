import { prefersReducedMotion } from "@openbot/ui/utils";

const SWEEP_TYPE = "theme-sweep";
const SWEEP_MS = 1200;
const AHEAD = 0.14;
const BEHIND = 0.32;
const REVEAL_LAG = 0.03;
const REVEAL = 0.14;
const END_RADIUS = (1 + BEHIND * 2) / 0.86;
const RIPPLE_ID = "theme-sweep-ripple";
const CREST = 0.09;
const PUSH = 22;
const PULL = 8;
const EDGE_GAIN = 2.2;
const BLUR = 9;
const CHANNEL_SPREAD = 0.08;
const RIPPLE_AHEAD = 4;
const RIPPLE_BEHIND = 6;
const ARCH_DROP = 1 - Math.sqrt(0.75);
const ARCH_REACH = Math.ceil(ARCH_DROP * END_RADIUS * 100) / 100 + 0.02;

function gradientImage(vertical: boolean, stops: string[]): string {
  const size = vertical ? "x2='0' y2='1'" : "x2='1' y2='0'";
  return `data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
      `<linearGradient id='g' ${size}>${stops.join("")}</linearGradient>` +
      "<rect width='100' height='100' fill='url(#g)'/></svg>",
  )}`;
}

function stop(offset: number, value: number): string {
  return `<stop offset='${offset.toFixed(4)}' stop-opacity='${Math.min(1, Math.max(0, value)).toFixed(4)}'/>`;
}

const RIPPLE_SPAN = 4;
const STRIP = 4;

function rippleImage(value: (u: number) => number, outside: number, down: boolean): string {
  const steps = Array.from({ length: 61 }, (_, index) => RIPPLE_AHEAD - (index / 60) * (RIPPLE_AHEAD + RIPPLE_BEHIND));
  const ahead = down ? 1 : -1;
  const stops = steps.map((u) => ({ offset: 0.5 + (ahead * u * CREST) / RIPPLE_SPAN, value: value(u) }));
  if (down) stops.reverse();
  return gradientImage(true, [
    stop(0, outside),
    ...stops.map(({ offset, value }) => stop(offset, value)),
    stop(1, outside),
  ]);
}

function rippleMove(u: number): number {
  const crest = Math.exp(-u * u);
  const trough = Math.exp(-(((u + 2.6) / 1.4) ** 2));
  return 0.5 + (0.5 * (crest * PUSH - trough * PULL)) / PUSH;
}

function rippleBlur(u: number): number {
  return Math.exp(-(((u * 0.5 + 0.2) / 0.9) ** 2));
}

const RIPPLE_IMAGES = {
  up: [rippleImage(rippleMove, 0.5, false), rippleImage(rippleBlur, 0, false)],
  down: [rippleImage(rippleMove, 0.5, true), rippleImage(rippleBlur, 0, true)],
} as const;

const RIPPLE_ARCH = gradientImage(
  false,
  Array.from({ length: 41 }, (_, index) => {
    const offset = index / 40;
    const across = offset - 0.5;
    return stop(offset, 1 - (0.5 * (1 - Math.sqrt(1 - across * across))) / ARCH_DROP);
  }),
);

const RIPPLE_EDGE = gradientImage(
  false,
  Array.from({ length: 41 }, (_, index) => stop(index / 40, (index / 20 - 1) ** 2)),
);
const MAX_PIXEL_RATIO = 1;

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_radius;
uniform float u_progress;
uniform float u_time;
uniform float u_down;
uniform float u_circle;
uniform vec2 u_origin;
uniform float u_spread;
uniform float u_alpha;
const float AHEAD = ${AHEAD.toFixed(3)};
const float BEHIND = ${BEHIND.toFixed(3)};

vec3 spectrum(float t) {
  return vec3(0.74, 0.72, 0.76) + vec3(0.5, 0.52, 0.48) * cos(6.28318 * (t + vec3(0.92, 0.25, 0.58)));
}

vec3 washColor(float t) {
  return spectrum(t) * 0.5 + spectrum(t - 0.18) * 0.25 + spectrum(t + 0.18) * 0.25;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time;
  float s;
  float around = 0.0;
  if (u_circle > 0.5) {
    vec2 p = (gl_FragCoord.xy - u_origin) / u_resolution.y;
    float angle = atan(p.y, p.x);
    float ring = u_radius * (1.0 + 0.08 * sin(angle * 5.0 - t * 3.2) + 0.04 * sin(angle * 11.0 + t * 4.1)
      + 0.02 * sin(angle * 23.0 - t * 5.3));
    s = length(p) - ring;
    around = 0.3 * smoothstep(0.05, 0.4, u_radius) * sin(angle * 3.0 + t * 1.5);
  } else {
    if (u_down > 0.5) uv.y = 1.0 - uv.y;
    float x = uv.x - 0.5 + 0.05 * sin(uv.y * 6.0 + t * 2.5) + 0.02 * sin(uv.y * 13.0 - t * 3.6);
    float radius = u_radius * (1.0 + 0.08 * sin(uv.x * 7.0 - t * 3.2) + 0.04 * sin(uv.x * 15.0 + t * 4.1)
      + 0.02 * sin(uv.x * 29.0 - t * 5.3));
    float k = length(vec2(x, uv.y / max(radius, 0.001)));
    s = (k - 1.0) * u_radius;
  }
  float reach = (s > 0.0 ? AHEAD : BEHIND) * u_spread;
  float alpha = exp(-(s * s) / (reach * reach)) * u_alpha;

  vec2 warp = uv + 0.08 * vec2(sin(uv.y * 5.0 + t * 1.7), sin(uv.x * 6.0 - t * 2.1));
  float hue = u_progress * 0.75 + s * 0.9 + around + 0.1 * sin(warp.x * 7.0 + warp.y * 4.0 + t * 2.0);
  vec3 color = clamp(washColor(hue), 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

interface Band {
  canvas: HTMLCanvasElement;
  setDown(down: boolean): void;
  setCircle(x: number, y: number, spread: number): void;
  draw(radius: number, progress: number, seconds: number, alpha: number): void;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createBand(className: string): Band | null {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
  canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), canvas.width, canvas.height);
  const radiusUniform = gl.getUniformLocation(program, "u_radius");
  const progressUniform = gl.getUniformLocation(program, "u_progress");
  const timeUniform = gl.getUniformLocation(program, "u_time");
  const downUniform = gl.getUniformLocation(program, "u_down");
  const circleUniform = gl.getUniformLocation(program, "u_circle");
  const originUniform = gl.getUniformLocation(program, "u_origin");
  const spreadUniform = gl.getUniformLocation(program, "u_spread");
  const alphaUniform = gl.getUniformLocation(program, "u_alpha");
  gl.uniform1f(spreadUniform, 1);

  return {
    canvas,
    setDown(down) {
      gl.uniform1f(downUniform, down ? 1 : 0);
    },
    setCircle(x, y, spread) {
      gl.uniform1f(circleUniform, 1);
      gl.uniform2f(originUniform, x * ratio, (window.innerHeight - y) * ratio);
      gl.uniform1f(spreadUniform, spread);
    },
    draw(radius, progress, seconds, alpha) {
      gl.uniform1f(radiusUniform, radius);
      gl.uniform1f(alphaUniform, alpha);
      gl.uniform1f(progressUniform, progress);
      gl.uniform1f(timeUniform, seconds);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function easeInOut(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function sweepAlpha(progress: number): number {
  return 0.8 * smoothstep(0, 0.12, progress);
}

function maskStop(radius: number, offset: number): string {
  return `${Math.max(0, 1 + offset / radius) * 100}%`;
}

function sweepProperties(radius: number, down: boolean): Record<string, string> {
  return {
    "--theme-sweep-origin": down ? "0%" : "100%",
    "--theme-sweep-radius": `${radius * 100}%`,
    "--theme-sweep-reveal-from": maskStop(radius, -REVEAL_LAG - REVEAL),
    "--theme-sweep-reveal-to": maskStop(radius, -REVEAL_LAG),
  };
}

interface Ripple {
  element: SVGSVGElement;
  setDown(down: boolean): void;
  draw(radius: number, progress: number): void;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function colorMatrix(input: string, values: string, result: string) {
  return svgElement("feColorMatrix", { in: input, type: "matrix", values, result });
}

function onSource(input: string, result: string) {
  const merge = svgElement("feMerge", { result });
  merge.append(svgElement("feMergeNode", { in: "SourceGraphic" }), svgElement("feMergeNode", { in: input }));
  return merge;
}

function splitChannels(red: string, green: string, blue: string, result: string) {
  const sum = (input: string, other: string, sumResult: string) =>
    svgElement("feComposite", { in: input, in2: other, operator: "arithmetic", k2: "1", k3: "1", result: sumResult });
  return [
    colorMatrix(red, "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1", `${result}Red`),
    colorMatrix(green, "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1", `${result}Green`),
    colorMatrix(blue, "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 1", `${result}Blue`),
    sum(`${result}Red`, `${result}Green`, `${result}RedGreen`),
    sum(`${result}RedGreen`, `${result}Blue`, `${result}Opaque`),
    svgElement("feComposite", { in: `${result}Opaque`, in2: "SourceGraphic", operator: "in", result }),
  ];
}

function channelHalves(move: number): [number, number, number] {
  return [Math.round(move * (1 + CHANNEL_SPREAD)), Math.round(move), Math.round(move * (1 - CHANNEL_SPREAD))];
}

function createRipple(): Ripple {
  const composite = (input: string, mask: string, result: string) =>
    svgElement("feComposite", { in: input, in2: mask, operator: "in", result });
  const element = svgElement("svg", { class: "theme-sweep-ripple", "aria-hidden": "true", width: "0", height: "0" });
  const filter = svgElement("filter", {
    id: RIPPLE_ID,
    x: "-0.1",
    y: "0",
    width: "1.2",
    height: String(1 + ARCH_REACH),
    "color-interpolation-filters": "sRGB",
  });
  const image = (href: string, result: string) =>
    svgElement("feImage", { href, preserveAspectRatio: "none", x: "0", y: "0", result: `${result}Strip` });
  const tile = (result: string) => svgElement("feTile", { in: `${result}Strip`, result });
  const bend = (input: string, result: string) =>
    svgElement("feDisplacementMap", { in: input, in2: "arch", xChannelSelector: "A", yChannelSelector: "A", result });
  const images = [image(RIPPLE_IMAGES.up[0], "moveImage"), image(RIPPLE_IMAGES.up[1], "blurImage")];
  let ahead = -1;
  const arch = image(RIPPLE_ARCH, "arch");
  const edge = image(RIPPLE_EDGE, "edge");
  const middle = 1 / EDGE_GAIN;
  const edgeMove = svgElement("feComposite", {
    in: "ripple",
    in2: "edge",
    operator: "arithmetic",
    k1: String(1 - middle),
    k2: String(middle),
    k3: String(-0.5 * (1 - middle)),
    k4: String(0.5 - 0.5 * middle),
    result: "edgeRipple",
  });
  const bends = [bend("moveImage", "ripple"), bend("blurImage", "blurBand")];

  const moves = ["movedRed", "moved", "movedBlue"].map((result) => ({
    moved: svgElement("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "map",
      xChannelSelector: "R",
      yChannelSelector: "A",
      result: `${result}Left`,
    }),
    back: svgElement("feOffset", { in: `${result}Left`, dy: "0", result }),
    page: onSource(result, `${result}Page`),
  }));
  const blurred = svgElement("feGaussianBlur", { in: "movedPage", result: "blurred" });
  const merge = svgElement("feMerge", {});
  merge.append(...["split", "blurredBand"].map((input) => svgElement("feMergeNode", { in: input })));
  filter.append(
    ...images,
    tile("moveImage"),
    tile("blurImage"),
    arch,
    tile("arch"),
    edge,
    tile("edge"),
    ...bends,
    edgeMove,
    colorMatrix("edgeRipple", "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0", "map"),
    ...moves.flatMap(({ moved, back, page }) => [moved, back, page]),
    ...splitChannels("movedRedPage", "movedPage", "movedBluePage", "split"),
    blurred,
    composite("blurred", "blurBand", "blurredBand"),
    merge,
  );
  element.append(filter);
  return {
    element,
    setDown(down) {
      ahead = down ? 1 : -1;

      const hrefs = down ? RIPPLE_IMAGES.down : RIPPLE_IMAGES.up;
      for (const [index, element] of images.entries()) element.setAttribute("href", hrefs[index] ?? "");
      filter.setAttribute("y", down ? String(-ARCH_REACH) : "0");
    },
    draw(radius, progress) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const strength = Math.sin(Math.PI * Math.min(1, progress));
      const front = ahead > 0 ? height * radius : height * (1 - radius);
      const archScale = 2 * ARCH_DROP * radius * height;
      const sideFront = front - (ahead * archScale) / 2;
      for (const element of images) {
        element.setAttribute("width", String(STRIP));
        element.setAttribute("height", String(height * RIPPLE_SPAN));
        element.setAttribute("y", (sideFront - (height * RIPPLE_SPAN) / 2).toFixed(1));
      }
      arch.setAttribute("width", String(width));
      arch.setAttribute("height", String(STRIP));
      edge.setAttribute("width", String(width));
      edge.setAttribute("height", String(STRIP));
      for (const element of bends) element.setAttribute("scale", (-ahead * archScale).toFixed(1));
      const halves = channelHalves(-ahead * PUSH * EDGE_GAIN * strength);
      for (const [index, { moved, back }] of moves.entries()) {
        const half = halves[index] ?? 0;
        moved.setAttribute("scale", String(2 * half));
        back.setAttribute("dx", String(half));
      }
      blurred.setAttribute("stdDeviation", (BLUR * strength).toFixed(2));
    },
  };
}

function canAnimate(): boolean {
  return document.visibilityState === "visible" && !prefersReducedMotion();
}

let stopCurrent: (() => void) | undefined;

export function sweepTheme(apply: () => void): void {
  stopCurrent?.();
  if (typeof document.startViewTransition !== "function" || !canAnimate()) {
    apply();
    return;
  }
  const band = createBand("theme-sweep-canvas");
  if (!band) {
    apply();
    return;
  }
  const ripple = createRipple();

  const root = document.documentElement;
  let frame = 0;
  let stopped = false;
  let transition: ViewTransition | undefined;
  const before = root.dataset.openbotColorScheme;
  let down = false;
  const show = (radius: number) => {
    for (const [name, value] of Object.entries(sweepProperties(radius, down))) root.style.setProperty(name, value);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    transition?.skipTransition();
    cancelAnimationFrame(frame);
    band.dispose();
    ripple.element.remove();
    for (const name of Object.keys(sweepProperties(1, down))) root.style.removeProperty(name);
    if (stopCurrent === stop) stopCurrent = undefined;
  };
  stopCurrent = stop;
  const radiusAt = (progress: number) => Math.max(0.001, END_RADIUS * easeInOut(progress));
  show(radiusAt(0));

  transition = document.startViewTransition({
    types: [SWEEP_TYPE],
    update: () => {
      apply();
      if (stopped) return;
      down = before === "dark" && root.dataset.openbotColorScheme === "light";
      show(radiusAt(0));
      band.setDown(down);
      ripple.setDown(down);
      band.draw(radiusAt(0), 0, 0, 0);
      ripple.draw(radiusAt(0), 0);
      document.body.append(ripple.element, band.canvas);
    },
  });
  void transition.ready
    .then(() => {
      if (stopped) return;
      const clock = root.animate([{ opacity: 1 }, { opacity: 1 }], {
        duration: SWEEP_MS,
        pseudoElement: "::view-transition-new(root)",
      });
      const tick = () => {
        if (stopped) return;
        const elapsed = Number(clock.currentTime ?? 0);
        const progress = Math.min(1, elapsed / SWEEP_MS);
        const radius = radiusAt(progress);
        show(radius);
        band.draw(radius, progress, elapsed / 1000, sweepAlpha(progress));
        ripple.draw(radius, progress);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(stop);
  void transition.finished.finally(stop);
}

const RING_RIPPLE_ID = "theme-sweep-ring-ripple";
const RING_CREST = 0.12;
const RING_PUSH = 44;
const RING_IMAGE = 256;
const EDGE_BAND = 64;
const EDGE_BEND = 20;
const MAP_NEUTRAL = 128 / 255;

type RingDirection = "in" | "out";

function ringReach(direction: RingDirection): number {
  return 1 + (direction === "out" ? RIPPLE_AHEAD : RIPPLE_BEHIND) * RING_CREST;
}

function ringStill(direction: RingDirection): number {
  return 1 - (direction === "out" ? RIPPLE_BEHIND : RIPPLE_AHEAD) * RING_CREST;
}

const FILTER_PAD = Math.ceil(RING_PUSH * Math.max(ringReach("in"), ringReach("out")) * (1 + CHANNEL_SPREAD)) + 2;

type RingImages = [across: string, down: string, band: string];

function ringImages(direction: RingDirection): RingImages {
  const reach = ringReach(direction);
  const canvas = document.createElement("canvas");
  canvas.width = RING_IMAGE;
  canvas.height = RING_IMAGE;
  const context = canvas.getContext("2d");
  if (!context) return ["", "", ""];
  const half = RING_IMAGE / 2;
  const images = [0, 1, 2].map(() => context.createImageData(RING_IMAGE, RING_IMAGE));
  const [across, down, band] = images.map((image) => image.data);
  if (!across || !down || !band) return ["", "", ""];
  for (let row = 0; row < RING_IMAGE; row++) {
    for (let column = 0; column < RING_IMAGE; column++) {
      const radius = (Math.hypot(column + 0.5 - half, row + 0.5 - half) / half) * reach;
      const u = (direction === "out" ? radius - 1 : 1 - radius) / RING_CREST;
      const move = radius > reach ? 0 : 2 * rippleMove(u) - 1;
      const alpha = (row * RING_IMAGE + column) * 4 + 3;
      across[alpha] = Math.round((0.5 + (0.5 * move * (column + 0.5 - half)) / half) * 255);
      down[alpha] = Math.round((0.5 + (0.5 * move * (row + 0.5 - half)) / half) * 255);
      if (radius > reach) continue;
      band[alpha] = Math.round(Math.min(1, rippleBlur(u)) * 255);
    }
  }
  const urls = images.map((image) => {
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  });
  return [urls[0] ?? "", urls[1] ?? "", urls[2] ?? ""];
}

const ringImageCache = new Map<RingDirection, RingImages>();

interface RingRipple {
  element: SVGSVGElement;
  draw(radius: number, progress: number): void;
}

function edgeImage(vertical: boolean, length: number): string {
  const band = Math.min(EDGE_BAND, length / 4) / length;
  const steps = Array.from({ length: 9 }, (_, index) => index / 8);
  return gradientImage(vertical, [
    ...steps.map((t) => stop(t * band, 0.5 + 0.5 * (1 - t) ** 2)),
    ...steps.map((t) => stop(1 - band + t * band, 0.5 - 0.5 * t ** 2)),
  ]);
}

function ringArea(direction: RingDirection, x: number, y: number, radius: number, margin: number) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const box = radius * height * ringReach(direction);
  let left = Math.max(0, x - box);
  let top = Math.max(0, y - box);
  let right = Math.min(width, x + box);
  let bottom = Math.min(height, y + box);
  const still = Math.max(0, radius * height * ringStill(direction) - margin);
  const across = Math.sqrt(Math.max(0, still ** 2 - Math.max(y, height - y) ** 2));
  const down = Math.sqrt(Math.max(0, still ** 2 - Math.max(x, width - x) ** 2));
  if (x - across <= left) left = Math.max(left, Math.min(right, x + across));
  else if (x + across >= right) right = Math.min(right, Math.max(left, x - across));
  if (y - down <= top) top = Math.max(top, Math.min(bottom, y + down));
  else if (y + down >= bottom) bottom = Math.min(bottom, Math.max(top, y - down));
  return { box, left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function createRingRipple(direction: RingDirection, x: number, y: number): RingRipple {
  const images = ringImageCache.get(direction) ?? ringImages(direction);
  ringImageCache.set(direction, images);
  const element = svgElement("svg", { class: "theme-sweep-ripple", "aria-hidden": "true", width: "0", height: "0" });
  const filter = svgElement("filter", {
    id: RING_RIPPLE_ID,
    filterUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
  });
  const inArea: SVGElement[] = [];
  const step = <T extends SVGElement>(primitive: T): T => {
    inArea.push(primitive);
    return primitive;
  };
  const image = (href: string, result: string) => svgElement("feImage", { href, preserveAspectRatio: "none", result });
  const round = [image(images[0], "acrossRipple"), image(images[1], "downRipple"), image(images[2], "band")];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const edgeAcross = image(edgeImage(false, width), "edgeAcrossStrip");
  const edgeDown = image(edgeImage(true, height), "edgeDownStrip");
  for (const [strip, stripWidth, stripHeight] of [
    [edgeAcross, width, STRIP],
    [edgeDown, STRIP, height],
  ] as const) {
    strip.setAttribute("x", "0");
    strip.setAttribute("y", "0");
    strip.setAttribute("width", String(stripWidth));
    strip.setAttribute("height", String(stripHeight));
  }
  const bends = ["edgeAcross", "edgeDown"].map((input) =>
    step(
      svgElement("feComposite", {
        in: input,
        in2: "band",
        operator: "arithmetic",
        k4: String(MAP_NEUTRAL),
        result: `${input}Bend`,
      }),
    ),
  );
  const map = (ripple: string, bend: string, result: string) => [
    step(
      svgElement("feComposite", {
        in: ripple,
        in2: bend,
        operator: "arithmetic",
        k2: "1",
        k3: "1",
        k4: String(-MAP_NEUTRAL),
        result: `${result}Raw`,
      }),
    ),
    step(colorMatrix(`${result}Raw`, "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0", result)),
  ];
  const moves = ["movedRed", "moved", "movedBlue"].map((result) => {
    const shiftDown = svgElement("feOffset", { in: "SourceGraphic", result: `${result}SourceShifted` });
    const movedDown = step(
      svgElement("feDisplacementMap", {
        in: `${result}SourceShifted`,
        in2: "mapDown",
        xChannelSelector: "R",
        yChannelSelector: "A",
        result: `${result}Down`,
      }),
    );
    const shiftAcross = svgElement("feOffset", { in: `${result}Down`, result: `${result}DownShifted` });
    const movedAcross = step(
      svgElement("feDisplacementMap", {
        in: `${result}DownShifted`,
        in2: "mapAcross",
        xChannelSelector: "A",
        yChannelSelector: "R",
        result,
      }),
    );
    return { shiftDown, movedDown, shiftAcross, movedAcross, page: step(onSource(result, `${result}Page`)) };
  });

  const merge = svgElement("feMerge", {});
  merge.append(...["outside", "split"].map((input) => svgElement("feMergeNode", { in: input })));
  filter.append(
    ...round,
    edgeAcross,
    svgElement("feTile", { in: "edgeAcrossStrip", result: "edgeAcross" }),
    edgeDown,
    svgElement("feTile", { in: "edgeDownStrip", result: "edgeDown" }),
    ...bends,
    ...map("acrossRipple", "edgeAcrossBend", "mapAcross"),
    ...map("downRipple", "edgeDownBend", "mapDown"),
    ...moves.flatMap(({ shiftDown, movedDown, shiftAcross, movedAcross, page }) => [
      shiftDown,
      movedDown,
      shiftAcross,
      movedAcross,
      page,
    ]),
    ...splitChannels("movedRedPage", "movedPage", "movedBluePage", "split").map(step),
    step(svgElement("feFlood", { "flood-opacity": "1", result: "area" })),
    svgElement("feComposite", { in: "SourceGraphic", in2: "area", operator: "out", result: "outside" }),
    merge,
  );
  element.append(filter);
  const sign = direction === "out" ? -1 : 1;
  const reach = ringReach(direction);
  return {
    element,
    draw(radius, progress) {
      filter.setAttribute("x", String(-FILTER_PAD));
      filter.setAttribute("y", String(-FILTER_PAD));
      filter.setAttribute("width", String(window.innerWidth + 2 * FILTER_PAD));
      filter.setAttribute("height", String(window.innerHeight + 2 * FILTER_PAD));
      const strength = Math.sin(Math.PI * Math.min(1, progress));
      const halves = channelHalves(sign * RING_PUSH * reach * strength);
      const area = ringArea(direction, x, y, radius, 2 * Math.max(...halves.map(Math.abs)) + 2);
      const box = Math.max(1, area.box);
      for (const element of round) {
        element.setAttribute("x", (x - box).toFixed(1));
        element.setAttribute("y", (y - box).toFixed(1));
        element.setAttribute("width", (2 * box).toFixed(1));
        element.setAttribute("height", (2 * box).toFixed(1));
      }
      for (const primitive of inArea) {
        primitive.setAttribute("x", area.left.toFixed(1));
        primitive.setAttribute("y", area.top.toFixed(1));
        primitive.setAttribute("width", area.width.toFixed(1));
        primitive.setAttribute("height", area.height.toFixed(1));
      }
      for (const [index, { shiftDown, movedDown, shiftAcross, movedAcross }] of moves.entries()) {
        const half = halves[index] ?? 0;
        movedDown.setAttribute("scale", String(2 * half));
        movedAcross.setAttribute("scale", String(2 * half));
        shiftDown.setAttribute("dx", String(half));
        shiftAcross.setAttribute("dy", String(half));
        const left = area.left + Math.min(0, half);
        const top = area.top + Math.min(0, half);
        shiftDown.setAttribute("x", left.toFixed(1));
        shiftDown.setAttribute("y", area.top.toFixed(1));
        shiftDown.setAttribute("width", (area.width + Math.abs(half)).toFixed(1));
        shiftDown.setAttribute("height", area.height.toFixed(1));
        shiftAcross.setAttribute("x", area.left.toFixed(1));
        shiftAcross.setAttribute("y", top.toFixed(1));
        shiftAcross.setAttribute("width", area.width.toFixed(1));
        shiftAcross.setAttribute("height", (area.height + Math.abs(half)).toFixed(1));
      }
      const greenHalf = halves[1];
      const bend = greenHalf ? Math.min(0.5, Math.max(-0.5, (EDGE_BEND * strength) / (2 * greenHalf))) : 0;
      for (const element of bends) {
        element.setAttribute("k1", String(2 * bend));
        element.setAttribute("k3", String(-bend));
      }
    },
  };
}

const BEAM_MS = 1400;
const BEAM_DEADLINE_MS = BEAM_MS * 2;
const BEAM_SPREAD = 0.55;
const BEAM_ALPHA = 0.7;

let stopBeam: (() => void) | undefined;

export function beam(element: Element, direction: RingDirection): Promise<void> | null {
  stopBeam?.();
  if (!canAnimate()) return null;
  const band = createBand("theme-sweep-beam");
  if (!band) return null;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const corner = Math.max(
    Math.hypot(x, y),
    Math.hypot(width - x, y),
    Math.hypot(x, height - y),
    Math.hypot(width - x, height - y),
  );
  const endRadius = (corner / height + 2 * BEHIND * BEAM_SPREAD) / 0.86;
  band.setCircle(x, y, BEAM_SPREAD);
  const ripple = createRingRipple(direction, x, y);

  let frame = 0;
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  const body = document.body.style;
  const previousFilter = [body.getPropertyValue("filter"), body.getPropertyPriority("filter")] as const;
  let deadline = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(deadline);
    body.setProperty("filter", ...previousFilter);
    ripple.element.remove();
    band.dispose();
    if (stopBeam === stop) stopBeam = undefined;
    end();
  };
  stopBeam = stop;
  let start: number | undefined;
  const tick = (now: number) => {
    start ??= now;
    const elapsed = Math.max(0, now - start);
    const progress = Math.min(1, elapsed / BEAM_MS);
    const forward = direction === "out" ? progress : 1 - progress;
    const reach = easeInOut(forward);
    const radius = Math.max(0.001, endRadius * reach);
    const alpha = BEAM_ALPHA * smoothstep(0.03, 0.18, radius) * (1 - smoothstep(0.75, 1, forward));
    band.draw(radius, progress, elapsed / 1000, alpha);
    ripple.draw(radius, progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else stop();
  };
  band.draw(0.001, 0, 0, 0);
  ripple.draw(direction === "out" ? 0.001 : endRadius, 0);
  document.documentElement.append(ripple.element, band.canvas);
  body.setProperty("filter", `url("#${RING_RIPPLE_ID}")`);
  frame = requestAnimationFrame(tick);
  deadline = window.setTimeout(stop, BEAM_DEADLINE_MS);
  return ended;
}
