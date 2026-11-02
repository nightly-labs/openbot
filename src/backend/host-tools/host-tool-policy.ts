import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

const HOST_TOOL_ACTIONS = [
  "shell",
  "screenshot",
  "read-file",
  "list-directory",
  "write-file",
  "send-input",
  "mcp",
] as const;
export type HostToolAction = (typeof HOST_TOOL_ACTIONS)[number];
export type HostToolMode = "ask" | "always" | "never";
export const HOST_TOOL_ASK_DEADLINE_MS = 10 * 60 * 1000;

interface PolicyDocument {
  rules: Partial<Record<HostToolAction, HostToolMode>>;
  approvals: Record<string, HostToolAction>;
}

function emptyDocument(): PolicyDocument {
  return { rules: {}, approvals: {} };
}

const HOST_TOOL_MODES = ["ask", "always", "never"] as const;

function isAction(value: unknown): value is HostToolAction {
  return isOneOf(HOST_TOOL_ACTIONS, value);
}

function isMode(value: unknown): value is HostToolMode {
  return isOneOf(HOST_TOOL_MODES, value);
}

export class HostToolPolicy {
  /** Actions this object was asked to run. Tests use it. Production does not log it. */
  readonly ran: HostToolAction[] = [];
  #document: PolicyDocument;
  readonly #file: string | null;

  constructor(document: PolicyDocument = emptyDocument(), file: string | null = null) {
    this.#document = document;
    this.#file = file;
  }

  decide(action: HostToolAction): HostToolMode {
    return this.#document.rules[action] ?? "ask";
  }

  allowOnce(action: HostToolAction): void {
    this.ran.push(action);
  }

  allowAlways(action: HostToolAction, approvalId: string): void {
    this.#document.rules[action] = "always";
    this.#document.approvals[approvalId] = action;
    this.ran.push(action);
  }

  denyForever(action: HostToolAction): void {
    this.#document.rules[action] = "never";
  }

  retireApproval(approvalId: string): void {
    const action = this.#document.approvals[approvalId];
    delete this.#document.approvals[approvalId];
    if (action !== undefined && this.#document.rules[action] === "always") {
      delete this.#document.rules[action];
    }
  }

  async save(): Promise<void> {
    if (this.#file === null) return;
    await mkdir(path.dirname(this.#file), { recursive: true });
    await writeFile(this.#file, `${JSON.stringify(this.#document)}\n`, "utf8");
  }
}

export async function loadHostToolPolicy(file: string): Promise<HostToolPolicy> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return new HostToolPolicy(emptyDocument(), file);
  }
  const document = emptyDocument();
  if (isDynamicRecord(parsed)) {
    const rules = parsed.rules;
    const approvals = parsed.approvals;
    if (isDynamicRecord(rules)) {
      for (const [key, value] of Object.entries(rules)) {
        if (isAction(key) && isMode(value)) document.rules[key] = value;
      }
    }
    if (isDynamicRecord(approvals)) {
      for (const [key, value] of Object.entries(approvals)) {
        if (isAction(value)) document.approvals[key] = value;
      }
    }
  }
  return new HostToolPolicy(document, file);
}
