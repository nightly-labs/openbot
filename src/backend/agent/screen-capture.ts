import type { Effect } from "effect";
import { Schema } from "effect";
import { z } from "zod";

export interface ScreenCaptureRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenCaptureDisplay {
  id: string;
  name: string;
  bounds: ScreenCaptureRectangle;
  scaleFactor: number;
  primary: boolean;
}

interface ScreenCaptureWindow {
  id: string;
  name: string;
}

export interface ScreenCaptureSources {
  displays: ScreenCaptureDisplay[];
  windows: ScreenCaptureWindow[];
}

export const captureScreenToolShape = {
  target: z
    .enum(["screen", "window", "region"])
    .describe("screen: one whole display. window: one window. region: a rectangle of one display."),
  displayId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("For screen: a display id from list_capture_sources. The default is the primary display."),
  windowId: z.string().min(1).max(256).optional().describe("For window: a window id from list_capture_sources."),
  region: z
    .strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional()
    .describe(
      "For region: desktop points, as in the display bounds from list_capture_sources. It must be inside one display.",
    ),
};

export const captureScreenToolSchema = z
  .strictObject(captureScreenToolShape)
  .transform((value, context): ScreenCaptureRequest => {
    if (value.target === "screen")
      return { target: "screen", ...(value.displayId ? { displayId: value.displayId } : {}) };
    if (value.target === "window" && value.windowId) return { target: "window", windowId: value.windowId };
    if (value.target === "region" && value.region) return { target: "region", region: value.region };
    context.addIssue({
      code: "custom",
      message: `${value.target} needs ${value.target === "window" ? "windowId" : "region"}.`,
    });
    return z.NEVER;
  });

export type ScreenCaptureRequest =
  | { target: "screen"; displayId?: string }
  | { target: "window"; windowId: string }
  | { target: "region"; region: ScreenCaptureRectangle };

export interface ScreenCaptureImage {
  png: Uint8Array;
  width: number;
  height: number;
  sourceName: string;
}

export class ScreenCaptureFailed extends Schema.TaggedError<ScreenCaptureFailed>()("ScreenCaptureFailed", {
  reason: Schema.String,
}) {}

export interface ScreenCaptureHost {
  listSources(): Effect.Effect<ScreenCaptureSources, ScreenCaptureFailed>;
  capture(request: ScreenCaptureRequest): Effect.Effect<ScreenCaptureImage, ScreenCaptureFailed>;
}
