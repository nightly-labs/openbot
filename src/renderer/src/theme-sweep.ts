import { prefersReducedMotion } from "@openbot/ui/utils";

/**
 * A theme change as a soft wash of brand colors that moves across the window, as glimm does it. A
 * change from dark to light goes down from the top; other changes go up from the bottom. The old
 * theme stays on screen as the view transition's old picture. The new theme shows under the wash
 * through a mask on the new picture, and a ripple moves through the root under the wash. A WebGL canvas
 * draws the wash. It joins the transition as its own named element above the root, so it is live
 * while the pictures are still images.
 *
 * The wash front is the edge of an ellipse at the bottom (or top) middle of the window, and the masks in
 * `styles/theme-sweep.css` use the same ellipse, so the front and the mask stay together. An SVG
 * filter on the root's pictures makes the ripple on the same curve. Only the band at the front
 * moves; the rest of the interface stays in place.
 *
 * Without the View Transition API or WebGL, with reduced motion, or in a hidden window, the theme
 * changes at once.
 *
 * `beam` draws the same wash as a ring that closes in on one element or spreads out from it, to mark
 * the start of an action. It does not use a view transition, so the interface under it stays live and does not move.
 */

/** The view transition type that `styles/theme-sweep.css` selects. */
const SWEEP_TYPE = "theme-sweep";
const SWEEP_MS = 1200;
/** How far the wash reaches, as parts of the window height: in front of its front and after it. */
const AHEAD = 0.14;
const BEHIND = 0.32;
/** The new theme starts to show `REVEAL_LAG` after the front, and is whole `REVEAL` after that. */
const REVEAL_LAG = 0.03;
const REVEAL = 0.14;
/**
 * The vertical radius of the front's ellipse at the end. The front is lower at the sides of the
 * window (0.87 of the radius), and the wash after it must leave the window there too.
 */
const END_RADIUS = (1 + BEHIND * 2) / 0.86;
/** The SVG filter that `styles/theme-sweep.css` puts on the root's pictures. */
const RIPPLE_ID = "theme-sweep-ripple";
/** The crest's width, as a part of the window height. */
const CREST = 0.09;
/** At the crest the pictures move this far ahead, in CSS pixels; in the trough after it, back. */
const PUSH = 22;
const PULL = 8;
/** At the sides of the window the move is this many times the move at the middle. */
const EDGE_GAIN = 2.2;
/** The blur after the crest, and the color split at it, in CSS pixels. */
const BLUR = 9;
const SPLIT = 2;
/** The ripple's extent, in crest widths from the front: ahead of it, and after it. */
const RIPPLE_AHEAD = 4;
const RIPPLE_BEHIND = 6;
/** How much lower the front is at the sides of the window than at the middle, as a part of the radius. */
const ARCH_DROP = 1 - Math.sqrt(0.75);
/** The farthest the arch reads the ripple's images, in window heights, with a small margin. */
const ARCH_REACH = Math.ceil(ARCH_DROP * END_RADIUS * 100) / 100 + 0.02;

/** An SVG image of one gradient, stretched over the filter primitive's box. */
function gradientImage(vertical: boolean, stops: string[]): string {
  const size = vertical ? "x2='0' y2='1'" : "x2='1' y2='0'";
  return `data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
      `<linearGradient id='g' ${size}>${stops.join("")}</linearGradient>` +
      "<rect width='100' height='100' fill='url(#g)'/></svg>",
  )}`;
}

/**
 * One gradient stop, from 0 to 1 as opacity. The filter reads the opacity as a number. The color is
 * not safe for that, because the display's color profile changes it, so every stop is black.
 */
function stop(offset: number, value: number): string {
  return `<stop offset='${offset.toFixed(4)}' stop-opacity='${Math.min(1, Math.max(0, value)).toFixed(4)}'/>`;
}

/** The ripple's images are this many window heights tall, with the front at their middle. */
const RIPPLE_SPAN = 4;
/** The thickness of each image strip, in pixels. */
const STRIP = 4;

/**
 * Stops along the ripple, from ahead of the front to after it, in crest widths `u`. Ahead is up, or
 * down for a sweep that goes down.
 */
function rippleImage(value: (u: number) => number, outside: number, down: boolean): string {
  const steps = Array.from({ length: 61 }, (_, index) => RIPPLE_AHEAD - (index / 60) * (RIPPLE_AHEAD + RIPPLE_BEHIND));
  const ahead = down ? 1 : -1;
  const stops = steps.map((u) => ({ offset: 0.5 + (ahead * u * CREST) / RIPPLE_SPAN, value: value(u) }));
  // Gradient stops must go from top to bottom.
  if (down) stops.reverse();
  return gradientImage(true, [
    stop(0, outside),
    ...stops.map(({ offset, value }) => stop(offset, value)),
    stop(1, outside),
  ]);
}

/** The move: above one half moves the pictures ahead, below one half back. */
function rippleMove(u: number): number {
  const crest = Math.exp(-u * u);
  const trough = Math.exp(-(((u + 2.6) / 1.4) ** 2));
  return 0.5 + (0.5 * (crest * PUSH - trough * PULL)) / PUSH;
}

/** The blur. It is strongest just after the crest. */
function rippleBlur(u: number): number {
  return Math.exp(-(((u * 0.5 + 0.2) / 0.9) ** 2));
}

/** The move and blur images, for a sweep that goes up and for one that goes down. */
const RIPPLE_IMAGES = {
  up: [rippleImage(rippleMove, 0.5, false), rippleImage(rippleBlur, 0, false)],
  down: [rippleImage(rippleMove, 0.5, true), rippleImage(rippleBlur, 0, true)],
} as const;

/**
 * The arch, across the window: one at the middle and one half at the sides. The images are placed
 * at the front's height at the sides, and the arch moves them toward the ellipse's center at the
 * middle, so the ripple follows the front's curve. The bend also moves the images across by the same
 * amount, which does not change them. Because the bend is zero at the sides, it never reads past the
 * filter's left or right edge, where the images are empty.
 */
const RIPPLE_ARCH = gradientImage(
  false,
  Array.from({ length: 41 }, (_, index) => {
    const offset = index / 40;
    const across = offset - 0.5;
    return stop(offset, 1 - (0.5 * (1 - Math.sqrt(1 - across * across))) / ARCH_DROP);
  }),
);

/** The move's strength across the window: zero at the middle and one at the sides. */
const RIPPLE_EDGE = gradientImage(
  false,
  Array.from({ length: 41 }, (_, index) => stop(index / 40, (index / 20 - 1) ** 2)),
);
/** The canvas draws at most this many device pixels for each CSS pixel. The wash is soft. */
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

// The spectrum: a cosine palette whose hue goes once around the color wheel for each whole step of t.
vec3 spectrum(float t) {
  return vec3(0.74, 0.72, 0.76) + vec3(0.5, 0.52, 0.48) * cos(6.28318 * (t + vec3(0.92, 0.25, 0.58)));
}

// Each color is mixed with its neighbors, so the hues flow into each other instead of making lanes.
vec3 washColor(float t) {
  return spectrum(t) * 0.5 + spectrum(t - 0.18) * 0.25 + spectrum(t + 0.18) * 0.25;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time;
  // Distance from the front in window heights: in front of it above zero, after it below.
  float s;
  // The ring's colors also change around it.
  float around = 0.0;
  if (u_circle > 0.5) {
    // A ring around the origin. Its front breathes around the circle as it grows.
    vec2 p = (gl_FragCoord.xy - u_origin) / u_resolution.y;
    float angle = atan(p.y, p.x);
    float ring = u_radius * (1.0 + 0.08 * sin(angle * 5.0 - t * 3.2) + 0.04 * sin(angle * 11.0 + t * 4.1)
      + 0.02 * sin(angle * 23.0 - t * 5.3));
    s = length(p) - ring;
    // Near the origin the angle changes fast, so the colors around it fade out there: they would make spokes.
    around = 0.3 * smoothstep(0.05, 0.4, u_radius) * sin(angle * 3.0 + t * 1.5);
  } else {
    // The ellipse's center is at the bottom, or at the top for a sweep that goes down.
    if (u_down > 0.5) uv.y = 1.0 - uv.y;
    // The front bends and breathes as it rises.
    float x = uv.x - 0.5 + 0.05 * sin(uv.y * 6.0 + t * 2.5) + 0.02 * sin(uv.y * 13.0 - t * 3.6);
    float radius = u_radius * (1.0 + 0.08 * sin(uv.x * 7.0 - t * 3.2) + 0.04 * sin(uv.x * 15.0 + t * 4.1)
      + 0.02 * sin(uv.x * 29.0 - t * 5.3));
    float k = length(vec2(x, uv.y / max(radius, 0.001)));
    s = (k - 1.0) * u_radius;
  }
  float reach = (s > 0.0 ? AHEAD : BEHIND) * u_spread;
  float alpha = exp(-(s * s) / (reach * reach)) * u_alpha;

  // The front shows the later colors, so the wash changes color as it climbs.
  vec2 warp = uv + 0.08 * vec2(sin(uv.y * 5.0 + t * 1.7), sin(uv.x * 6.0 - t * 2.1));
  float hue = u_progress * 0.75 + s * 0.9 + around + 0.1 * sin(warp.x * 7.0 + warp.y * 4.0 + t * 2.0);
  vec3 color = clamp(washColor(hue), 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

interface Band {
  canvas: HTMLCanvasElement;
  setDown(down: boolean): void;
  /** Makes the wash a ring around a point in CSS pixels, `spread` times as wide as the sweep's wash. */
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

/** The wash canvas, or null when this window has no WebGL. */
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
      // The canvas counts from its bottom left corner.
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

/** The sweep's wash opacity. It fades in at the start. */
function sweepAlpha(progress: number): number {
  return 0.8 * smoothstep(0, 0.12, progress);
}

/** A gradient stop at `offset` window heights from the front, as a part of the ellipse's radius. */
function maskStop(radius: number, offset: number): string {
  return `${Math.max(0, 1 + offset / radius) * 100}%`;
}

/** The mask values that `styles/theme-sweep.css` reads, for a front at `radius`. */
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

/** An SVG element with these attributes. */
function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/**
 * The ripple filter, as glimm's page ripple: the pictures move ahead at the crest and back in the
 * trough after it, blur after the crest, and split their colors at it. Outside the ripple the
 * filter shows the pictures as they are, so the interface does not move there.
 */
function createRipple(): Ripple {
  const matrix = (input: string, values: string, result: string) =>
    svgElement("feColorMatrix", { in: input, type: "matrix", values, result });
  const composite = (input: string, mask: string, result: string) =>
    svgElement("feComposite", { in: input, in2: mask, operator: "in", result });
  const element = svgElement("svg", { class: "theme-sweep-ripple", "aria-hidden": "true", width: "0", height: "0" });
  const filter = svgElement("filter", {
    id: RIPPLE_ID,
    // Each step's result is cut to this region. At the middle the arch reads the ripple's images
    // past the window's far edge, by up to ARCH_DROP times END_RADIUS window heights, so they must
    // exist there too. The move takes the pictures to the left before it puts them back.
    x: "-0.1",
    y: "0",
    width: "1.2",
    height: String(1 + ARCH_REACH),
    "color-interpolation-filters": "sRGB",
  });
  // Each image changes in one direction only. A thin strip of it repeats across the window, because
  // the filter's time grows with the area of its images.
  const image = (href: string, result: string) =>
    svgElement("feImage", { href, preserveAspectRatio: "none", x: "0", y: "0", result: `${result}Strip` });
  const tile = (result: string) => svgElement("feTile", { in: `${result}Strip`, result });
  // The images are the same across the window, so the bend can move them across too.
  const bend = (input: string, result: string) =>
    svgElement("feDisplacementMap", { in: input, in2: "arch", xChannelSelector: "A", yChannelSelector: "A", result });
  const images = [image(RIPPLE_IMAGES.up[0], "moveImage"), image(RIPPLE_IMAGES.up[1], "blurImage")];
  let ahead = -1;
  const arch = image(RIPPLE_ARCH, "arch");
  const edge = image(RIPPLE_EDGE, "edge");
  // The ripple's distance from one half, times the strength across the window, which goes from
  // 1 / EDGE_GAIN at the middle to 1 at the sides.
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

  // The display's color profile changes a map's colors before the move reads them, but not its
  // opacity or white. So the move reads the opacity for up and down, and white for across. White
  // moves the pictures half the scale to the left, and the offset after it puts them back.
  const moved = svgElement("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "map",
    xChannelSelector: "R",
    yChannelSelector: "A",
    result: "movedLeft",
  });
  const back = svgElement("feOffset", { in: "movedLeft", dy: "0", result: "moved" });
  const blurred = svgElement("feGaussianBlur", { in: "moved", result: "blurred" });
  const shifted = svgElement("feOffset", { in: "moved", dx: "0", result: "shifted" });
  // Outside the ripple the map is exactly one half, so the moved pictures are the pictures as they
  // are. Under them, the pictures fill what the move takes in from outside the window.
  const merge = svgElement("feMerge", {});
  merge.append(
    ...["SourceGraphic", "moved", "splitCrest", "blurredBand"].map((input) => svgElement("feMergeNode", { in: input })),
  );
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
    matrix("edgeRipple", "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0", "map"),
    moved,
    back,
    // The color split: red from a picture moved ahead, green and blue from the moved picture. It
    // shows where the move is ahead, which is the crest.
    shifted,
    matrix("shifted", "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", "red"),
    matrix("moved", "0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0", "greenBlue"),
    svgElement("feComposite", {
      in: "red",
      in2: "greenBlue",
      operator: "arithmetic",
      k2: "1",
      k3: "1",
      result: "split",
    }),
    matrix("ripple", "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2 -1.01", "crest"),
    composite("split", "crest", "splitCrest"),
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
      // The arch reads the images on the side away from the ellipse's center.
      filter.setAttribute("y", down ? String(-ARCH_REACH) : "0");
    },
    draw(radius, progress) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // The ripple is strongest in the middle of the sweep and fades at its start and end.
      const strength = Math.sin(Math.PI * Math.min(1, progress));
      // The front is at `radius` from the bottom at the middle of the window, or from the top.
      const front = ahead > 0 ? height * radius : height * (1 - radius);
      const archScale = 2 * ARCH_DROP * radius * height;
      // The front at the sides of the window, where the arch does not move the images.
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
      // A whole number of pixels, so the offset back does not blur the pictures.
      const half = -ahead * Math.round(PUSH * EDGE_GAIN * strength);
      moved.setAttribute("scale", String(2 * half));
      back.setAttribute("dx", String(half));
      shifted.setAttribute("dy", (ahead * SPLIT * strength).toFixed(2));
      blurred.setAttribute("stdDeviation", (BLUR * strength).toFixed(2));
    },
  };
}

/** False in a hidden window or with reduced motion. */
function canAnimate(): boolean {
  return document.visibilityState === "visible" && !prefersReducedMotion();
}

/** The sweep that is on screen, so a newer change stops its frame loop. */
let stopCurrent: (() => void) | undefined;

/** Runs `apply`, which changes the theme, behind a wash that moves across the window. */
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
  // A change from dark to light goes down the window, as light falls from above. Others go up.
  const before = root.dataset.openbotColorScheme;
  let down = false;
  const show = (radius: number) => {
    for (const [name, value] of Object.entries(sweepProperties(radius, down))) root.style.setProperty(name, value);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // A newer change can stop this sweep before its transition ends. The page then shows itself at once.
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
      // A skipped transition still runs its update. A stopped sweep adds nothing to the page.
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
      // Every picture's own animation is off, so this one keeps the transition open for the sweep,
      // and its clock moves the masks and the wash together.
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

/** The SVG filter that `beam` puts on the live page while a ring is on screen. */
const RING_RIPPLE_ID = "theme-sweep-ring-ripple";
/** The ring ripple's crest width, as a part of the ring's radius. */
const RING_CREST = 0.12;
/** At the crest the page moves this far ahead of the ring, in CSS pixels, at most. */
const RING_PUSH = 44;
/** The size of the ring ripple's images, in pixels. They are scaled to the ring. */
const RING_IMAGE = 256;

type RingDirection = "in" | "out";

/** How far the ring ripple's images reach, as parts of the ring's radius. */
function ringReach(direction: RingDirection): number {
  return 1 + (direction === "out" ? RIPPLE_AHEAD : RIPPLE_BEHIND) * RING_CREST;
}

/**
 * Round images of the ring ripple as opacity, with the ring at the middle of their radius: the push
 * ahead, the pull back, and the blur. Each is zero at its corners, so the filter can leave the part
 * of the window outside them as it is. A canvas makes them, because an SVG gradient cannot hold the
 * ripple's shape around a circle.
 */
function ringImages(direction: RingDirection): [string, string, string] {
  const reach = ringReach(direction);
  const canvas = document.createElement("canvas");
  canvas.width = RING_IMAGE;
  canvas.height = RING_IMAGE;
  const context = canvas.getContext("2d");
  if (!context) return ["", "", ""];
  const half = RING_IMAGE / 2;
  const images = [0, 1, 2].map(() => context.createImageData(RING_IMAGE, RING_IMAGE));
  const [push, pull, blur] = images.map((image) => image.data);
  if (!push || !pull || !blur) return ["", "", ""];
  for (let row = 0; row < RING_IMAGE; row++) {
    for (let column = 0; column < RING_IMAGE; column++) {
      const radius = (Math.hypot(column + 0.5 - half, row + 0.5 - half) / half) * reach;
      if (radius > reach) continue;
      // Crest widths from the ring; ahead is outward for "out" and inward for "in".
      const u = (direction === "out" ? radius - 1 : 1 - radius) / RING_CREST;
      const move = 2 * rippleMove(u) - 1;
      const alpha = (row * RING_IMAGE + column) * 4 + 3;
      push[alpha] = Math.round(Math.min(1, Math.max(0, move)) * 255);
      pull[alpha] = Math.round(Math.min(1, Math.max(0, -move)) * 255);
      blur[alpha] = Math.round(Math.min(1, rippleBlur(u)) * 255);
    }
  }
  const urls = images.map((image) => {
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  });
  return [urls[0] ?? "", urls[1] ?? "", urls[2] ?? ""];
}

const ringImageCache = new Map<RingDirection, [string, string, string]>();

interface RingRipple {
  element: SVGSVGElement;
  draw(radius: number, progress: number): void;
}

/**
 * The ripple around a ring, as the theme sweep's ripple: the page moves ahead at the crest and back in
 * the trough after it, and blurs after the crest. The move goes along the ring's radius. Outside the
 * ripple the filter shows the page as it is.
 */
function createRingRipple(direction: RingDirection, x: number, y: number): RingRipple {
  const images = ringImageCache.get(direction) ?? ringImages(direction);
  ringImageCache.set(direction, images);
  const reach = ringReach(direction);
  const element = svgElement("svg", { class: "theme-sweep-ripple", "aria-hidden": "true", width: "0", height: "0" });
  const filter = svgElement("filter", {
    id: RING_RIPPLE_ID,
    filterUnits: "userSpaceOnUse",
    x: "0",
    y: "0",
    "color-interpolation-filters": "sRGB",
  });
  const image = (href: string, result: string) => svgElement("feImage", { href, preserveAspectRatio: "none", result });
  const round = [image(images[0], "push"), image(images[1], "pull"), image(images[2], "blurBand")];
  // Strips that go from 0 to 1 across the ripple's box, left to right and top to bottom.
  const across = image(gradientImage(false, [stop(0, 0), stop(1, 1)]), "acrossStrip");
  const down = image(gradientImage(true, [stop(0, 0), stop(1, 1)]), "downStrip");
  // The ripple as one half plus the push less the pull. Outside its images both are zero.
  const ripple = svgElement("feComposite", {
    in: "push",
    in2: "pull",
    operator: "arithmetic",
    k2: "0.5",
    k3: "-0.5",
    k4: "0.5",
    result: "ripple",
  });
  // Each map is one half plus the ripple times the distance from the ring's center along one axis.
  const axis = (input: string, result: string) =>
    svgElement("feComposite", {
      in: "ripple",
      in2: input,
      operator: "arithmetic",
      k1: "2",
      k2: "-1",
      k3: "-1",
      k4: "1",
      result,
    });
  const white = (input: string, result: string) =>
    svgElement("feColorMatrix", {
      in: input,
      type: "matrix",
      values: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0",
      result,
    });
  // White moves the page half the scale on the other axis, and each offset puts it back.
  const movedDown = svgElement("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "mapDown",
    xChannelSelector: "R",
    yChannelSelector: "A",
    result: "movedDownShifted",
  });
  const backDown = svgElement("feOffset", { in: "movedDownShifted", result: "movedDown" });
  const movedAcross = svgElement("feDisplacementMap", {
    in: "movedDown",
    in2: "mapAcross",
    xChannelSelector: "A",
    yChannelSelector: "R",
    result: "movedShifted",
  });
  const backAcross = svgElement("feOffset", { in: "movedShifted", result: "moved" });
  const blurred = svgElement("feGaussianBlur", { in: "moved", result: "blurred" });
  const merge = svgElement("feMerge", {});
  merge.append(...["SourceGraphic", "moved", "blurredRing"].map((input) => svgElement("feMergeNode", { in: input })));
  filter.append(
    ...round,
    across,
    svgElement("feTile", { in: "acrossStrip", result: "across" }),
    down,
    svgElement("feTile", { in: "downStrip", result: "down" }),
    ripple,
    axis("across", "acrossRaw"),
    axis("down", "downRaw"),
    white("acrossRaw", "mapAcross"),
    white("downRaw", "mapDown"),
    movedDown,
    backDown,
    movedAcross,
    backAcross,
    blurred,
    svgElement("feComposite", { in: "blurred", in2: "blurBand", operator: "in", result: "blurredRing" }),
    merge,
  );
  element.append(filter);
  // Ahead is outward for "out": the page at the crest moves away from the center.
  const sign = direction === "out" ? -1 : 1;
  return {
    element,
    draw(radius, progress) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      filter.setAttribute("width", String(width));
      filter.setAttribute("height", String(height));
      for (const result of [ripple]) {
        result.setAttribute("x", "0");
        result.setAttribute("y", "0");
        result.setAttribute("width", String(width));
        result.setAttribute("height", String(height));
      }
      const box = Math.max(1, radius * height * reach);
      for (const element of round) {
        element.setAttribute("x", (x - box).toFixed(1));
        element.setAttribute("y", (y - box).toFixed(1));
        element.setAttribute("width", (2 * box).toFixed(1));
        element.setAttribute("height", (2 * box).toFixed(1));
      }
      across.setAttribute("x", (x - box).toFixed(1));
      across.setAttribute("y", "0");
      across.setAttribute("width", (2 * box).toFixed(1));
      across.setAttribute("height", String(STRIP));
      down.setAttribute("x", "0");
      down.setAttribute("y", (y - box).toFixed(1));
      down.setAttribute("width", String(STRIP));
      down.setAttribute("height", (2 * box).toFixed(1));
      // The ripple is strongest in the middle of the ring's path and fades at its start and end. The
      // axis distance is a part of the box, so the scale grows with `reach` to give RING_PUSH at the ring.
      const strength = Math.sin(Math.PI * Math.min(1, progress));
      // A whole number of pixels, so the offsets back do not blur the page.
      const half = sign * Math.round(RING_PUSH * reach * strength);
      for (const moved of [movedDown, movedAcross]) moved.setAttribute("scale", String(2 * half));
      backDown.setAttribute("dx", String(half));
      backAcross.setAttribute("dy", String(half));
      blurred.setAttribute("stdDeviation", (BLUR * strength).toFixed(2));
    },
  };
}

const BEAM_MS = 1400;
/** The ring's width, as a part of the sweep's wash, and its opacity. */
const BEAM_SPREAD = 0.55;
const BEAM_ALPHA = 0.7;

/** The ring that is on screen, so a newer one stops its frame loop. */
let stopBeam: (() => void) | undefined;

/**
 * Draws the wash as a ring around `element`. With "in" it comes from outside the window and closes in
 * on the element; with "out" it spreads out from the element and leaves the window. Returns false when
 * no ring plays, such as with reduced motion.
 */
export function beam(element: Element, direction: RingDirection): boolean {
  stopBeam?.();
  if (!canAnimate()) return false;
  const band = createBand("theme-sweep-beam");
  if (!band) return false;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const width = window.innerWidth;
  const height = window.innerHeight;
  // The ring ends past the farthest corner, with its wash after it, and with room for its waves.
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
  // An inline filter, because other code (such as Storybook's vision simulator) sets the body's filter inline.
  const body = document.body.style;
  const previousFilter = [body.getPropertyValue("filter"), body.getPropertyPriority("filter")] as const;
  const stop = () => {
    cancelAnimationFrame(frame);
    body.setProperty("filter", ...previousFilter);
    ripple.element.remove();
    band.dispose();
    if (stopBeam === stop) stopBeam = undefined;
  };
  stopBeam = stop;
  const start = performance.now();
  const tick = (now: number) => {
    const elapsed = Math.max(0, now - start);
    const progress = Math.min(1, elapsed / BEAM_MS);
    // "out" is "in" played backwards, so both ways have the same speed and the same fade.
    const forward = direction === "out" ? progress : 1 - progress;
    const reach = easeInOut(forward);
    const radius = Math.max(0.001, endRadius * reach);
    // The wash is gone before it gets to the element, so it does not paint over it.
    const alpha = BEAM_ALPHA * smoothstep(0.03, 0.18, radius) * (1 - smoothstep(0.75, 1, forward));
    band.draw(radius, progress, elapsed / 1000, alpha);
    ripple.draw(radius, progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else stop();
  };
  band.draw(0.001, 0, 0, 0);
  ripple.draw(direction === "out" ? 0.001 : endRadius, 0);
  // The filter is on the body, so the wash and the filter stay outside it.
  document.documentElement.append(ripple.element, band.canvas);
  body.setProperty("filter", `url("#${RING_RIPPLE_ID}")`);
  frame = requestAnimationFrame(tick);
  return true;
}
