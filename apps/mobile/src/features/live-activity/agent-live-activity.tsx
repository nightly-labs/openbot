import type { AgentLiveActivityLoader } from "./agent-live-activity.types";

/**
 * Live Activities exist only on iOS, where `agent-live-activity.ios.tsx` replaces this file. Other
 * platforms and the tests do not load `expo-widgets`.
 */
export const agentLiveActivity: AgentLiveActivityLoader = () => null;
