import type { SaveAgentProfileInput, SaveAgentProfileResult } from "@openbot/contracts/ipc";

/** Reconcile an ambiguous save before applying later edits, retaining a single created identity. */
export async function saveReviewedAgentProfile(
  send: (input: SaveAgentProfileInput) => Promise<SaveAgentProfileResult>,
  input: SaveAgentProfileInput,
  pending?: SaveAgentProfileInput,
): Promise<SaveAgentProfileResult> {
  if (!pending) return send(input);
  // Reuse the original identity with the latest valid fields. If the first attempt never committed
  // (for example its section was deleted), correcting that draft must still allow a retry.
  const recovered = await send({ ...input, operationId: pending.operationId });
  if (pending.operationId === input.operationId) return recovered;
  return send({ operationId: input.operationId, agentId: recovered.agent.id, draft: input.draft });
}
