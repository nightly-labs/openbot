import type { AgentSummary } from "@openbot/contracts/ipc";
import { isGeneratedAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";

/** A model that copies a long agent id can drop, add or change a character or two. */
const NEAR_ID_EDITS = 2;

/**
 * The tool error for an id that no agent has. When one of `candidates`, the agents that the tool
 * accepts, has an id that is almost the same, the error names it so that the caller can check it and
 * call again. Only generated ids count: two random UUIDs are never this close, but short ids such as
 * `qa` and `ux` are. The tool never sends to that agent itself: work that goes to the wrong agent is
 * worse than an error.
 */
export function unknownAgentMessage(id: string, candidates: readonly AgentSummary[]): string {
  const [near, ...others] = candidates.filter(
    (agent) => isGeneratedAgentId(agent.id) && withinEdits(id, agent.id, NEAR_ID_EDITS),
  );
  if (!near || others.length > 0) return sourceText("error.backend.agentIdUnknown", { id });
  return sourceText("error.backend.agentIdNear", { id, name: JSON.stringify(near.name), nearId: near.id });
}

/** True when at most `limit` inserts, deletes or changes of one character make `from` into `to`. */
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
