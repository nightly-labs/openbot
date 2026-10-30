// The Automation prompts of the Apple apps that a marketplace app drives.

import { Effect } from "effect";
import { requestMacAutomation } from "../mac-automation";
import { parseMacAutomationTargets } from "./app-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface MacAutomationIpcDependencies {
  platform: NodeJS.Platform;
}

/**
 * One endpoint. The renderer names apps from a fixed list; the bundles and the script stay in main,
 * so a page can make macOS ask about these apps and nothing else.
 */
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
