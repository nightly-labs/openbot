// Slug to article body for /news.
//
// The imports are eager on purpose. A lazy route would ship an article page whose
// prose arrives after hydration, which is exactly the content a crawler came for.
// These bodies are text; the whole set costs less than one photograph.

import type { ArticleBody } from "../body";
import { ChannelsPutAgentsInOneRoom } from "./channels-put-agents-in-one-room";
import { EveryAgentGetsAWorkspace } from "./every-agent-gets-a-workspace";
import { OneAgentManyProviders } from "./one-agent-many-providers";
import { RoutinesGiveAnAgentASchedule } from "./routines-give-an-agent-a-schedule";
import { RunTheTeamServerYourself } from "./run-the-team-server-yourself";
import { WhatGetsRedactedBeforeItLeaves } from "./what-gets-redacted-before-it-leaves";
import { YourWorkStaysOnYourComputer } from "./your-work-stays-on-your-computer";

export const NEWS_ARTICLE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "your-work-stays-on-your-computer": YourWorkStaysOnYourComputer,
  "one-agent-many-providers": OneAgentManyProviders,
  "channels-put-agents-in-one-room": ChannelsPutAgentsInOneRoom,
  "routines-give-an-agent-a-schedule": RoutinesGiveAnAgentASchedule,
  "every-agent-gets-a-workspace": EveryAgentGetsAWorkspace,
  "run-the-team-server-yourself": RunTheTeamServerYourself,
  "what-gets-redacted-before-it-leaves": WhatGetsRedactedBeforeItLeaves,
};
