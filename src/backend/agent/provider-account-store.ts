import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PROVIDERS, type AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  MAX_PROVIDER_ACCOUNTS,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../atomic-json-file";
import { causeHelpers } from "../effect-boundary";
import { isMissingFileError } from "../file-errors";

/** A provider that can hold accounts: every built-in one. */
type AccountProvider = Exclude<AgentProviderId, "acp">;

/** A provider account after the first. Its credentials stay in its folder, never in this list. */
export interface StoredProviderAccount {
  id: string;
  provider: AccountProvider;
  label: string | null;
}

const ACCOUNT_ID = /^a[0-9a-f]{16}$/u;
const Provider = Schema.Literals(AGENT_PROVIDERS.filter((provider) => provider !== "acp"));
const LabelText = Schema.String.check(Schema.isMaxLength(PROVIDER_ACCOUNT_LABEL_MAX_LENGTH));
const Label = Schema.NullOr(LabelText);
const ProviderAccountsFile = Schema.Struct({
  version: Schema.Literal(1),
  accounts: Schema.Array(
    Schema.Struct({ id: Schema.String.check(Schema.isPattern(ACCOUNT_ID)), provider: Provider, label: Label }),
  ),
  /** The names the user gave the first account of each provider. */
  defaultLabels: Schema.Record(Schema.String, LabelText),
});
type ProviderAccountsFile = typeof ProviderAccountsFile.Type;
const decodeProviderAccountsFile = Schema.decodeUnknownSync(ProviderAccountsFile);

export class ProviderAccountStoreFailed extends Schema.TaggedError<ProviderAccountStoreFailed>()(
  "ProviderAccountStoreFailed",
  { cause: Schema.Defect() },
) {}
const { rewrap: toStoreFailed } = causeHelpers(ProviderAccountStoreFailed);

/**
 * The provider accounts after the first, and the folder each one signs in to. A folder is made
 * before its account is saved and removed after its account is removed, so the list never names a
 * folder that does not exist. A file this build cannot read stays unchanged, and the store is then
 * read-only.
 */
export class ProviderAccountStore {
  readonly #path: string;
  readonly #root: string;
  readonly #writes = Semaphore.makeUnsafe(1);
  #file: ProviderAccountsFile = { version: 1, accounts: [], defaultLabels: {} };
  #readOnly = false;

  /** `path` is the list; `root` holds one folder for each account. */
  constructor(path: string, root: string) {
    this.#path = path;
    this.#root = root;
  }

  readonly load = Effect.fn("ProviderAccountStore.load")(function* (this: ProviderAccountStore) {
    const text = yield* Effect.tryPromise({
      try: () => readFile(this.#path, "utf8"),
      catch: (cause) => new ProviderAccountStoreFailed({ cause }),
    }).pipe(
      Effect.catchIf(
        (failure) => isMissingFileError(failure.cause),
        () => Effect.succeed(null),
      ),
    );
    if (text === null) return;
    try {
      this.#file = decodeProviderAccountsFile(JSON.parse(text));
    } catch {
      // A newer build's file, or a damaged one: keep it for that build, and change nothing.
      this.#readOnly = true;
    }
  }).bind(this);

  list(provider?: AgentProviderId): readonly StoredProviderAccount[] {
    return this.#file.accounts.filter((account) => !provider || account.provider === provider);
  }

  get(provider: AgentProviderId, accountId: string): StoredProviderAccount | null {
    return this.#file.accounts.find((account) => account.id === accountId && account.provider === provider) ?? null;
  }

  defaultLabel(provider: AgentProviderId): string | null {
    return this.#file.defaultLabels[provider] ?? null;
  }

  /** The folder an account signs in to. Only ids this store made reach a path. */
  home(account: StoredProviderAccount): string {
    if (!ACCOUNT_ID.test(account.id)) throw new Error("Invalid provider account.");
    return join(this.#root, account.id);
  }

  /**
   * Makes an empty, private folder and saves the account that signs in to it. Null when the provider
   * already has `MAX_PROVIDER_ACCOUNTS`, checked in the same write so that two requests cannot pass it.
   */
  readonly create = Effect.fn("ProviderAccountStore.create")(function* (
    this: ProviderAccountStore,
    provider: AgentProviderId,
  ) {
    if (provider === "acp")
      return yield* new ProviderAccountStoreFailed({
        cause: new Error("Custom agents do not have provider accounts."),
      });
    return yield* this.#add(provider, `a${randomBytes(8).toString("hex")}`);
  }).bind(this);

  /** The account with this fixed id, made as `create` makes one when it does not exist yet. */
  readonly ensure = Effect.fn("ProviderAccountStore.ensure")(function* (
    this: ProviderAccountStore,
    provider: AccountProvider,
    accountId: string,
  ) {
    return this.get(provider, accountId) ?? (yield* this.#add(provider, accountId));
  }).bind(this);

  #add(provider: AccountProvider, accountId: string) {
    return this.#change((file) =>
      Effect.gen({ self: this }, function* () {
        const existing = file.accounts.find((account) => account.id === accountId && account.provider === provider);
        if (existing) return { file, result: existing };
        if (file.accounts.filter((account) => account.provider === provider).length + 1 >= MAX_PROVIDER_ACCOUNTS)
          return { file, result: null };
        const account: StoredProviderAccount = { id: accountId, provider, label: null };
        const home = this.home(account);
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(this.#root, { recursive: true, mode: 0o700 });
            await chmod(this.#root, 0o700);
            await mkdir(home, { recursive: false, mode: 0o700 });
          },
          catch: (cause) => new ProviderAccountStoreFailed({ cause }),
        });
        return { file: { ...file, accounts: [...file.accounts, account] }, result: account };
      }),
    );
  }

  readonly rename = Effect.fn("ProviderAccountStore.rename")(function* (
    this: ProviderAccountStore,
    provider: AgentProviderId,
    accountId: string,
    label: string | null,
  ) {
    return yield* this.#change((file) => {
      if (accountId === DEFAULT_PROVIDER_ACCOUNT_ID) {
        const { [provider]: _previous, ...defaultLabels } = file.defaultLabels;
        return Effect.succeed({
          file: { ...file, defaultLabels: label ? { ...defaultLabels, [provider]: label } : defaultLabels },
          result: undefined,
        });
      }
      return Effect.succeed({
        file: {
          ...file,
          accounts: file.accounts.map((account) =>
            account.id === accountId && account.provider === provider ? { ...account, label } : account,
          ),
        },
        result: undefined,
      });
    });
  }).bind(this);

  /** Forgets the account, then removes its folder with the credentials in it. */
  readonly remove = Effect.fn("ProviderAccountStore.remove")(function* (
    this: ProviderAccountStore,
    account: StoredProviderAccount,
  ) {
    const home = this.home(account);
    yield* this.#change((file) =>
      Effect.succeed({
        file: { ...file, accounts: file.accounts.filter((candidate) => candidate.id !== account.id) },
        result: undefined,
      }),
    );
    yield* Effect.tryPromise({
      try: () => rm(home, { recursive: true, force: true }),
      catch: (cause) => new ProviderAccountStoreFailed({ cause }),
    });
  }).bind(this);

  #change<A>(
    update: (
      file: ProviderAccountsFile,
    ) => Effect.Effect<{ file: ProviderAccountsFile; result: A }, ProviderAccountStoreFailed>,
  ): Effect.Effect<A, ProviderAccountStoreFailed> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#readOnly)
          return yield* new ProviderAccountStoreFailed({
            cause: new Error(sourceText("error.provider.accountsReadOnly")),
          });
        const { file, result } = yield* update(this.#file);
        if (file === this.#file) return result;
        yield* writeJsonFileAtomically(this.#path, file, { createDirectory: true }).pipe(toStoreFailed);
        this.#file = file;
        return result;
      }).pipe(Effect.uninterruptible),
    );
  }
}
