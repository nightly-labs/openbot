import type { AgentMessage } from "../../data";

/** A finished answer of the agent. A branch copies the conversation through such a message. */
function branchable(message: AgentMessage): boolean {
  return (
    message.author === "agent" &&
    message.streaming !== true &&
    (message.kind === undefined || message.kind === "text") &&
    message.actionMarker === undefined &&
    message.questionPrompt === undefined
  );
}

/**
 * The messages that show "Branch from here": the last answer of the agent in each finished turn. A
 * message of the person, or an answer of another turn, ends a turn. The last answer of the
 * conversation counts only when its turn does not run and no message after it streams.
 */
export function branchPointIds(
  messages: readonly AgentMessage[],
  activeTurnId: string | null | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  let candidate: AgentMessage | undefined;
  let streamingAfter = false;
  const otherTurn = (message: AgentMessage) =>
    candidate?.turnId !== undefined && message.turnId !== undefined && candidate.turnId !== message.turnId;
  for (const message of messages) {
    if (message.author === "you" || otherTurn(message)) {
      if (candidate) ids.add(candidate.id);
      candidate = undefined;
      streamingAfter = false;
    }
    if (message.author === "you") continue;
    if (branchable(message)) {
      candidate = message;
      streamingAfter = false;
    } else if (message.streaming === true) streamingAfter = true;
  }
  const ended = candidate?.turnId === undefined ? !activeTurnId : candidate.turnId !== activeTurnId;
  if (candidate && ended && !streamingAfter) ids.add(candidate.id);
  return ids;
}
