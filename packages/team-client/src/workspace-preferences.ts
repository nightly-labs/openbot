import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { remoteHostFingerprint } from "./remote-directory";

const WorkspacePreferences = Schema.Struct({
  hidden: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.String))),
  pinned: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.String))),
  pinnedChannels: Schema.mutableKey(Schema.optional(Schema.mutable(Schema.Array(Schema.String)))),
  hiddenChannels: Schema.mutableKey(Schema.optional(Schema.mutable(Schema.Array(Schema.String)))),
});
export type RemoteWorkspacePreferences = typeof WorkspacePreferences.Type;
const StoredPreferences = Schema.Struct({ version: Schema.Literal(1), ...WorkspacePreferences.fields });

class WorkspacePreferencesError extends Schema.TaggedError<WorkspacePreferencesError>()("WorkspacePreferencesError", {
  message: Schema.String,
}) {}

export function createWorkspacePreferences(
  apiUrl: string,
  userId: string,
  storage: { get(key: string): string | null; set(key: string, value: string): void },
) {
  const scope = remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]));
  const key = (hostId: string) => `openbot.workspace.v1.${scope}.${remoteHostFingerprint(hostId)}`;
  // Keep the cache in this store: mobile reads can otherwise make a Keychain call for every message.
  const cache = new Map<string, RemoteWorkspacePreferences>();
  const read = Effect.fn("WorkspacePreferences.read")(function* (hostId: string) {
    const cached = cache.get(hostId);
    if (cached) return cached;
    const stored = yield* preferencesCall(() => storage.get(key(hostId)));
    if (!stored) {
      const empty: RemoteWorkspacePreferences = { hidden: [], pinned: [] };
      cache.set(hostId, empty);
      return empty;
    }
    const parsed = yield* preferencesCall(() => JSON.parse(stored));
    const value = yield* Schema.decodeUnknownEffect(StoredPreferences)(parsed).pipe(
      Effect.mapError(
        () => new WorkspacePreferencesError({ message: sourceText("error.remote.preferencesUnreadable") }),
      ),
    );
    const preferences: RemoteWorkspacePreferences = {
      hidden: value.hidden,
      pinned: value.pinned,
      ...(value.pinnedChannels ? { pinnedChannels: value.pinnedChannels } : {}),
      ...(value.hiddenChannels ? { hiddenChannels: value.hiddenChannels } : {}),
    };
    cache.set(hostId, preferences);
    return preferences;
  });
  const write = Effect.fn("WorkspacePreferences.write")(function* (hostId: string, value: RemoteWorkspacePreferences) {
    yield* preferencesCall(() => storage.set(key(hostId), JSON.stringify({ version: 1, ...value })));
    cache.set(hostId, value);
  });
  return {
    read: (hostId: string) => runPreferences(read(hostId)),
    write: (hostId: string, value: RemoteWorkspacePreferences) => runPreferences(write(hostId, value)),
  };
}

function preferencesCall<A>(operation: () => A): Effect.Effect<A, WorkspacePreferencesError> {
  return Effect.try({
    try: operation,
    catch: (error) =>
      new WorkspacePreferencesError({ message: error instanceof Error ? error.message : String(error) }),
  });
}

function runPreferences<A>(operation: Effect.Effect<A, WorkspacePreferencesError>): A {
  const result = Effect.runSync(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
