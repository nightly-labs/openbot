import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";

const BACKGROUND_READS: readonly { method: string; route: RegExp }[] = [
  { method: "POST", route: new RegExp(`^${AGENT_TASKS_ROUTES.list}$`) },
  { method: "GET", route: new RegExp(`^${TEAM_API_ROUTES.analytics}$`) },
  { method: "GET", route: /^\/v1\/agents\/[^/]+\/(avatar|routines|routines\/[^/]+\/runs)$/ },
];

export const BACKGROUND_READS_IN_FLIGHT = 2;

export function isBackgroundRead(method: string, path: string): boolean {
  const route = path.split("?", 1)[0] ?? path;
  return BACKGROUND_READS.some((read) => read.method === method && read.route.test(route));
}

export type DownloadQueue = <T>(task: () => Promise<T>, tapped?: boolean) => Promise<T>;

export function createDownloadQueue(): DownloadQueue {
  let running = false;
  const tappedTasks: (() => void)[] = [];
  const otherTasks: (() => void)[] = [];
  function startNext() {
    const next = tappedTasks.shift() ?? otherTasks.shift();
    running = next !== undefined;
    next?.();
  }
  return async (task, tapped = false) => {
    if (running) await new Promise<void>((resolve) => (tapped ? tappedTasks : otherTasks).push(resolve));
    else running = true;
    try {
      return await task();
    } finally {
      startNext();
    }
  };
}

export function createRequestLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running < limit) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.pop();
      if (next) next();
      else running -= 1;
    }
  };
}
