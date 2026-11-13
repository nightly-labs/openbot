// What main answers about the window of a page that draws its own window buttons.

import type { WindowControlsState } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export function decodeWindowControlsState(value: unknown): WindowControlsState {
  if (!isDynamicRecord(value) || typeof value.maximized !== "boolean" || typeof value.fullScreen !== "boolean") {
    throw new Error("Invalid window state.");
  }
  return { maximized: value.maximized, fullScreen: value.fullScreen };
}
