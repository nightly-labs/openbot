import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  isApprovalAutomationPreference,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DENY_ALL: ApprovalAutomationPreference = { defaultAutoApprove: false, autoApproveOverrides: {} };

const logger = createOpenBotLogger("approval-automation");

/** Turbo mode gave every agent Full access, so a file that had it on keeps that for each agent. */
const TURBO_ON: ApprovalAutomationPreference = { defaultAutoApprove: true, autoApproveOverrides: {} };

/**
 * Missing settings use the product default; invalid settings always require approval.
 *
 * Older files stay in place, so a downgraded build still reads its own version. `legacyPaths` lists
 * them newest first: the v2 file, then the v1 file.
 */
export const readApprovalAutomation = Effect.fn("ApprovalAutomation.read")(function* (
  path: string,
  knownAgentIds: Iterable<string>,
  legacyPaths: readonly string[] = [],
): Effect.fn.Return<ApprovalAutomationPreference, PreferenceFileFailure> {
  const loaded = yield* Effect.result(
    legacyPaths.reduce(
      (read, legacyPath) =>
        read.pipe(
          Effect.catch((failure) =>
            isMissingFileError(failure.cause) ? readPreferenceFile(legacyPath, (value) => value) : Effect.fail(failure),
          ),
        ),
      readPreferenceFile(path, (value) => value),
    ),
  );
  if (Result.isFailure(loaded)) {
    const error = loaded.failure.cause;
    if (isMissingFileError(error)) return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveOverrides: {} };
    if (error instanceof SyntaxError) {
      // A half-written or hand-edited file is a typo, not a decision: keep the product default so
      // the whole fleet does not fall back to asking for every step over one brace.
      logger.warn("approval automation settings are not valid JSON; using the default", error);
      return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveOverrides: {} };
    }
    return yield* loaded.failure;
  }
  const parsed = loaded.success;
  if (!isDynamicRecord(parsed)) return DENY_ALL;
  if (parsed.version === 3 && isApprovalAutomationPreference(parsed)) {
    return { defaultAutoApprove: parsed.defaultAutoApprove, autoApproveOverrides: parsed.autoApproveOverrides };
  }
  if (parsed.version === 2 && isBoolean(parsed.turbo) && isApprovalAutomationPreference(parsed)) {
    if (parsed.turbo) return TURBO_ON;
    return { defaultAutoApprove: parsed.defaultAutoApprove, autoApproveOverrides: parsed.autoApproveOverrides };
  }
  if (parsed.version === 1 && isBoolean(parsed.turbo)) {
    const ids = parsed.autoApproveAgentIds;
    if (Array.isArray(ids) && ids.length <= INPUT_LIMITS.agents && ids.every(isString)) {
      if (parsed.turbo) return yield* writeApprovalAutomation(path, TURBO_ON);
      const granted = new Set(ids);
      // Snapshot every existing choice before enabling the default for future agents.
      return yield* writeApprovalAutomation(path, {
        defaultAutoApprove: true,
        autoApproveOverrides: Object.fromEntries([...knownAgentIds].map((id) => [id, granted.has(id)])),
      });
    }
  }
  return DENY_ALL;
});

const writeApprovalAutomation = Effect.fn("ApprovalAutomation.write")(function* (
  path: string,
  preference: ApprovalAutomationPreference,
) {
  yield* writePreferenceFile(path, { version: 3, ...preference });
  return { ...preference, autoApproveOverrides: { ...preference.autoApproveOverrides } };
});

/** One agent's Full access grant. */
export interface AgentApprovalGrant {
  agentId: string;
  autoApprove: boolean;
}

export interface ApprovalAutomationOptions {
  path: string;
  initial: ApprovalAutomationPreference;
  /** Agent ids that still exist. A grant for an agent the user deleted is dropped rather than kept. */
  knownAgentIds: () => Iterable<string>;
}

/**
 * Owns the preference in memory so the approval path can read it without waiting on a file, and
 * applies one agent's grant at a time.
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
  #writes = Semaphore.makeUnsafe(1);
  readonly #deletingAgentIds = new Set<string>();
  readonly #listeners = new Set<(preference: ApprovalAutomationPreference) => void>();

  constructor(options: ApprovalAutomationOptions) {
    this.#path = options.path;
    this.#knownAgentIds = options.knownAgentIds;
    this.#preference = options.initial;
  }

  /** The stored value, with grants for agents that no longer exist left out. */
  current(): ApprovalAutomationPreference {
    const known = new Set(this.#knownAgentIds());
    return {
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

  /**
   * Called after each saved change. A remote admin can change a grant through `agent-admin-v1`, so
   * the local window cannot rely on its own writes to know the current value.
   */
  subscribe(listener: (preference: ApprovalAutomationPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(input: AgentApprovalGrant): Effect.Effect<ApprovalAutomationPreference, PreferenceFileFailure> {
    return Effect.suspend(() => {
      if (input.autoApprove && this.#deletingAgentIds.has(input.agentId)) {
        return Effect.fail(
          new PreferenceFileFailure({ cause: new Error(sourceText("error.agent.approvalWhileDeleting")) }),
        );
      }
      return this.#writes.withPermit(this.#apply(input));
    });
  }

  /** Persist revocation before deleting data, and keep grant writes behind the deletion. */
  deleteAgent<E>(
    agentId: string,
    remove: () => Effect.Effect<void, E>,
  ): Effect.Effect<void, E | PreferenceFileFailure> {
    return Effect.suspend(() => {
      this.#deletingAgentIds.add(agentId);
      return this.#writes
        .withPermit(
          Effect.gen({ self: this }, function* () {
            yield* this.#apply({ agentId, autoApprove: false });
            yield* remove();
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.#deletingAgentIds.delete(agentId);
            }),
          ),
        );
    }).pipe(Effect.uninterruptible);
  }

  #apply = Effect.fn("ApprovalAutomation.apply")(function* (this: ApprovalAutomation, input: AgentApprovalGrant) {
    const next = this.#next(input);
    // Apply the new choice while the file write is pending; restore it when the write fails.
    const previous = this.#preference;
    this.#preference = next;
    const saved = yield* Effect.result(writeApprovalAutomation(this.#path, next));
    if (Result.isFailure(saved)) {
      this.#preference = previous;
      return yield* saved.failure;
    }
    const current = this.current();
    for (const listener of this.#listeners) listener(this.current());
    return current;
  }, Effect.uninterruptible);

  #next(input: AgentApprovalGrant): ApprovalAutomationPreference {
    const known = new Set(this.#knownAgentIds());
    const overrides = new Map(Object.entries(this.#preference.autoApproveOverrides).filter(([id]) => known.has(id)));
    if (known.has(input.agentId)) overrides.set(input.agentId, input.autoApprove);
    return {
      defaultAutoApprove: this.#preference.defaultAutoApprove,
      autoApproveOverrides: Object.fromEntries(overrides),
    };
  }
}
