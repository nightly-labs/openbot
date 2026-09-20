import { describe, expect, it } from "vitest";
import { openbotCursorThemeSource } from "./cursor-theme";

// What `cua-cursor-theme build` refuses. The compiler runs only at packaging time, so these are
// checked here: a broken edit would otherwise reach a release build before anything said so.
describe("openbotCursorThemeSource", () => {
  const source = openbotCursorThemeSource();

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
      const tip = arrow?.shapes.find((shape) => shape.ty === "sh")?.ks.k.v[0];
      expect(tip).toEqual([0, 0]);
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
