// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { GiveAnAgentItsFirstTask } from "./give-an-agent-its-first-task";
import { HostATeamServer } from "./host-a-team-server";
import { InstallOpenBotOnMacos } from "./install-openbot-on-macos";
import { ScheduleARoutine } from "./schedule-a-routine";
import { StartAChannelForTwoAgents } from "./start-a-channel-for-two-agents";
import { SwitchAnAgentBetweenProviders } from "./switch-an-agent-between-providers";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "install-openbot-on-macos": InstallOpenBotOnMacos,
  "give-an-agent-its-first-task": GiveAnAgentItsFirstTask,
  "switch-an-agent-between-providers": SwitchAnAgentBetweenProviders,
  "start-a-channel-for-two-agents": StartAChannelForTwoAgents,
  "schedule-a-routine": ScheduleARoutine,
  "host-a-team-server": HostATeamServer,
};
