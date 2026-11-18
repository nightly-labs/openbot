import {
  isProviderEnvironmentProvider,
  PROVIDER_ENVIRONMENT_LIMITS,
  PROVIDER_ENVIRONMENT_NAME_PATTERN,
  type ProviderEnvironment,
  type ProviderEnvironmentProblem,
  type ProviderEnvironmentProvider,
  type ProviderEnvironmentUpdate,
  providerEnvironmentProblem,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { PreferenceStore } from "./preference-file";
import {
  CredentialFileTooLarge,
  type CredentialStoreFailure,
  type OpenBotSecretName,
  type ProviderCredentialStore,
} from "./provider-credential-store";

/** A variable as the file keeps it. A sensitive value is not here: it is in the provider key file. */
interface StoredVariable {
  name: string;
  sensitive: boolean;
  value?: string;
}

interface StoredEnvironment {
  providers: Partial<Record<ProviderEnvironmentProvider, StoredVariable[]>>;
}

/** The name of a sensitive value in the encrypted provider key file. */
export function providerEnvironmentSecret(provider: ProviderEnvironmentProvider, name: string): OpenBotSecretName {
  return `openbot:provider-env:${provider}:${name}`;
}

function decodeVariable(value: unknown): StoredVariable | null {
  if (!isDynamicRecord(value) || !isString(value.name) || typeof value.sensitive !== "boolean") return null;
  if (!PROVIDER_ENVIRONMENT_NAME_PATTERN.test(value.name)) return null;
  if (value.sensitive) return { name: value.name, sensitive: true };
  return isString(value.value) ? { name: value.name, sensitive: false, value: value.value } : null;
}

/**
 * The variables of each provider. A missing file, or a file that does not decode, reads as none. A
 * provider or a variable that this build does not know is left out, and the next save drops it.
 */
export type ProviderEnvironmentPreferenceStore = PreferenceStore<StoredEnvironment>;

export function createProviderEnvironmentPreferenceStore(path: string): ProviderEnvironmentPreferenceStore {
  return new PreferenceStore<StoredEnvironment>({
    path,
    defaultValue: { providers: {} },
    decode: (parsed) => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.providers)) return null;
      const providers: StoredEnvironment["providers"] = {};
      for (const [provider, list] of Object.entries(parsed.providers)) {
        if (!isProviderEnvironmentProvider(provider) || !Array.isArray(list)) continue;
        providers[provider] = list.flatMap((item) => {
          const variable = decodeVariable(item);
          return variable ? [variable] : [];
        });
      }
      return { providers };
    },
  });
}

/** A change that the request got wrong. Its message is for the person who made the change. */
export class ProviderEnvironmentRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEnvironmentRefused";
  }
}

class ProviderEnvironmentChangeFailed extends Schema.TaggedError<ProviderEnvironmentChangeFailed>()(
  "ProviderEnvironmentChangeFailed",
  { cause: Schema.Defect() },
) {}

const PROBLEM_TEXT = {
  name: "error.provider.environmentNameInvalid",
  reserved: "error.provider.environmentNameReserved",
  duplicate: "error.provider.environmentNameDuplicate",
} as const satisfies Record<ProviderEnvironmentProblem, string>;

/** The variables as Settings and a joined server's admin change them, and as each provider spawn reads them. */
export type ProviderEnvironmentControl = ReturnType<typeof providerEnvironmentControl>;

/**
 * `changed` runs after a save that changes what the provider's processes get, so the provider starts
 * again when its turns end.
 */
export function providerEnvironmentControl(
  store: ProviderEnvironmentPreferenceStore,
  credentials: Pick<ProviderCredentialStore, "secret" | "setSecrets">,
  changed: (provider: ProviderEnvironmentProvider) => Effect.Effect<void>,
) {
  // One change at a time: the names and the sensitive values are two files, and each change reads both.
  const changes = Semaphore.makeUnsafe(1);
  const fail = (cause: unknown) => new ProviderEnvironmentChangeFailed({ cause });
  // Values that would make the key file too large to read are the request's fault, not the host's.
  const failSecrets = (error: CredentialStoreFailure) =>
    fail(
      error.cause instanceof CredentialFileTooLarge
        ? new ProviderEnvironmentRefused(sourceText("error.provider.environmentSecretsTooLarge"))
        : error.cause,
    );
  const stored = (provider: ProviderEnvironmentProvider) => store.get().providers[provider] ?? [];
  const secret = (provider: ProviderEnvironmentProvider, name: string) =>
    credentials.secret(providerEnvironmentSecret(provider, name));

  const get = (provider: ProviderEnvironmentProvider): ProviderEnvironment => ({
    provider,
    variables: stored(provider).map((variable) =>
      variable.sensitive
        ? { name: variable.name, value: "", sensitive: true, stored: secret(provider, variable.name) !== null }
        : { name: variable.name, value: variable.value ?? "", sensitive: false, stored: false },
    ),
  });

  /** What each process of the provider gets. A sensitive value that the key file lost is left out. */
  const resolve = (provider: ProviderEnvironmentProvider): Readonly<Record<string, string>> => {
    const environment: Record<string, string> = {};
    for (const variable of stored(provider)) {
      const value = variable.sensitive ? secret(provider, variable.name) : (variable.value ?? "");
      if (value !== null) environment[variable.name] = value;
    }
    return environment;
  };

  return {
    get,
    resolve,
    set: Effect.fn("ProviderEnvironment.set")(function* (update: ProviderEnvironmentUpdate) {
      return yield* changes.withPermit(
        Effect.gen(function* () {
          const { provider } = update;
          const before = resolve(provider);
          const previous = stored(provider);
          const next = yield* Effect.try({ try: () => checked(update, previous, secret), catch: fail });
          // New sensitive values first: a failed save of the names then leaves an unused value, never a
          // name without its value.
          const written = next.flatMap((variable) =>
            variable.sensitive && variable.value !== null
              ? [[providerEnvironmentSecret(provider, variable.name), variable.value] as const]
              : [],
          );
          if (written.length > 0) yield* credentials.setSecrets(written).pipe(Effect.mapError(failSecrets));
          const list: StoredVariable[] = next.map((variable) =>
            variable.sensitive
              ? { name: variable.name, sensitive: true }
              : { name: variable.name, sensitive: false, value: variable.value ?? "" },
          );
          yield* store.set({ providers: { ...store.get().providers, [provider]: list } }).pipe(Effect.mapError(fail));
          const keep = new Set(next.filter((variable) => variable.sensitive).map((variable) => variable.name));
          const removed = previous.flatMap((variable) =>
            variable.sensitive && !keep.has(variable.name)
              ? [[providerEnvironmentSecret(provider, variable.name), null] as const]
              : [],
          );
          if (removed.length > 0) yield* credentials.setSecrets(removed).pipe(Effect.mapError(failSecrets));
          if (JSON.stringify(before) !== JSON.stringify(resolve(provider))) yield* changed(provider);
          return get(provider);
        }),
      );
    }),
  };
}

/**
 * The checked list: trimmed names, each one valid, not reserved and not repeated. `value: null` keeps a
 * sensitive value that the host has; for any other variable it is refused.
 */
function checked(
  update: ProviderEnvironmentUpdate,
  previous: readonly StoredVariable[],
  secret: (provider: ProviderEnvironmentProvider, name: string) => string | null,
): { name: string; sensitive: boolean; value: string | null }[] {
  if (update.variables.length > PROVIDER_ENVIRONMENT_LIMITS.variables)
    throw new ProviderEnvironmentRefused(
      sourceText("error.provider.environmentTooMany", { limit: PROVIDER_ENVIRONMENT_LIMITS.variables }),
    );
  const names = update.variables.map((variable) => variable.name.trim());
  return update.variables.map((variable, index) => {
    const name = names[index] ?? "";
    const problem = providerEnvironmentProblem(update.provider, name, names);
    if (problem) throw new ProviderEnvironmentRefused(sourceText(PROBLEM_TEXT[problem], { name }));
    if (variable.value !== null && variable.value.length > PROVIDER_ENVIRONMENT_LIMITS.value)
      throw new ProviderEnvironmentRefused(sourceText("error.provider.environmentValueTooLong", { name }));
    if (variable.value === null) {
      const kept =
        variable.sensitive &&
        previous.some((item) => item.name === name && item.sensitive) &&
        secret(update.provider, name) !== null;
      if (!kept)
        throw new ProviderEnvironmentRefused(sourceText("error.provider.customAgentEnvValueMissing", { name }));
    }
    return { name, sensitive: variable.sensitive, value: variable.value };
  });
}
