import { type AgentModelChoice, sameAgentModelChoice } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import {
  AGENT_USAGE_LIMIT_CAPABILITY,
  AGENT_USAGE_LIMIT_ROUTES,
  type AgentUsageLimits,
  isAgentUsageLimits,
} from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { createSignal, onCleanup } from "solid-js";
import type { WebWorkspace } from "./web-client-context";

const decodeUsageLimits = guardedDecoder(isAgentUsageLimits, "agent usage limit response");

const NONE: AgentUsageLimits = { usageLimits: [], usageLimitedModels: [], failedModels: [] };

/**
 * The usage limits of one host's agents, through `agent-usage-limit-v1`. The released runtime snapshot
 * does not carry them, so each snapshot reads them again. A host without the capability has none. The
 * owner ends, it stops listening.
 */
export function createWebUsageLimits(options: {
  workspace: Pick<WebWorkspace, "state" | "onHostEvent">;
  hostId: string;
  request: () => TeamApiRequest;
}) {
  const { workspace, hostId } = options;
  const [limits, setLimits] = createSignal<AgentUsageLimits>(NONE);
  /** The reset time of the limit for which the user chose Wait, by agent id. */
  const [waited, setWaited] = createSignal<Record<string, number | null>>({});
  let reading = false;
  let stale = false;
  let disposed = false;
  const read = async (): Promise<void> => {
    if (reading) {
      stale = true;
      return;
    }
    reading = true;
    try {
      do {
        stale = false;
        const next = workspace.state.capabilities.includes(AGENT_USAGE_LIMIT_CAPABILITY)
          ? await options.request()("POST", AGENT_USAGE_LIMIT_ROUTES.list, decodeUsageLimits, {})
          : NONE;
        if (disposed) break;
        setLimits(next);
        // A hold that ended takes its "Wait" with it, so the next hold asks again.
        const held = new Set(next.usageLimits.map((limit) => limit.agentId));
        setWaited((current) => Object.fromEntries(Object.entries(current).filter(([agentId]) => held.has(agentId))));
      } while (stale && !disposed);
    } finally {
      reading = false;
    }
  };
  // A failed read keeps the last limits; the next runtime snapshot reads them again.
  const refresh = () => void read().catch(() => undefined);
  onCleanup(() => {
    disposed = true;
  });
  onCleanup(
    workspace.onHostEvent((event) => {
      if (workspace.state.host?.hostId !== hostId) return;
      // A limit can start or end while the host is away, and a reconnect sends a runtime snapshot.
      if (event.type === "runtime-snapshot") refresh();
    }),
  );
  refresh();
  return {
    usageLimits: () => Object.fromEntries(limits().usageLimits.map((limit) => [limit.agentId, limit.resetsAt])),
    usageLimited: (choice: AgentModelChoice) =>
      limits().usageLimitedModels.some((limited) => sameAgentModelChoice(limited, choice)),
    providerFailed: (choice: AgentModelChoice) =>
      limits().failedModels.some((failed) => sameAgentModelChoice(failed, choice)),
    waited,
    wait: (agentId: string, resetsAt: number | null) => setWaited((current) => ({ ...current, [agentId]: resetsAt })),
  };
}
