import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
export type AgentInstructionFileName = (typeof AGENT_INSTRUCTION_FILE_NAMES)[number];

export interface AgentInstructionsFile {
  fileName: AgentInstructionFileName;
  exists: boolean;
  text: string;
}

export interface SaveAgentInstructionsInput {
  agentId: string;
  text: string;
  expected: string;
}

export const AGENT_INSTRUCTIONS_READ_LIMIT = INPUT_LIMITS.agentInstructionsFile * 8;

export function isAgentInstructionsFile(value: unknown): value is AgentInstructionsFile {
  return (
    isDynamicRecord(value) &&
    isOneOf(AGENT_INSTRUCTION_FILE_NAMES, value.fileName) &&
    typeof value.exists === "boolean" &&
    isBoundedString(value.text, AGENT_INSTRUCTIONS_READ_LIMIT)
  );
}

export function decodeAgentInstructionsFileFromMain(value: unknown): AgentInstructionsFile {
  if (!isAgentInstructionsFile(value)) throw new Error("Invalid agent instructions.");
  return { fileName: value.fileName, exists: value.exists, text: value.text };
}

export function parseSaveAgentInstructionsInput(value: unknown): SaveAgentInstructionsInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !isBoundedString(value.text, INPUT_LIMITS.agentInstructionsFile) ||
    !isBoundedString(value.expected, AGENT_INSTRUCTIONS_READ_LIMIT)
  )
    throw new Error("Invalid agent instructions input.");
  return { agentId: value.agentId, text: value.text, expected: value.expected };
}

export const AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE = "instructions-change";

export interface AgentInstructionsChange {
  before: string;
  after: string;
}

export function isAgentInstructionsChange(value: unknown): value is AgentInstructionsChange {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.before, INPUT_LIMITS.agentInstructionsFile) &&
    isBoundedString(value.after, INPUT_LIMITS.agentInstructionsFile)
  );
}
