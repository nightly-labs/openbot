// The iCalendar feed of this computer's routines. It is local only: the feed listens on this computer.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineFeedServer } from "../routine-feed-server";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

export interface RoutineFeedIpcDependencies {
  routineFeed: RoutineFeedServer;
}

export function routineFeedIpcHandlers({
  routineFeed,
}: RoutineFeedIpcDependencies): Pick<IpcGroupHandlers, "routineFeed"> {
  return {
    routineFeed: {
      get: handler(() => runCauseEffect(routineFeed.status())),
      create: handler(() => runCauseEffect(routineFeed.create())),
      remove: handler(() => runCauseEffect(routineFeed.remove())),
    },
  };
}
