import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The instruction files at the root of an agent's workspace, in the order OpenBot reads them. The
 * first one that exists holds the agent's instructions; with none, OpenBot writes `AGENTS.md`.
 * `CLAUDE.md` is read for workspaces that an agent set up before OpenBot read `AGENTS.md`.
 */
export const AGENT_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
export type AgentInstructionFileName = (typeof AGENT_INSTRUCTION_FILE_NAMES)[number];

/**
 * The agent's instruction file. A joined server sends it through `agent-instructions-v1` to an owner
 * or admin. `exists` is false when no file is there yet: `text` is empty, and a save writes
 * `fileName`.
 */
export interface AgentInstructionsFile {
  fileName: AgentInstructionFileName;
  exists: boolean;
  text: string;
}

export interface SaveAgentInstructionsInput {
  agentId: string;
  text: string;
  /**
   * The file text that the edit started from. The agent can change the file during an edit, so main
   * refuses the save when the file text is different now.
   */
  expected: string;
}

/**
 * The largest file, in bytes, that main reads. An agent can write a file longer than the editor
 * saves, and the editor shows all of it so that the user can shorten it.
 */
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

/**
 * The item type of the system line after a turn in which the agent changed its instruction file. The
 * text says so, for a client that does not read `instructionsChange`, such as a Team API client.
 */
export const AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE = "instructions-change";

/**
 * The file text before and after the turn, so that the user can undo the change. Absent when either
 * text is longer than the editor saves. It stays on this computer: the Team API projections drop it.
 */
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

/**
 * The item type of the system line that suggests a rule for the agent's instruction file. The memory
 * review writes it when the chat shows a lesson: a correction, a repeated failure, or redone work. The
 * text holds the rule, for a client that does not read `ruleProposal`, such as a Team API client.
 */
export const AGENT_RULE_PROPOSAL_ITEM_TYPE = "rule-proposal";

export const AGENT_RULE_PROPOSAL_STATUSES = ["proposed", "accepted", "dismissed"] as const;
export type AgentRuleProposalStatus = (typeof AGENT_RULE_PROPOSAL_STATUSES)[number];

/**
 * A rule that the agent learned from its chat. Accepted, it goes into the agent's own instruction file,
 * under `LEARNED_RULES_HEADING`. It stays on this computer: the Team API projections drop it.
 */
export interface AgentRuleProposal {
  rule: string;
  /** What in the chat taught the rule. */
  reason: string;
  status: AgentRuleProposalStatus;
}

export function isAgentRuleProposal(value: unknown): value is AgentRuleProposal {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.rule, INPUT_LIMITS.agentLearnedRule) &&
    value.rule.trim().length > 0 &&
    isBoundedString(value.reason, INPUT_LIMITS.agentLearnedRule) &&
    isOneOf(AGENT_RULE_PROPOSAL_STATUSES, value.status)
  );
}

/**
 * The answer to a suggested rule. Accept adds the rule to the file before it marks the line.
 * `proposed` is Undo: it opens an answered line again, after Undo removed an accepted rule from the file.
 */
export interface DecideRuleProposalInput {
  agentId: string;
  /** The side thread of the line, or null for the agent's own chat. */
  threadId: string | null;
  messageId: string;
  decision: AgentRuleProposalStatus;
}

export function parseDecideRuleProposalInput(value: unknown): DecideRuleProposalInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !(value.threadId === null || isIdentifier(value.threadId)) ||
    !isIdentifier(value.messageId) ||
    !isOneOf(AGENT_RULE_PROPOSAL_STATUSES, value.decision)
  )
    throw new Error("Invalid rule proposal input.");
  return { agentId: value.agentId, threadId: value.threadId, messageId: value.messageId, decision: value.decision };
}

/** The heading of the section of the instruction file that holds the accepted rules. */
export const LEARNED_RULES_HEADING = "## Learned rules";

/** The lines of the instruction file from the learned-rules heading to the next heading, or null. */
function learnedSection(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.trim() === LEARNED_RULES_HEADING);
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  return { start, end: next < 0 ? lines.length : next };
}

/** The rules under the learned-rules heading of an instruction file, without their bullets. */
export function learnedRules(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const section = learnedSection(lines);
  if (!section) return [];
  return lines
    .slice(section.start + 1, section.end)
    .map((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim() ?? "")
    .filter((rule) => rule.length > 0);
}

/**
 * The instruction file with one more learned rule: the last bullet of the learned-rules section, which
 * starts at the end of the file when there is none. A rule that the section has already is not added.
 */
export function withLearnedRule(text: string, rule: string): string {
  const bullet = `- ${rule.replace(/\s+/g, " ").trim()}`;
  if (learnedRules(text).includes(bullet.slice(2))) return text;
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  const section = learnedSection(lines);
  if (!section)
    return `${lines.join("\n")}${lines.join("").length ? "\n\n" : ""}${LEARNED_RULES_HEADING}\n\n${bullet}\n`;
  let last = section.end - 1;
  while (last > section.start && lines[last]?.trim() === "") last -= 1;
  lines.splice(last + 1, 0, ...(last === section.start ? ["", bullet] : [bullet]));
  return `${lines.join("\n")}\n`;
}

/**
 * The instruction file without one learned rule. The heading goes too when the section has no other
 * line. A file without the rule is returned as it is.
 */
export function withoutLearnedRule(text: string, rule: string): string {
  const target = rule.replace(/\s+/g, " ").trim();
  const lines = text.split(/\r?\n/);
  const section = learnedSection(lines);
  if (!section) return text;
  const index = lines.findIndex(
    (line, at) => at > section.start && at < section.end && /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim() === target,
  );
  if (index < 0) return text;
  lines.splice(index, 1);
  const rest = lines.slice(section.start + 1, section.end - 1).some((line) => line.trim() !== "");
  if (!rest) {
    // The empty section and the blank lines before it go.
    let start = section.start;
    while (start > 0 && lines[start - 1]?.trim() === "") start -= 1;
    lines.splice(start, section.end - 1 - start);
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n`.replace(/^\n$/, "");
}
