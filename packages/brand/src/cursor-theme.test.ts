import { describe, expect, it } from "vitest";
import { type CursorThemeSource, openbotCursorThemeSource } from "./cursor-theme";

// What `cua-cursor-theme build` refuses. The compiler runs only at packaging time, so these are
// checked here: a broken edit would otherwise reach a release build before anything said so.
describe("openbotCursorThemeSource", () => {
  const source = openbotCursorThemeSource();
  /** How far a rounded corner opens from the corner it replaces, in canvas units. */
  const CORNER_WIDTH = 9;

  it("draws on the canvas the driver profile fixes", () => {
    expect(source["cua/theme.json"].canvas).toEqual({ width: 128, height: 128, fps: 30 });
    for (const animation of [source["a/pointer.json"], source["a/pulse.json"]]) {
      expect([animation.w, animation.h, animation.fr]).toEqual([128, 128, 30]);
    }
  });

  it("points at a place inside the canvas, which is where the click lands", () => {
    const { hotspot, canvas } = source["cua/theme.json"];
    expect(hotspot.x).toBeLessThan(canvas.width);
    expect(hotspot.y).toBeLessThan(canvas.height);
  });

  // The driver holds a fixed point of the canvas over the target and does not read the hotspot, so
  // the drawing is what puts the tip on the button. A tip that leaves that point is a cursor the
  // user sees miss what it presses, and nothing else in the build says so.
  it("draws the tip of every arrow on the hotspot", () => {
    const { hotspot } = source["cua/theme.json"];
    for (const animation of [source["a/pointer.json"], source["a/pulse.json"]]) {
      const arrow = animation.layers.find((layer) => layer.nm === "arrow");
      expect(arrow?.ks.p.k).toEqual([hotspot.x, hotspot.y, 0]);
      const points = arrow?.shapes.find((shape) => shape.ty === "sh")?.ks.k.v ?? [];
      // The tip corner is rounded, so the path opens a corner's width away from the origin and the
      // outline carries the drawing back over it. Nothing may cross to the other side.
      expect(Math.min(...points.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(CORNER_WIDTH);
      for (const [x, y] of points) {
        expect(Math.min(x, y)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // The canvas is the whole drawing surface: the driver fixes it at 128 by 128 and refuses any
  // other size, so a shape that grows past an edge is cut off rather than drawn smaller. Nothing
  // in the build reports that; the compiler accepts the theme and the cursor loses a wing.
  it("keeps every drawing, and the room its outline takes, inside the canvas", () => {
    const { width, height } = source["cua/theme.json"].canvas;
    for (const animation of [source["a/pointer.json"], source["a/pulse.json"]]) {
      for (const layer of animation.layers) {
        const box = drawnBox(layer);
        expect({ layer: layer.nm, inside: box.left >= 0 && box.top >= 0 }).toEqual({
          layer: layer.nm,
          inside: true,
        });
        expect({ layer: layer.nm, inside: box.right <= width && box.bottom <= height }).toEqual({
          layer: layer.nm,
          inside: true,
        });
      }
    }
  });

  it("gives each action an animation the archive carries", () => {
    const named = new Set(source["manifest.json"].animations.map((entry) => entry.id));
    for (const action of Object.values(source["cua/theme.json"].actions)) {
      expect(named).toContain(action.animation);
      expect(Object.keys(source)).toContain(`a/${action.animation}.json`);
    }
  });
});

/** One layer's drawn box, from its own shapes, its outline and its own transform. */
function drawnBox(layer: CursorLayer): { left: number; top: number; right: number; bottom: number } {
  const stroke = layer.shapes.find((shape) => shape.ty === "st");
  const margin = stroke ? stroke.w.k / 2 : 0;
  const corners = layer.shapes.flatMap((shape) => shapeCorners(shape));
  const [scaleX, scaleY] = largestScale(layer.ks.s);
  const anchor = layer.ks.a.k;
  const position = layer.ks.p.k;
  const xs = corners.map(([x]) => position[0] + (x - anchor[0]) * scaleX);
  const ys = corners.map(([, y]) => position[1] + (y - anchor[1]) * scaleY);
  return {
    left: Math.min(...xs) - margin * scaleX,
    top: Math.min(...ys) - margin * scaleY,
    right: Math.max(...xs) + margin * scaleX,
    bottom: Math.max(...ys) + margin * scaleY,
  };
}

/** The corners a shape reaches, in the coordinates of the layer that carries it. */
function shapeCorners(shape: CursorShape): readonly (readonly number[])[] {
  if (shape.ty === "sh") return shape.ks.k.v;
  if (shape.ty !== "el") return [];
  const [x, y] = shape.p.k;
  const [w, h] = shape.s.k;
  return [
    [x - w / 2, y - h / 2],
    [x + w / 2, y + h / 2],
  ];
}

/** The widest a layer grows, because a keyframed scale is drawn at every value between its ends. */
function largestScale(scale: CursorLayer["ks"]["s"]): readonly [number, number] {
  const steps = scale.a === 0 ? [scale.k] : scale.k.flatMap((frame) => [frame.s, frame.e ?? frame.s]);
  return [Math.max(...steps.map((step) => step[0])) / 100, Math.max(...steps.map((step) => step[1])) / 100];
}

type CursorLayer = CursorThemeSource["a/pointer.json"]["layers"][number];
type CursorShape = CursorLayer["shapes"][number];
