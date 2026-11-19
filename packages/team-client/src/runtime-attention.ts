import type { AgentApproval, AgentRuntimeApproval } from "@openbot/contracts/ipc";

/**
 * Folds the pending requests of a runtime snapshot into the list a client shows.
 *
 * The host cuts a snapshot's attention lists when it holds more requests than the snapshot limit
 * or the snapshot is too large, and then sends `attentionComplete: false`. A complete snapshot lists
 * every pending request, so it replaces the list. A partial one leaves out requests that are still
 * pending, so the client keeps them. It is still the current state for each agent it names, as in
 * the desktop renderer's `reconcileAttentionApprovals`: some host paths clear a request with no
 * event, and an old request kept for such an agent would hide its new one.
 */
export function reconcilePendingRequests<Item extends { requestId: string | number; agentId: string }>(
  current: readonly Item[],
  snapshotItems: readonly Item[],
  attentionComplete: boolean,
): Item[] {
  if (attentionComplete) return [...snapshotItems];
  const namedAgents = new Set(snapshotItems.map((item) => item.agentId));
  return [...current.filter((item) => !namedAgents.has(item.agentId)), ...snapshotItems];
}

/** True when the client has only the cut copy of an approval, so it must not offer Allow. */
export function approvalIsCut(approval: AgentApproval | AgentRuntimeApproval): approval is AgentRuntimeApproval {
  return "truncated" in approval && approval.truncated;
}

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function startsWith(whole: string | null, cut: string | null) {
  return whole === null ? cut === null : cut !== null && whole.startsWith(cut);
}

/**
 * True when `whole` is the whole copy of the cut snapshot entry. A request ID alone is not enough: a
 * provider can count its IDs from the start again after the host restarts.
 */
function isWholeCopyOf(whole: AgentApproval | AgentRuntimeApproval, cut: AgentRuntimeApproval) {
  return (
    !approvalIsCut(whole) &&
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
 * The approvals of a runtime snapshot, with the whole copy that the client already has in place of
 * each cut entry. An `approval` event or a `pending-approval-v1` read gives the whole copy; the
 * snapshot that follows must not replace it with the cut one.
 */
export function keepWholeApprovals<Item extends AgentApproval | AgentRuntimeApproval>(
  current: readonly Item[],
  snapshotItems: readonly AgentRuntimeApproval[],
): (Item | AgentRuntimeApproval)[] {
  return snapshotItems.map((approval) =>
    approval.truncated ? (current.find((item) => isWholeCopyOf(item, approval)) ?? approval) : approval,
  );
}

/**
 * Puts the whole copy that `pending-approval-v1` returned in place of the cut entry of the same
 * request. A request that closed while the read ran, or that an event already made whole, stays as
 * it is. The whole copy must start with each cut text: a provider can count its IDs from the start again.
 */
export function withWholeApproval<Item extends AgentApproval | AgentRuntimeApproval>(
  current: readonly Item[],
  whole: Item,
): readonly Item[] {
  const index = current.findIndex((item) => approvalIsCut(item) && isWholeCopyOf(whole, item));
  if (index === -1) return current;
  const next = [...current];
  next[index] = whole;
  return next;
}
