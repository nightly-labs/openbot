import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  isApprovalAutomationPreference,
  type SetApprovalAutomationInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** Missing settings use the product default; invalid settings always require approval. */
export const readApprovalAutomation = Effect.fn("ApprovalAutomation.read")(function* (
  path: string,
  knownAgentIds: Iterable<string>,
  legacyPath?: string,
): Effect.fn.Return<ApprovalAutomationPreference, PreferenceFileFailure> {
  const loaded = yield* Effect.result(
    readPreferenceFile(path, (value) => value).pipe(
      Effect.catch((failure) =>
        isMissingFileError(failure.cause) && legacyPath
          ? readPreferenceFile(legacyPath, (value) => value)
          : Effect.fail(failure),
      ),
    ),
  );
  if (Result.isFailure(loaded)) {
    const error = loaded.failure.cause;
    if (isMissingFileError(error)) return { ...DEFAULT_APPROVAL_AUTOMATION_PREFERENCE, autoApproveOverrides: {} };
    if (error instanceof SyntaxError) return { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} };
    return yield* loaded.failure;
  }
  const parsed = loaded.success;
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
      return yield* writeApprovalAutomation(path, {
        turbo: parsed.turbo,
        defaultAutoApprove: true,
        autoApproveOverrides: Object.fromEntries([...knownAgentIds].map((id) => [id, granted.has(id)])),
      });
    }
  }
  return { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} };
});

export const writeApprovalAutomation = Effect.fn("ApprovalAutomation.write")(function* (
  path: string,
  preference: ApprovalAutomationPreference,
) {
  yield* writePreferenceFile(path, { version: 2, ...preference });
  return { ...preference, autoApproveOverrides: { ...preference.autoApproveOverrides } };
});

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

  /**
   * Called after each saved change. A remote admin can change a grant through `agent-admin-v1`, so
   * the local window cannot rely on its own writes to know the current value.
   */
  subscribe(listener: (preference: ApprovalAutomationPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(input: SetApprovalAutomationInput): Effect.Effect<ApprovalAutomationPreference, PreferenceFileFailure> {
    return Effect.suspend(() => {
      if (input.autoApprove && input.agentId && this.#deletingAgentIds.has(input.agentId)) {
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

  #apply = Effect.fn("ApprovalAutomation.apply")(function* (
    this: ApprovalAutomation,
    input: SetApprovalAutomationInput,
  ) {
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
