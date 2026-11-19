import type { AgentApproval, AgentRuntimeApproval } from "@openbot/contracts/ipc";

export function reconcilePendingRequests<Item extends { requestId: string | number; agentId: string }>(
  current: readonly Item[],
  snapshotItems: readonly Item[],
  attentionComplete: boolean,
): Item[] {
  if (attentionComplete) return [...snapshotItems];
  const namedAgents = new Set(snapshotItems.map((item) => item.agentId));
  return [...current.filter((item) => !namedAgents.has(item.agentId)), ...snapshotItems];
}

export function approvalIsCut(approval: AgentApproval | AgentRuntimeApproval): approval is AgentRuntimeApproval {
  return "truncated" in approval && approval.truncated;
}

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function startsWith(whole: string | null, cut: string | null) {
  return whole === null ? cut === null : cut !== null && whole.startsWith(cut);
}

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

export function keepWholeApprovals<Item extends AgentApproval | AgentRuntimeApproval>(
  current: readonly Item[],
  snapshotItems: readonly AgentRuntimeApproval[],
): (Item | AgentRuntimeApproval)[] {
  return snapshotItems.map((approval) =>
    approval.truncated ? (current.find((item) => isWholeCopyOf(item, approval)) ?? approval) : approval,
  );
}

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
