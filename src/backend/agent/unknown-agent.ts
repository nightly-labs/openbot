import type { AgentSummary } from "@openbot/contracts/ipc";
import { isGeneratedAgentId, isUuidV4 } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";

const NEAR_ID_EDITS = 2;

export function unknownAgentMessage(id: string, candidates: readonly AgentSummary[]): string {
  const prefixed = isUuidV4(id) ? `agent-${id}` : null;
  const [near, ...others] = candidates.filter(
    (agent) => isGeneratedAgentId(agent.id) && (agent.id === prefixed || withinEdits(id, agent.id, NEAR_ID_EDITS)),
  );
  if (!near || others.length > 0) return sourceText("error.backend.agentIdUnknown", { id });
  return sourceText("error.backend.agentIdNear", { id, name: JSON.stringify(near.name), nearId: near.id });
}

function withinEdits(from: string, to: string, limit: number): boolean {
  if (Math.abs(from.length - to.length) > limit) return false;
  const over = limit + 1;
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let row = 1; row <= from.length; row++) {
    const current = [row];
    for (let column = 1; column <= to.length; column++) {
      const change = from[row - 1] === to[column - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[column] ?? over) + 1,
          (current[column - 1] ?? over) + 1,
          (previous[column - 1] ?? over) + change,
        ),
      );
    }
    if (Math.min(...current) > limit) return false;
    previous = current;
  }
  return (previous[to.length] ?? over) <= limit;
}
