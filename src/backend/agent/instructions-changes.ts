import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_INSTRUCTION_FILE_NAMES,
  AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
  type AgentInstructionsChange,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { agentInstructionsRevealPath, readAgentInstructionsFile } from "./workspace-instructions";

interface Baseline {
  text: string | null;
  known: string | null;
  agentWrites: number;
  turns: Set<string>;
  saves: number;
}

const currentText = (workspace: string) =>
  readAgentInstructionsFile(workspace).pipe(
    Effect.map((file) => file.text),
    Effect.orElseSucceed(() => null),
  );

const comparablePath = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));

const realPath = (path: string) =>
  Effect.tryPromise(() => realpath(path)).pipe(
    Effect.map(comparablePath),
    Effect.orElseSucceed(() => comparablePath(path)),
  );

const namesInstructionFile = (path: string) =>
  AGENT_INSTRUCTION_FILE_NAMES.some((name) => name.toLowerCase() === basename(path).toLowerCase());

const targetsInstructionFile = Effect.fn("InstructionsChanges.targetsFile")(function* (
  workspace: string,
  paths: readonly string[],
) {
  const candidates = paths.filter(namesInstructionFile);
  if (candidates.length === 0) return false;
  const file = yield* agentInstructionsRevealPath(workspace).pipe(Effect.orElseSucceed(() => workspace));
  if (file === workspace) return false;
  const target = yield* realPath(file);
  for (const candidate of candidates) if ((yield* realPath(candidate)) === target) return true;
  return false;
});

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
    const baseline: Baseline = { text: null, known: null, agentWrites: 0, turns: new Set([turnId]), saves: 0 };
    this.#agents.set(agentId, baseline);
    const text = yield* currentText(workspace);
    baseline.text ??= text;
    baseline.known ??= text;
  });

  readonly beforeAgentWrite = Effect.fn("InstructionsChanges.beforeAgentWrite")(function* (
    this: InstructionsChanges,
    agentId: string,
    workspace: string,
    paths: readonly string[],
  ) {
    const baseline = this.#agents.get(agentId);
    if (!baseline || !(yield* targetsInstructionFile(workspace, paths))) return;
    const text = baseline.agentWrites === 0 ? yield* currentText(workspace) : null;
    baseline.agentWrites += 1;
    if (text === null || text === baseline.known) return;
    baseline.text = text;
    baseline.known = text;
  });

  readonly agentWrote = Effect.fn("InstructionsChanges.agentWrote")(function* (
    this: InstructionsChanges,
    agentId: string,
    workspace: string,
    paths: readonly string[],
  ) {
    const baseline = this.#agents.get(agentId);
    if (!baseline || !(yield* targetsInstructionFile(workspace, paths))) return;
    const text = yield* currentText(workspace);
    if (text !== null) baseline.known = text;
    baseline.agentWrites = Math.max(0, baseline.agentWrites - 1);
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
      baseline.known = after;
      return null;
    }
    const before = baseline.text;
    if (after !== null) {
      baseline.text = after;
      baseline.known = after;
    }
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
      baseline.known = text;
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
