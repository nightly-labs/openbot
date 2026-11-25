import { requireOptionalNativeModule } from "expo";
import type { AgentLiveActivityLoader } from "./agent-live-activity.types";

export const agentLiveActivity: AgentLiveActivityLoader = () => {
  if (!requireOptionalNativeModule("ExpoWidgets")) return null;
  const widgets: typeof import("./agent-live-activity-widgets.ios") = require("./agent-live-activity-widgets.ios");
  return widgets.agentLiveActivity();
};
