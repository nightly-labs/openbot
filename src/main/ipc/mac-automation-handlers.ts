import { Effect } from "effect";
import { requestMacAutomation } from "../mac-automation";
import { parseMacAutomationTargets } from "./app-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface MacAutomationIpcDependencies {
  platform: NodeJS.Platform;
}

export function macAutomationIpcHandlers({
  platform,
}: MacAutomationIpcDependencies): Pick<IpcGroupHandlers, "macAutomation"> {
  return {
    macAutomation: {
      request: payloadHandler(parseMacAutomationTargets, (targets) =>
        Effect.runPromise(requestMacAutomation(platform, targets)),
      ),
    },
  };
}
