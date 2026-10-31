// What an agent changed in its instruction file during its turns. The chat shows a line after the
// turn, and the user can undo the change from it.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
  type AgentInstructionsChange,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { readAgentInstructionsFile } from "./workspace-instructions";

/** The file text that OpenBot last saw while turns of the agent ran, and those turns. */
interface Baseline {
  /** Null when the file could not be read. */
  text: string | null;
  turns: Set<string>;
}

/** The text of the file, empty when there is none, or null when it cannot be read. */
const currentText = (workspace: string) =>
  readAgentInstructionsFile(workspace).pipe(
    Effect.map((file) => file.text),
    Effect.orElseSucceed(() => null),
  );

/**
 * One text for each agent, not for each turn: when two turns of an agent run at the same time, only
 * the turn that ends first after the change shows it. A change between turns, such as one in an
 * editor, is not the agent's, so the text is read again when the first turn starts.
 */
export class InstructionsChanges {
  readonly #agents = new Map<string, Baseline>();

  readonly startTurn = Effect.fn("InstructionsChanges.startTurn")(function* (
    this: InstructionsChanges,
    agentId: string,
    turnId: string,
    workspace: string,
  ) {
    const known = this.#agents.get(agentId);
    if (known) {
      known.turns.add(turnId);
      return;
    }
    const baseline: Baseline = { text: null, turns: new Set([turnId]) };
    this.#agents.set(agentId, baseline);
    const text = yield* currentText(workspace);
    baseline.text ??= text;
  });

  /** The change since the text that OpenBot last saw, or null when there is none or the agent is gone. */
  readonly finishTurn = Effect.fn("InstructionsChanges.finishTurn")(function* (
    this: InstructionsChanges,
    agentId: string,
    turnId: string,
    workspace: string | undefined,
  ) {
    const baseline = this.#agents.get(agentId);
    if (!baseline?.turns.has(turnId)) return null;
    if (workspace === undefined) {
      this.dropTurn(agentId, turnId);
      return null;
    }
    const after = yield* currentText(workspace);
    baseline.turns.delete(turnId);
    if (baseline.turns.size === 0) this.#agents.delete(agentId);
    const before = baseline.text;
    if (after !== null) baseline.text = after;
    return before === null || after === null || before === after
      ? null
      : ({ before, after } satisfies AgentInstructionsChange);
  });

  /** A turn that does not end here, such as one that a restart settles. */
  dropTurn(agentId: string, turnId: string): void {
    const baseline = this.#agents.get(agentId);
    if (!baseline?.turns.delete(turnId) || baseline.turns.size > 0) return;
    this.#agents.delete(agentId);
  }

  /** The user saved the file: the next turn end compares with this text. */
  saved(agentId: string, text: string): void {
    const baseline = this.#agents.get(agentId);
    if (baseline) baseline.text = text;
  }
}

/**
 * The line after the turn's answer. No `turnId`: inside the turn, a system row sorts before the
 * answer. The texts are left out when one is longer than the editor saves, so the line has no Undo.
 */
export function instructionsChangeMessage(turnId: string, change: AgentInstructionsChange): ConversationMessage {
  const limit = INPUT_LIMITS.agentInstructionsFile;
  const undoable = change.before.length <= limit && change.after.length <= limit;
  return {
    id: `${turnId}:instructions-change`,
    author: "system",
    source: "system",
    status: "completed",
    createdAt: new Date().toISOString(),
    itemType: AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
    text: sourceText("status.agent.instructionsChanged"),
    ...(undoable ? { instructionsChange: change } : {}),
  };
}
