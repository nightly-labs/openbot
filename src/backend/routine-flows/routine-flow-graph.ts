/**
 * The rules of one routine's flow, without the database: which agents it reaches, the step each runs
 * in, and which new link it accepts. A flow starts at the routine's own agent and follows the links
 * of that routine only.
 */

import type { RoutineFlowLink } from "@openbot/contracts/ipc";

export type RoutineFlowConnectProblem = "same-agent" | "into-owner" | "not-on-path" | "duplicate" | "cycle";

type FlowEdge = Pick<RoutineFlowLink, "fromAgentId" | "toAgentId">;

/**
 * The step each agent of the flow runs in: 0 for the routine's own agent, and one more than its
 * latest input for the rest. An agent the flow does not reach is absent.
 */
export function routineFlowDepths(ownerAgentId: string, links: readonly FlowEdge[]): Map<string, number> {
  const depth = new Map<string, number>([[ownerAgentId, 0]]);
  const queue = [ownerAgentId];
  // The links form no cycle, so a depth only grows, and at most once per link.
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const current = depth.get(next) ?? 0;
    for (const link of links) {
      if (link.fromAgentId !== next || (depth.get(link.toAgentId) ?? -1) >= current + 1) continue;
      depth.set(link.toAgentId, current + 1);
      queue.push(link.toAgentId);
    }
  }
  return depth;
}

/** Why `from` cannot hand work to `to` in this routine, or null when it can. */
export function routineFlowConnectProblem(
  ownerAgentId: string,
  links: readonly FlowEdge[],
  fromAgentId: string,
  toAgentId: string,
): RoutineFlowConnectProblem | null {
  if (fromAgentId === toAgentId) return "same-agent";
  if (toAgentId === ownerAgentId) return "into-owner";
  if (!routineFlowDepths(ownerAgentId, links).has(fromAgentId)) return "not-on-path";
  if (links.some((link) => link.fromAgentId === fromAgentId && link.toAgentId === toAgentId)) return "duplicate";
  return reaches(links, toAgentId, fromAgentId) ? "cycle" : null;
}

function reaches(links: readonly FlowEdge[], start: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const link of links) if (link.fromAgentId === next) queue.push(link.toAgentId);
  }
  return false;
}
