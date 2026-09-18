import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ApprovalAutomationPreference,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  type SetApprovalAutomationInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * Anything this file cannot read as the shape it wrote becomes "ask the user about everything".
 * A preference that grants standing consent has one safe failure, and it is not the one that keeps
 * the grant: a truncated write, a hand-edited file or a downgrade must cost the user extra prompts
 * rather than silently let an agent act unattended.
 */
export async function readApprovalAutomation(path: string): Promise<ApprovalAutomationPreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.turbo)) {
      return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveAgentIds: [] };
    }
    const ids = parsed.autoApproveAgentIds;
    if (!Array.isArray(ids) || ids.length > INPUT_LIMITS.agents || !ids.every(isString)) {
      return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveAgentIds: [] };
    }
    return { turbo: parsed.turbo, autoApproveAgentIds: [...ids] };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) {
      return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveAgentIds: [] };
    }
    throw error;
  }
}

export async function writeApprovalAutomation(
  path: string,
  preference: ApprovalAutomationPreference,
): Promise<ApprovalAutomationPreference> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const payload = { version: 1, turbo: preference.turbo, autoApproveAgentIds: preference.autoApproveAgentIds };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
    return { turbo: preference.turbo, autoApproveAgentIds: [...preference.autoApproveAgentIds] };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export interface ApprovalAutomationOptions {
  path: string;
  initial: ApprovalAutomationPreference;
  /** Agent ids that still exist. A grant for an agent the user deleted is dropped rather than kept. */
  knownAgentIds: () => Iterable<string>;
}

/**
 * Owns the preference in memory so the approval path can read it without waiting on a file, and
 * applies one field at a time on behalf of the renderer.
 *
 * Writes are chained for the reason `update-preference-store.ts` chains its own: each one renames
 * its temporary file into place, so two quick toggles could otherwise land in the wrong order and
 * persist the value the user just turned off. Here the chain also protects the read-modify-write,
 * because a partial update reads the current value before it writes the next one.
 */
export class ApprovalAutomation {
  readonly #path: string;
  readonly #knownAgentIds: () => Iterable<string>;
  #preference: ApprovalAutomationPreference;
  #pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(options: ApprovalAutomationOptions) {
    this.#path = options.path;
    this.#knownAgentIds = options.knownAgentIds;
    this.#preference = options.initial;
  }

  /** The stored value, with grants for agents that no longer exist left out. */
  current(): ApprovalAutomationPreference {
    const known = new Set(this.#knownAgentIds());
    return {
      turbo: this.#preference.turbo,
      autoApproveAgentIds: this.#preference.autoApproveAgentIds.filter((id) => known.has(id)),
    };
  }

  autoApproves(agentId: string): boolean {
    return this.#preference.turbo || this.#preference.autoApproveAgentIds.includes(agentId);
  }

  set(input: SetApprovalAutomationInput): Promise<ApprovalAutomationPreference> {
    const write = this.#pendingWrite.then(
      () => this.#apply(input),
      () => this.#apply(input),
    );
    this.#pendingWrite = write.catch(() => undefined);
    return write;
  }

  async #apply(input: SetApprovalAutomationInput): Promise<ApprovalAutomationPreference> {
    const next = this.#next(input);
    // Held in memory before the file lands, so an approval that arrives during the write is judged
    // by what the user just chose. A failed write throws to the renderer, which reverts its switch.
    const previous = this.#preference;
    this.#preference = next;
    try {
      await writeApprovalAutomation(this.#path, next);
    } catch (error) {
      this.#preference = previous;
      throw error;
    }
    return this.current();
  }

  #next(input: SetApprovalAutomationInput): ApprovalAutomationPreference {
    const known = new Set(this.#knownAgentIds());
    const kept = this.#preference.autoApproveAgentIds.filter((id) => known.has(id));
    const granted = new Set(kept);
    if (input.agentId !== undefined && input.autoApprove !== undefined) {
      if (input.autoApprove) granted.add(input.agentId);
      else granted.delete(input.agentId);
    }
    return {
      turbo: input.turbo ?? this.#preference.turbo,
      autoApproveAgentIds: [...granted].slice(0, INPUT_LIMITS.agents),
    };
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
