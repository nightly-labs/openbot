import type { AgentApproval, AgentEvent, AgentRuntimeApproval, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { approvalIsCut, keepWholeApprovals, reconcilePendingRequests } from "@openbot/team-client/runtime-attention";

export type PendingApproval = AgentApproval | AgentRuntimeApproval;

export class InactiveRequestError extends Error {}

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

export function approvalIsPartial(approval: PendingApproval): boolean {
  return approvalIsCut(approval);
}

export function reducePendingApprovals(
  current: readonly PendingApproval[],
  event: AgentEvent | TeamRealtimeEvent,
): readonly PendingApproval[] {
  switch (event.type) {
    case "runtime-snapshot": {
      const next = reconcilePendingRequests<PendingApproval>(
        current,
        keepWholeApprovals(current, event.snapshot.pendingApprovals),
        event.snapshot.attentionComplete,
      );
      return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next;
    }
    case "approval":
      return [...current.filter((item) => !sameRequest(item.requestId, event.approval.requestId)), event.approval];
    case "agent-input-resolved":
      return event.kind === "approval" ? withoutRequest(current, event.requestId) : current;
    case "turn-completed": {
      const next = current.filter((item) => item.agentId !== event.agentId || item.turnId !== event.turnId);
      return next.length === current.length ? current : next;
    }
    default:
      return current;
  }
}

function withoutRequest(current: readonly PendingApproval[], requestId: string | number) {
  const next = current.filter((item) => !sameRequest(item.requestId, requestId));
  return next.length === current.length ? current : next;
}

export function dropApproval(
  byServer: Record<string, readonly PendingApproval[]>,
  serverId: string,
  requestId: string | number,
): Record<string, readonly PendingApproval[]> {
  const current = byServer[serverId];
  if (!current) return byServer;
  const next = withoutRequest(current, requestId);
  return next === current ? byServer : { ...byServer, [serverId]: next };
}
