import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";

/**
 * The reads that fill lists, counts and photos for many agents at once. The rpc channel keeps its
 * order, so a request goes out only after every frame before it. These reads wait on the phone,
 * a few at a time, and the requests of the screen that the user looks at go out before them.
 */
const BACKGROUND_READS: readonly { method: string; route: RegExp }[] = [
  { method: "POST", route: new RegExp(`^${AGENT_TASKS_ROUTES.list}$`) },
  { method: "GET", route: new RegExp(`^${TEAM_API_ROUTES.analytics}$`) },
  { method: "GET", route: /^\/v1\/agents\/[^/]+\/(avatar|routines|routines\/[^/]+\/runs)$/ },
];

/** The background reads that one server has sent and that have no answer yet. */
export const BACKGROUND_READS_IN_FLIGHT = 2;

export function isBackgroundRead(method: string, path: string): boolean {
  const route = path.split("?", 1)[0] ?? path;
  return BACKGROUND_READS.some((read) => read.method === method && read.route.test(route));
}

/**
 * Runs at most `limit` tasks at a time. A free slot goes to the newest waiting task: a screen that
 * opens after a burst of reads waits for one read, not for the whole burst.
 */
export function createRequestLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running < limit) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // The slot goes to the next task directly, so a new task cannot take it first.
      const next = waiting.pop();
      if (next) next();
      else running -= 1;
    }
  };
}
