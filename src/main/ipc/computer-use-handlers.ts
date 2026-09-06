// The macOS screen-recording and accessibility permission flow.

import type { ComputerUseMacSetupWindowController } from "../computer-use-mac-setup-window";
import { parseMacPermission } from "./app-inputs";
import { eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface ComputerUseIpcDependencies {
  computerUseMacSetup: ComputerUseMacSetupWindowController;
}

export function computerUseIpcHandlers({
  computerUseMacSetup,
}: ComputerUseIpcDependencies): Pick<IpcGroupHandlers, "computerUse"> {
  return {
    computerUse: {
      getMacSetupState: handler(() => computerUseMacSetup.getState()),
      openMacPermissionSetup: payloadHandler(parseMacPermission, (parsed) => computerUseMacSetup.open(parsed)),
      startHelperDrag: eventHandler((event) => computerUseMacSetup.startDrag(event.sender)),
      revealHelper: handler(() => computerUseMacSetup.revealHelper()),
      closeMacPermissionSetup: handler(() => computerUseMacSetup.close()),
    },
  };
}
