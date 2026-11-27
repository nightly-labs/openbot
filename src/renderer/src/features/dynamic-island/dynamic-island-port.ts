import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface DynamicIslandPort {
  agent: Pick<OpenBotDesktopApi["agent"], "acknowledgeFailedTurn" | "onScopedEvent">;
  dynamicIsland: Pick<
    OpenBotDesktopApi["dynamicIsland"],
    | "getPreference"
    | "getPresentation"
    | "onAction"
    | "onGeometry"
    | "onPreference"
    | "onPresentation"
    | "performAction"
    | "performHaptic"
    | "publishPresentation"
    | "setInteractive"
    | "setInputRegion"
  >;
}

export function dynamicIslandPort(): DynamicIslandPort {
  return window.openbot;
}
