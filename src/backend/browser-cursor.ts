import type { BrowserViewCursor } from "@openbot/contracts/team-protocol/browser-view-v1";

/**
 * Electron's `cursor-changed` names, as the CSS names a live view client draws. Electron calls the
 * arrow `pointer` and the link hand `hand`. A custom image is not sent; the client draws an arrow.
 */
const CURSORS = new Map<string, BrowserViewCursor>(
  Object.entries({
    pointer: "default",
    hand: "pointer",
    text: "text",
    "vertical-text": "vertical-text",
    crosshair: "crosshair",
    cell: "cell",
    wait: "wait",
    progress: "progress",
    help: "help",
    move: "move",
    "m-panning": "move",
    grab: "grab",
    grabbing: "grabbing",
    "not-allowed": "not-allowed",
    nodrop: "not-allowed",
    "drag-drop-none": "not-allowed",
    "zoom-in": "zoom-in",
    "zoom-out": "zoom-out",
    "e-resize": "ew-resize",
    "w-resize": "ew-resize",
    "ew-resize": "ew-resize",
    "ew-no-resize": "ew-resize",
    "m-panning-horizontal": "ew-resize",
    "n-resize": "ns-resize",
    "s-resize": "ns-resize",
    "ns-resize": "ns-resize",
    "ns-no-resize": "ns-resize",
    "m-panning-vertical": "ns-resize",
    "ne-resize": "nesw-resize",
    "sw-resize": "nesw-resize",
    "nesw-resize": "nesw-resize",
    "nesw-no-resize": "nesw-resize",
    "nw-resize": "nwse-resize",
    "se-resize": "nwse-resize",
    "nwse-resize": "nwse-resize",
    "nwse-no-resize": "nwse-resize",
    "col-resize": "col-resize",
    "row-resize": "row-resize",
    none: "none",
  } satisfies Record<string, BrowserViewCursor>),
);

export function browserViewCursor(electronType: string): BrowserViewCursor {
  return CURSORS.get(electronType) ?? "default";
}
