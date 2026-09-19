// The Computer Use driver's readiness, and the macOS permission panes it may need.

import type { CuaDriverRuntime } from "../cua-driver-runtime";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { parseMacPermission } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface ComputerUseIpcDependencies {
  cuaDriver: CuaDriverRuntime;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Two endpoints, both answering with the whole state.
 *
 * Opening a pane returns the state again rather than nothing, because the user grants the
 * permission in System Settings and comes back: re-reading on the way out is what lets the panel
 * show the new answer without a second call.
 *
 * Only macOS has a pane to open. On Windows and Linux the state reports no permissions, so the
 * panel draws no row that could call it.
 */
export function computerUseIpcHandlers({
  cuaDriver,
  openExternal,
}: ComputerUseIpcDependencies): Pick<IpcGroupHandlers, "computerUse"> {
  const state = () => cuaDriver.state();
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
