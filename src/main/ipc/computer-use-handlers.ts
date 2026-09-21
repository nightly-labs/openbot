// The Computer Use driver's readiness, and the macOS permission panes it may need.

import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { ComputerUsePermissionHelpWindowController } from "../computer-use-permission-help-window";
import type { CuaDriverRuntime } from "../cua-driver-runtime";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { parseMacPermission } from "./app-inputs";
import { eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

const logger = createOpenBotLogger("computer-use");

// Only the methods these endpoints call. Naming that much lets a test pass a double without an
// assertion, and keeps the group from reaching further into either owner than it needs to.
export interface ComputerUseIpcDependencies {
  cuaDriver: Pick<CuaDriverRuntime, "state">;
  openExternal: (url: string) => Promise<void>;
  permissionHelp: Pick<
    ComputerUsePermissionHelpWindowController,
    "show" | "close" | "permissionApp" | "startDrag" | "reveal"
  >;
}

/**
 * Six endpoints. Two of them answer with the whole state.
 *
 * Opening a pane returns the state again rather than nothing, because the user grants the
 * permission in System Settings and comes back: re-reading on the way out is what lets the panel
 * show the new answer without a second call.
 *
 * The pane also brings up the help window, because System Settings opens in front of everything and
 * leaves the panel that asked for the grant behind it. The steps have to stay where the user is
 * working, which at that moment is System Settings.
 *
 * Only macOS has a pane to open. On Windows and Linux the state reports no permissions, so the
 * panel draws no row that could call any of this.
 */
export function computerUseIpcHandlers({
  cuaDriver,
  openExternal,
  permissionHelp,
}: ComputerUseIpcDependencies): Pick<IpcGroupHandlers, "computerUse"> {
  const state = () => cuaDriver.state();
  return {
    computerUse: {
      getState: handler(state),
      openPermissionPane: payloadHandler(parseMacPermission, async (permission) => {
        await openExternal(MAC_PERMISSION_URLS[permission]);
        // Reported and then left: the pane is open either way. The reason is logged, because a
        // window that never came up leaves the user with a pane and no steps and no other sign.
        await permissionHelp.show(permission).catch((cause) => {
          logger.warn("The Computer Use permission steps could not be shown.", { cause: toLogValue(cause) });
        });
        return state();
      }),
      closePermissionHelp: handler(async () => {
        permissionHelp.close();
      }),
      getPermissionApp: eventHandler((event) => permissionHelp.permissionApp(event.sender.id)),
      // The one sender-identity case in this group. A drag carries a file to wherever the pointer
      // is let go, so the window it starts in has to be the window the user is dragging from; the
      // trusted-URL gate cannot tell, because every window of the app shares one origin.
      startPermissionAppDrag: eventHandler((event) => permissionHelp.startDrag(event.sender)),
      revealPermissionApp: eventHandler(async (event) => {
        permissionHelp.reveal(event.sender.id);
      }),
    },
  };
}
