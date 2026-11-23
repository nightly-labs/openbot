import type {
  CrmApplyResult,
  CrmSourceConnectInput,
  CrmSourceError,
  CrmSourceInput,
  CrmSourceKind,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { CrmError } from "./crm-handle";
import { CrmSourceStore, type SourceBatch, type SourceSkips } from "./crm-source-store";
import type { CrmStore } from "./crm-store";

export class SourceFailure extends Schema.TaggedError<SourceFailure>()("CrmSourceFailure", {
  code: Schema.Literals(["invalid-key", "permission", "rate-limited", "network", "stripe"]),
}) {}

export interface SourceAccount {
  testMode: boolean;
  accountLabel: string;
}

export interface SourceSession {
  objects(refs: readonly string[]): Effect.Effect<SourceBatch, SourceFailure>;
  list(page: (batch: SourceBatch) => Effect.Effect<void, CrmError>): Effect.Effect<void, SourceFailure | CrmError>;
}

export interface CrmSourceAdapter {
  kind: CrmSourceKind;
  check(key: string): Effect.Effect<SourceAccount, SourceFailure | CrmError>;
  open(key: string): Effect.Effect<SourceSession, SourceFailure>;
}

interface CrmSourceKeys {
  get(kind: CrmSourceKind): string | null;
  set(kind: CrmSourceKind, key: string | null): Effect.Effect<void, CrmError>;
}

export interface CrmSourceDependencies {
  keys: CrmSourceKeys;
  adapters: readonly CrmSourceAdapter[];
}

interface CrmSourceOperations {
  sourceConnect(input: CrmSourceConnectInput): Effect.Effect<CrmApplyResult, CrmError>;
  sourceDisconnect(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
  sourceSync(input: CrmSourceInput): Effect.Effect<CrmApplyResult, CrmError>;
}

const MINUTE = 60_000;
const SYNC_EVERY = 5 * MINUTE;

const FAILURE_TEXT = {
  "invalid-key": "error.crm.sourceInvalidKey",
  permission: "error.crm.sourcePermission",
  "rate-limited": "error.crm.sourceRateLimited",
  network: "error.crm.sourceNetwork",
  stripe: "error.crm.sourceFailed",
} as const satisfies Record<CrmSourceError, string>;

export const makeCrmSources = Effect.fn("makeCrmSources")(function* (options: {
  store: CrmStore;
  dependencies: CrmSourceDependencies;
  changed: () => void;
  now: () => Date;
  enabled: () => boolean;
}) {
  const { store, dependencies, changed, now, enabled } = options;
  const sources = new CrmSourceStore(store);
  const scope = yield* Effect.scope;
  const lock = Semaphore.makeUnsafe(1);
  const adapter = (kind: CrmSourceKind) => dependencies.adapters.find((item) => item.kind === kind);
  const attempt = <A>(work: () => A): Effect.Effect<A, CrmError> =>
    Effect.try({ try: work, catch: (cause) => cause }).pipe(
      Effect.catch((cause) => (cause instanceof CrmError ? Effect.fail(cause) : Effect.die(cause))),
    );

  const pull = (sourceId: string, session: SourceSession) =>
    Effect.gen(function* () {
      const skips: SourceSkips = { currency: 0, interval: 0, limit: 0 };
      const seen = new Set<string>();
      const write = (batch: SourceBatch) =>
        attempt(() => {
          for (const row of [...batch.plans, ...batch.payments]) seen.add(row.ref);
          return sources.apply(sourceId, batch, skips);
        });
      yield* session.list((batch) => write(batch).pipe(Effect.asVoid));
      const missing = yield* attempt(() => sources.openRefs(sourceId).filter((ref) => !seen.has(ref)));
      if (missing.length > 0) yield* write(yield* session.objects(missing));
      return skips;
    });

  const sync = (sourceId: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const source = yield* attempt(() => store.source(sourceId));
        const key = dependencies.keys.get(source.kind);
        const found = adapter(source.kind);
        if (key === null || found === undefined) {
          yield* attempt(() => sources.setState(sourceId, { state: "error", errorCode: "invalid-key" }));
          return;
        }
        const result = yield* found.open(key).pipe(
          Effect.flatMap((session) => pull(sourceId, session)),
          Effect.catchDefect(() => Effect.fail("defect" as const)),
          Effect.result,
        );
        const syncedAt = now().toISOString();
        yield* attempt(() =>
          result._tag === "Success"
            ? sources.setState(sourceId, { state: "ok", syncedAt, skipped: result.success })
            : result.failure instanceof SourceFailure
              ? sources.setState(sourceId, { state: "error", errorCode: result.failure.code })
              : sources.setState(sourceId, { state: "error", errorCode: "stripe" }),
        );
      }).pipe(
        Effect.catch(() => Effect.void),
        Effect.catchDefect(() => Effect.void),
        Effect.ensuring(Effect.sync(changed)),
      ),
    );

  const start = (sourceId: string) => Effect.forkIn(sync(sourceId), scope).pipe(Effect.asVoid);

  const poll = Effect.gen(function* () {
    let last = 0;
    while (true) {
      yield* Effect.sleep(MINUTE);
      const at = now().getTime();
      if (at - last < SYNC_EVERY || !enabled()) continue;
      last = at;
      const ids = yield* attempt(() => store.sources().map((source) => source.id)).pipe(
        Effect.catch(() => Effect.succeed([])),
      );
      for (const sourceId of ids) yield* sync(sourceId);
    }
  });
  yield* Effect.forkIn(poll, scope);

  const failure = (error: SourceFailure | CrmError): CrmError =>
    error instanceof CrmError
      ? error
      : new CrmError({ code: "refused", message: sourceText(FAILURE_TEXT[error.code]) });

  return {
    sourceConnect: Effect.fn("Crm.sourceConnect")(function* (input: CrmSourceConnectInput) {
      const found = adapter(input.kind);
      if (found === undefined)
        return yield* new CrmError({ code: "refused", message: sourceText("error.crm.invalidChange") });
      const key = input.key.trim();
      const account = yield* found.check(key).pipe(Effect.mapError(failure));
      const source = yield* lock.withPermit(
        Effect.gen(function* () {
          if (store.sources().some((source) => source.kind === input.kind))
            return yield* new CrmError({ code: "refused", message: sourceText("error.crm.sourceConnected") });
          yield* dependencies.keys.set(input.kind, key);
          return yield* attempt(() => sources.insert({ kind: input.kind, ...account, keyHint: key.slice(-4) })).pipe(
            Effect.onError(() => dependencies.keys.set(input.kind, null).pipe(Effect.ignore)),
          );
        }),
      );
      yield* Effect.sync(changed);
      yield* start(source.id);
      return { ok: true, id: source.id } satisfies CrmApplyResult;
    }),
    sourceDisconnect: Effect.fn("Crm.sourceDisconnect")(function* (input: CrmSourceInput) {
      const source = yield* attempt(() => sources.delete(input.sourceId));
      yield* dependencies.keys.set(source.kind, null);
      yield* Effect.sync(changed);
      return { ok: true, id: null } satisfies CrmApplyResult;
    }),
    sourceSync: Effect.fn("Crm.sourceSync")(function* (input: CrmSourceInput) {
      const found = yield* attempt(() => sources.setState(input.sourceId, { state: "syncing" }));
      if (!found) return yield* new CrmError({ code: "missing", message: sourceText("error.crm.sourceMissing") });
      yield* Effect.sync(changed);
      yield* start(input.sourceId);
      return { ok: true, id: null } satisfies CrmApplyResult;
    }),
  } satisfies CrmSourceOperations;
});
