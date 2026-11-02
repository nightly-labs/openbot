// What main sends for the browser dock overlay: the presentation it shows, the actions that the main
// renderer does, and whether the overlay is on screen.

import {
  type BrowserDockAction,
  type BrowserDockPresentation,
  isBrowserDockAction,
  isBrowserDockPresentation,
} from "@openbot/contracts/ipc";

/** Null hides the overlay. */
export function decodeBrowserDockPresentation(value: unknown): BrowserDockPresentation | null {
  if (value === null) return null;
  if (!isBrowserDockPresentation(value)) throw new Error("Invalid browser dock presentation.");
  return value;
}

export function decodeBrowserDockAction(value: unknown): BrowserDockAction {
  if (isBrowserDockAction(value)) return value;
  throw new Error("Invalid browser dock action.");
}

export function decodeBrowserDockShown(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new Error("Invalid browser dock state.");
}
