import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PROVIDERS, type AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isProviderAccountPoolStrategy,
  MAX_PROVIDER_ACCOUNTS,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountPoolStrategy,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../atomic-json-file";
import { causeHelpers } from "../effect-boundary";
import { isMissingFileError } from "../file-errors";

type AccountProvider = Exclude<AgentProviderId, "acp">;

export interface StoredProviderAccountPool {
  leftOut: readonly string[];
  strategy?: ProviderAccountPoolStrategy;
}

export interface StoredProviderAccount {
  id: string;
  provider: AccountProvider;
  label: string | null;
}

const ACCOUNT_ID = /^a[0-9a-f]{16}$/u;
const POOL_ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;
const POOL_STRATEGY_MAX_LENGTH = 64;
const Provider = Schema.Literals(AGENT_PROVIDERS.filter((provider) => provider !== "acp"));
const LabelText = Schema.String.check(Schema.isMaxLength(PROVIDER_ACCOUNT_LABEL_MAX_LENGTH));
const Label = Schema.NullOr(LabelText);
const ProviderAccountsFile = Schema.Struct({
  version: Schema.Literal(1),
  accounts: Schema.Array(
    Schema.Struct({ id: Schema.String.check(Schema.isPattern(ACCOUNT_ID)), provider: Provider, label: Label }),
  ),
  defaultLabels: Schema.Record(Schema.String, LabelText),
  pools: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        leftOut: Schema.Array(Schema.String.check(Schema.isPattern(POOL_ACCOUNT_ID))).check(
          Schema.isMaxLength(MAX_PROVIDER_ACCOUNTS),
        ),
        strategy: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(POOL_STRATEGY_MAX_LENGTH))),
      }),
    ),
  ),
  liveVoiceAccount: Schema.optionalKey(Schema.String.check(Schema.isPattern(POOL_ACCOUNT_ID))),
});
type ProviderAccountsFile = typeof ProviderAccountsFile.Type;
const decodeProviderAccountsFile = Schema.decodeUnknownSync(ProviderAccountsFile);

export class ProviderAccountStoreFailed extends Schema.TaggedError<ProviderAccountStoreFailed>()(
  "ProviderAccountStoreFailed",
  { cause: Schema.Defect() },
) {}
const { rewrap: toStoreFailed } = causeHelpers(ProviderAccountStoreFailed);

export class ProviderAccountStore {
  readonly #path: string;
  readonly #root: string;
  readonly #writes = Semaphore.makeUnsafe(1);
  #file: ProviderAccountsFile = { version: 1, accounts: [], defaultLabels: {} };
  #readOnly = false;

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

  pool(provider: AgentProviderId): StoredProviderAccountPool | null {
    const pool = this.#file.pools?.[provider];
    if (!pool) return null;
    return isProviderAccountPoolStrategy(pool.strategy)
      ? { leftOut: pool.leftOut, strategy: pool.strategy }
      : { leftOut: pool.leftOut };
  }

  readonly setPool = Effect.fn("ProviderAccountStore.setPool")(function* (
    this: ProviderAccountStore,
    provider: AccountProvider,
    pool: StoredProviderAccountPool | null,
  ) {
    return yield* this.#change((file) => {
      const { [provider]: previous, ...pools } = file.pools ?? {};
      const strategy = pool?.strategy ?? previous?.strategy;
      const next = pool
        ? {
            leftOut: [...new Set(pool.leftOut)],
            ...(strategy && strategy !== "fillFirst" ? { strategy } : {}),
          }
        : null;
      return Effect.succeed({
        file: { ...file, pools: next ? { ...pools, [provider]: next } : pools },
        result: undefined,
      });
    });
  }).bind(this);

  liveVoiceAccount(): string | null {
    return this.#file.liveVoiceAccount ?? null;
  }

  readonly setLiveVoiceAccount = Effect.fn("ProviderAccountStore.setLiveVoiceAccount")(function* (
    this: ProviderAccountStore,
    accountId: string | null,
  ) {
    return yield* this.#change((file) => {
      const { liveVoiceAccount: _previous, ...rest } = file;
      return Effect.succeed({
        file: accountId ? { ...rest, liveVoiceAccount: accountId } : rest,
        result: undefined,
      });
    });
  }).bind(this);

  home(account: StoredProviderAccount): string {
    if (!ACCOUNT_ID.test(account.id)) throw new Error("Invalid provider account.");
    return join(this.#root, account.id);
  }

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

  readonly remove = Effect.fn("ProviderAccountStore.remove")(function* (
    this: ProviderAccountStore,
    account: StoredProviderAccount,
  ) {
    const home = this.home(account);
    yield* this.#change((file) => {
      const { liveVoiceAccount, ...rest } = file;
      return Effect.succeed({
        file: {
          ...rest,
          accounts: file.accounts.filter((candidate) => candidate.id !== account.id),
          ...(file.pools ? { pools: withoutPoolAccount(file.pools, account.id) } : {}),
          ...(liveVoiceAccount && liveVoiceAccount !== account.id ? { liveVoiceAccount } : {}),
        },
        result: undefined,
      });
    });
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

function withoutPoolAccount(
  pools: NonNullable<ProviderAccountsFile["pools"]>,
  accountId: string,
): NonNullable<ProviderAccountsFile["pools"]> {
  return Object.fromEntries(
    Object.entries(pools).map(([provider, pool]) => [
      provider,
      { ...pool, leftOut: pool.leftOut.filter((id) => id !== accountId) },
    ]),
  );
}
