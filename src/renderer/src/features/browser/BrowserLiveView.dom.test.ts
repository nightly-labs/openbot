import { mapBrowserViewPoint } from "@openbot/ui/features/browser/BrowserLiveView";
import { describe, expect, it } from "vitest";

describe("live browser view coordinates", () => {
  it("maps through the contain-sized image and ignores letterboxed space", () => {
    const bounds = { left: 100, top: 50, width: 400, height: 400 };

    expect(mapBrowserViewPoint(bounds, 800, 600, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(mapBrowserViewPoint(bounds, 800, 600, 500, 400)).toEqual({ x: 1, y: 1 });
    expect(mapBrowserViewPoint(bounds, 800, 600, 300, 55)).toBeNull();
  });
});
