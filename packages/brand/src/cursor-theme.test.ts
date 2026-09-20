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

  it("gives each action an animation the archive carries", () => {
    const named = new Set(source["manifest.json"].animations.map((entry) => entry.id));
    for (const action of Object.values(source["cua/theme.json"].actions)) {
      expect(named).toContain(action.animation);
      expect(Object.keys(source)).toContain(`a/${action.animation}.json`);
    }
  });
});
