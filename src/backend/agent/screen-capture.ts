import type { Effect } from "effect";
import { Schema } from "effect";
import { z } from "zod";

/** A rectangle on the desktop, in the points that the operating system lays the displays out in. */
export interface ScreenCaptureRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenCaptureDisplay {
  id: string;
  /** The name the operating system gives the display, or an empty string. */
  name: string;
  /** Where the display sits on the desktop, in points. A secondary display can start at a negative point. */
  bounds: ScreenCaptureRectangle;
  /** Pixels for each point. A capture keeps this resolution, so 2 gives an image twice the bounds. */
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
  /** The display or window name, for the agent. */
  sourceName: string;
}

/**
 * The capture did not happen. The reason is source text that is safe to give to the agent and to
 * show to the user: it says what to grant or what to correct, and it holds no screen content.
 */
export class ScreenCaptureFailed extends Schema.TaggedError<ScreenCaptureFailed>()("ScreenCaptureFailed", {
  reason: Schema.String,
}) {}

/**
 * Captures the desktop of this computer for `capture_screen`. The main process owns the capture and
 * the operating system permission. It captures only after the user approves the request.
 */
export interface ScreenCaptureHost {
  /** The displays and windows. It never shows a permission prompt of the operating system. */
  listSources(): Effect.Effect<ScreenCaptureSources, ScreenCaptureFailed>;
  /** The displays. They need no permission of the operating system. */
  listDisplays(): Effect.Effect<ScreenCaptureSources["displays"]>;
  /** Whether the next capture shows the permission prompt of the operating system (#9092). */
  promptsForPermission(): Effect.Effect<boolean>;
  capture(request: ScreenCaptureRequest): Effect.Effect<ScreenCaptureImage, ScreenCaptureFailed>;
}
