import { requireOptionalNativeModule } from "expo";
import type { AgentLiveActivityLoader } from "./agent-live-activity.types";

/**
 * `expo-widgets` requires its native module on import, which Expo Go does not have. The widget code
 * loads only when the module exists, so Expo Go runs the app without Live Activities.
 */
const widgetsAvailable = requireOptionalNativeModule("ExpoWidgets") !== null;

export const agentLiveActivity: AgentLiveActivityLoader = () => {
  if (!widgetsAvailable) return null;
  const widgets: { agentLiveActivity: AgentLiveActivityLoader } = require("./agent-live-activity-widgets");
  return widgets.agentLiveActivity();
};
