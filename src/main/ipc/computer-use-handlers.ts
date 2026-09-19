// The macOS screen-recording and accessibility permission flow for the Computer Use driver.

import type { CuaDriverRuntime } from "../cua-driver-runtime";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { parseMacPermission } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface ComputerUseIpcDependencies {
  cuaDriver: CuaDriverRuntime | null;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Two endpoints, both answering with the whole state.
 *
 * Opening a pane returns the state again rather than nothing, because the user grants the
 * permission in System Settings and comes back: re-reading on the way out is what lets the panel
 * show the new answer without a second call.
 */
export function computerUseIpcHandlers({
  cuaDriver,
  openExternal,
}: ComputerUseIpcDependencies): Pick<IpcGroupHandlers, "computerUse"> {
  const state = () =>
    cuaDriver?.state() ??
    Promise.resolve({
      status: "unsupported" as const,
      permissions: [],
      message: "Computer Use is available on macOS.",
    });
  return {
    computerUse: {
      getState: handler(state),
      openPermissionPane: payloadHandler(parseMacPermission, async (permission) => {
        await openExternal(MAC_PERMISSION_URLS[permission]);
        return state();
      }),
    },
  };
}
