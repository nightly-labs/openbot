import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  isApprovalAutomationPreference,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DENY_ALL: ApprovalAutomationPreference = { defaultAutoApprove: false, autoApproveOverrides: {} };

const TURBO_ON: ApprovalAutomationPreference = { defaultAutoApprove: true, autoApproveOverrides: {} };

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
    if (error instanceof SyntaxError) return DENY_ALL;
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

export interface AgentApprovalGrant {
  agentId: string;
  autoApprove: boolean;
}

export interface ApprovalAutomationOptions {
  path: string;
  initial: ApprovalAutomationPreference;
  knownAgentIds: () => Iterable<string>;
}

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

  subscribe(listener: (preference: ApprovalAutomationPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(input: AgentApprovalGrant): Effect.Effect<ApprovalAutomationPreference, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.suspend(() => {
        if (input.autoApprove && this.#deletingAgentIds.has(input.agentId)) {
          return Effect.fail(
            new PreferenceFileFailure({ cause: new Error(sourceText("error.agent.approvalWhileDeleting")) }),
          );
        }
        return this.#apply(input);
      }),
    );
  }

  deleteAgent<E>(
    agentId: string,
    remove: () => Effect.Effect<void, E>,
  ): Effect.Effect<void, E | PreferenceFileFailure> {
    return Effect.suspend(() => {
      this.#deletingAgentIds.add(agentId);
      return this.#writes.withPermit(this.#apply({ agentId, autoApprove: false })).pipe(
        Effect.andThen(Effect.suspend(remove)),
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
