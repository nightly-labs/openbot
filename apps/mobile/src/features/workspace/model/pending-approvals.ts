import type { AgentApproval, AgentEvent, AgentRuntimeApproval, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";

/**
 * An approval that an agent waits on. The `approval` event carries the whole request. A runtime
 * snapshot carries a short copy, and marks it `truncated` when it cut a command, path or reason.
 */
export type PendingApproval = AgentApproval | AgentRuntimeApproval;

/** The host has no such request now: another client answered it, or its turn ended. */
export class InactiveRequestError extends Error {}

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

/** True when the phone shows less than the host asks about, so it must not offer Allow. */
export function approvalIsPartial(approval: PendingApproval): boolean {
  return "truncated" in approval && approval.truncated;
}

function startsWith(whole: string | null, cut: string | null) {
  return whole === null ? cut === null : cut !== null && whole.startsWith(cut);
}

/**
 * True when `whole` is the full copy of the cut snapshot entry. A request ID alone is not enough: a
 * provider can count its IDs from the start again after the host restarts.
 */
function isWholeCopyOf(whole: PendingApproval, cut: AgentRuntimeApproval) {
  return (
    !approvalIsPartial(whole) &&
    sameRequest(whole.requestId, cut.requestId) &&
    whole.agentId === cut.agentId &&
    whole.threadId === cut.threadId &&
    whole.turnId === cut.turnId &&
    whole.kind === cut.kind &&
    startsWith(whole.command, cut.command) &&
    startsWith(whole.cwd, cut.cwd) &&
    startsWith(whole.reason, cut.reason) &&
    startsWith(whole.grantRoot, cut.grantRoot)
  );
}

/**
 * Folds one host event into the approvals of one server, in the order they arrived. A snapshot is
 * the current state. For an entry that the snapshot cut, it keeps the whole copy that an earlier
 * event delivered for the same request.
 */
export function reducePendingApprovals(
  current: readonly PendingApproval[],
  event: AgentEvent | TeamRealtimeEvent,
): readonly PendingApproval[] {
  switch (event.type) {
    case "runtime-snapshot": {
      const next = reconcilePendingRequests<PendingApproval>(
        current,
        event.snapshot.pendingApprovals.map((approval) =>
          approval.truncated ? (current.find((item) => isWholeCopyOf(item, approval)) ?? approval) : approval,
        ),
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

/** Removes one answered or stale approval from the approvals of its server. */
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
