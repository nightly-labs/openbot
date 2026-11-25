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
  turns: Set<string>;
  saves: number;
  beforeWrites: string[];
  agentTexts: Set<string>;
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

const COMMAND_PARTS = /&&|\|\||[;|\n]/u;
const REDIRECT_TARGET = />{1,2}\s*([^\s;&|]+)/gu;
const IN_PLACE_EDIT =
  /(?:^|\s)(?:sed|perl)\s(?:.*\s)?-(?:[A-Za-z]*i|-in-place)|(?:^|\s)(?:tee|Set-Content|Add-Content|Out-File)\s/iu;
const MOVE_OR_COPY = /(?:^|\s)(?:mv|cp|Move-Item|Copy-Item)\s/iu;

const mentionsInstructionFile = (text: string) =>
  AGENT_INSTRUCTION_FILE_NAMES.some((name) => text.toLowerCase().includes(name.toLowerCase()));

const partWritesInstructionFile = (part: string) => {
  if ([...part.matchAll(REDIRECT_TARGET)].some((target) => mentionsInstructionFile(target[1] ?? ""))) return true;
  const command = part.split(">", 1)[0] ?? "";
  if (IN_PLACE_EDIT.test(command)) return mentionsInstructionFile(command);
  return MOVE_OR_COPY.test(command) && mentionsInstructionFile(command.trim().split(/\s+/u).at(-1) ?? "");
};

export const writesInstructionFile = (command: string) => command.split(COMMAND_PARTS).some(partWritesInstructionFile);

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
    const baseline: Baseline = {
      text: null,
      turns: new Set([turnId]),
      saves: 0,
      beforeWrites: [],
      agentTexts: new Set(),
    };
    this.#agents.set(agentId, baseline);
    const text = yield* currentText(workspace);
    baseline.text ??= text;
  });

  readonly beforeAgentWrite = Effect.fn("InstructionsChanges.beforeAgentWrite")(function* (
    this: InstructionsChanges,
    agentId: string,
    workspace: string,
    paths: readonly string[],
  ) {
    const baseline = this.#agents.get(agentId);
    if (!baseline || !(yield* targetsInstructionFile(workspace, paths))) return;
    const text = yield* currentText(workspace);
    if (text !== null) baseline.beforeWrites.push(text);
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
    if (text !== null) baseline.agentTexts.add(text);
  });

  readonly agentRanCommand = Effect.fn("InstructionsChanges.agentRanCommand")(function* (
    this: InstructionsChanges,
    agentId: string,
    workspace: string,
  ) {
    const baseline = this.#agents.get(agentId);
    if (!baseline) return;
    const text = yield* currentText(workspace);
    if (text !== null) baseline.agentTexts.add(text);
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
    const outsideEdit = baseline.beforeWrites.findLast((text) => !baseline.agentTexts.has(text));
    baseline.beforeWrites = [];
    baseline.agentTexts.clear();
    if (baseline.saves !== saves) return null;
    if (after !== null && after === this.#saving.get(agentId)) {
      baseline.text = after;
      return null;
    }
    const before = outsideEdit ?? baseline.text;
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
      baseline.beforeWrites = [];
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
