import { readFile } from "node:fs/promises";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  isApprovalAutomationPreference,
  type SetApprovalAutomationInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

/** Missing settings use the product default; invalid settings always require approval. */
export async function readApprovalAutomation(
  path: string,
  knownAgentIds: Iterable<string>,
  legacyPath?: string,
): Promise<ApprovalAutomationPreference> {
  let parsed: unknown;
  try {
    const contents = await readFile(path, "utf8").catch((error) => {
      // Keep the released file readable by older installations. Never write a migration to it.
      if (isMissing(error) && legacyPath) return readFile(legacyPath, "utf8");
      throw error;
    });
    parsed = JSON.parse(contents);
  } catch (error) {
    if (isMissing(error)) return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveOverrides: {} };
    if (error instanceof SyntaxError) return { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} };
    throw error;
  }
  if (isDynamicRecord(parsed) && parsed.version === 2 && isApprovalAutomationPreference(parsed)) {
    return {
      turbo: parsed.turbo,
      defaultAutoApprove: parsed.defaultAutoApprove,
      autoApproveOverrides: parsed.autoApproveOverrides,
    };
  }
  if (isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.turbo)) {
    const ids = parsed.autoApproveAgentIds;
    if (Array.isArray(ids) && ids.length <= INPUT_LIMITS.agents && ids.every(isString)) {
      const granted = new Set(ids);
      // Snapshot every existing choice before enabling the default for future agents.
      return writeApprovalAutomation(path, {
        turbo: parsed.turbo,
        defaultAutoApprove: true,
        autoApproveOverrides: Object.fromEntries([...knownAgentIds].map((id) => [id, granted.has(id)])),
      });
    }
  }
  return { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} };
}

export async function writeApprovalAutomation(
  path: string,
  preference: ApprovalAutomationPreference,
): Promise<ApprovalAutomationPreference> {
  await writeJsonFileAtomically(path, { version: 2, ...preference });
  return { ...preference, autoApproveOverrides: { ...preference.autoApproveOverrides } };
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
  readonly #deletingAgentIds = new Set<string>();

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
      defaultAutoApprove: this.#preference.defaultAutoApprove,
      autoApproveOverrides: Object.fromEntries(
        Object.entries(this.#preference.autoApproveOverrides).filter(([id]) => known.has(id)),
      ),
    };
  }

  autoApproves(agentId: string): boolean {
    return (
      !this.#deletingAgentIds.has(agentId) &&
      new Set(this.#knownAgentIds()).has(agentId) &&
      agentAutoApprovalEnabled(this.#preference, agentId)
    );
  }

  turboEnabled(): boolean {
    return this.#preference.turbo;
  }

  set(input: SetApprovalAutomationInput): Promise<ApprovalAutomationPreference> {
    if (input.autoApprove && input.agentId && this.#deletingAgentIds.has(input.agentId)) {
      return Promise.reject(new Error("Cannot grant approval while the agent is being deleted."));
    }
    const write = this.#pendingWrite.then(
      () => this.#apply(input),
      () => this.#apply(input),
    );
    this.#pendingWrite = write.catch(() => undefined);
    return write;
  }

  /** Persist revocation before deleting data, and keep grant writes behind the deletion. */
  deleteAgent(agentId: string, remove: () => Promise<void>): Promise<void> {
    this.#deletingAgentIds.add(agentId);
    const deletion = this.#pendingWrite
      .then(async () => {
        await this.#apply({ agentId, autoApprove: false });
        await remove();
      })
      .finally(() => this.#deletingAgentIds.delete(agentId));
    this.#pendingWrite = deletion.catch(() => undefined);
    return deletion;
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
    const overrides = new Map(Object.entries(this.#preference.autoApproveOverrides).filter(([id]) => known.has(id)));
    if (input.agentId !== undefined && input.autoApprove !== undefined && known.has(input.agentId)) {
      overrides.set(input.agentId, input.autoApprove);
    }
    return {
      turbo: input.turbo ?? this.#preference.turbo,
      defaultAutoApprove: this.#preference.defaultAutoApprove,
      autoApproveOverrides: Object.fromEntries(overrides),
    };
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
