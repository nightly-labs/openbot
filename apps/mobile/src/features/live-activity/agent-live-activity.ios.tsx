import { requireOptionalNativeModule } from "expo";
import type { AgentLiveActivityLoader } from "./agent-live-activity.types";

/**
 * `expo-widgets` requires its native module when it loads, and a build without the module, such
 * as Expo Go or an older development build, would crash. So the app loads it only when the module
 * exists, and has no Live Activities otherwise.
 */
export const agentLiveActivity: AgentLiveActivityLoader = () => {
  if (!requireOptionalNativeModule("ExpoWidgets")) return null;
  const widgets: typeof import("./agent-live-activity-widgets.ios") = require("./agent-live-activity-widgets.ios");
  return widgets.agentLiveActivity();
};
