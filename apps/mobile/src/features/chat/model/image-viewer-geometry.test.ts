import { describe, expect, it } from "vitest";
import {
  coverSize,
  dragFade,
  dragScale,
  fitWithin,
  focalTranslation,
  hitsRect,
  panBound,
  rubberBandClamp,
  shouldDismiss,
} from "./image-viewer-geometry";

describe("image viewer geometry", () => {
  it("fits the whole photo inside the inset box and covers a frame on the way there", () => {
    const box = { x: 16, y: 75, width: 358, height: 694 };
    expect(fitWithin({ width: 1600, height: 900 }, box)).toEqual({ x: 16, y: 321.3125, width: 358, height: 201.375 });
    // A thumbnail cropped square still shows the full wide picture, cut at the sides.
    expect(coverSize({ width: 1600, height: 900 }, { width: 100, height: 100 })).toEqual({
      width: 177.77777777777777,
      height: 100,
    });
  });

  it("closes on a flick or a long drag, and not on a drag thrown back to the centre", () => {
    expect(shouldDismiss(40, 900)).toBe(true);
    expect(shouldDismiss(-130, 0)).toBe(true);
    expect(shouldDismiss(60, 0)).toBe(false);
    expect(shouldDismiss(80, -1200)).toBe(false);
  });

  it("lets the backdrop and the photo recede with the drag, within their limits", () => {
    expect(dragFade(0, 800)).toBe(1);
    expect(dragFade(800, 800)).toBeCloseTo(0.15);
    expect(dragScale(800, 800)).toBeCloseTo(0.8);
    expect(dragScale(4000, 800)).toBeCloseTo(0.8);
  });

  it("keeps a zoomed photo's edges on the screen and the pinched point under the fingers", () => {
    expect(panBound(358, 1, 390)).toBe(0);
    expect(panBound(358, 2.5, 390)).toBe(252.5);
    expect(focalTranslation(100, 100, 1, 2.5)).toBe(-150);
    expect(rubberBandClamp(3, 1, 4, 4)).toBe(3);
    const stretched = rubberBandClamp(6, 1, 4, 4);
    expect(stretched).toBeGreaterThan(4);
    expect(stretched).toBeLessThan(6);
  });

  it("tells a tap on the photo from a tap beside it, at any zoom", () => {
    const fit = { x: 16, y: 300, width: 358, height: 200 };
    expect(hitsRect(195, 400, fit, 1, 0, 0)).toBe(true);
    expect(hitsRect(195, 200, fit, 1, 0, 0)).toBe(false);
    expect(hitsRect(195, 200, fit, 2.5, 0, 0)).toBe(true);
  });
});
