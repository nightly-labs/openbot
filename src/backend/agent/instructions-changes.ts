import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
  type AgentInstructionsChange,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { readAgentInstructionsFile } from "./workspace-instructions";

interface Baseline {
  text: string | null;
  turns: Set<string>;
  saves: number;
}

const currentText = (workspace: string) =>
  readAgentInstructionsFile(workspace).pipe(
    Effect.map((file) => file.text),
    Effect.orElseSucceed(() => null),
  );

export class InstructionsChanges {
  readonly #agents = new Map<string, Baseline>();
  readonly #saving = new Map<string, string>();

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
    const baseline: Baseline = { text: null, turns: new Set([turnId]), saves: 0 };
    this.#agents.set(agentId, baseline);
    const text = yield* currentText(workspace);
    baseline.text ??= text;
  });

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
    const saves = baseline.saves;
    const after = yield* currentText(workspace);
    baseline.turns.delete(turnId);
    if (baseline.turns.size === 0) this.#agents.delete(agentId);
    if (baseline.saves !== saves) return null;
    if (after !== null && after === this.#saving.get(agentId)) {
      baseline.text = after;
      return null;
    }
    const before = baseline.text;
    if (after !== null) baseline.text = after;
    return before === null || after === null || before === after
      ? null
      : ({ before, after } satisfies AgentInstructionsChange);
  });

  dropTurn(agentId: string, turnId: string): void {
    const baseline = this.#agents.get(agentId);
    if (!baseline?.turns.delete(turnId) || baseline.turns.size > 0) return;
    this.#agents.delete(agentId);
  }

  saving(agentId: string, text: string): (written: boolean) => void {
    this.#saving.set(agentId, text);
    return (written) => {
      this.#saving.delete(agentId);
      const baseline = this.#agents.get(agentId);
      if (!written || !baseline) return;
      baseline.text = text;
      baseline.saves += 1;
    };
  }
}

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
