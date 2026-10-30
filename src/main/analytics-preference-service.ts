import type { CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import {
  readAnalyticsPreference,
  readSavedAnalyticsPreference,
  saveAnalyticsDefault,
  writeAnalyticsPreference,
} from "./analytics-preference-store";

const logger = createOpenBotLogger("analytics-preference");

/** The account side: the signed-in user, and the request that saves an answer on the account. */
export interface AnalyticsAccount {
  getState(): CentralAuthState;
  updateAnalytics(enabled: boolean): Effect.Effect<CentralAuthState, unknown>;
}

export interface AnalyticsPreferenceServiceOptions {
  path: string;
  account: AnalyticsAccount;
  setTrackingEnabled: (enabled: boolean) => void;
}

/**
 * The analytics answer of this computer, kept the same as the account's latest answer. A choice of
 * the user goes to the account; a default does not. When the account has an answer and this
 * computer has no unsent choice, this computer follows the account.
 */
export class AnalyticsPreferenceService {
  // One write at a time, so two quick toggles leave the file and the tracker at the last choice.
  readonly #writes = Semaphore.makeUnsafe(1);
  readonly #path: string;
  readonly #account: AnalyticsAccount;
  readonly #setTrackingEnabled: (enabled: boolean) => void;
  #sending = false;

  constructor(options: AnalyticsPreferenceServiceOptions) {
    this.#path = options.path;
    this.#account = options.account;
    this.#setTrackingEnabled = options.setTrackingEnabled;
  }

  /** Waits for a write in progress, so a read after an account change gets the followed answer. */
  read(setupCompleted: boolean) {
    return this.#writes.withPermit(readAnalyticsPreference(this.#path, setupCompleted));
  }

  /** The answer of the signed-in account from any device, or null when it has none. */
  accountAnswer(): boolean | null {
    const state = this.#account.getState();
    return state.status === "signed_in" ? (state.user.analyticsEnabled ?? null) : null;
  }

  saveDefault() {
    return this.#writes.withPermit(saveAnalyticsDefault(this.#path));
  }

  readonly set = Effect.fn("AnalyticsPreferences.set")(function* (
    this: AnalyticsPreferenceService,
    enabled: boolean,
    chosen: boolean,
  ) {
    const preference = yield* this.#writes.withPermit(
      writeAnalyticsPreference(this.#path, enabled, chosen).pipe(
        Effect.tap((saved) => Effect.sync(() => this.#setTrackingEnabled(saved.enabled))),
        Effect.uninterruptible,
      ),
    );
    if (chosen && this.#account.getState().status === "signed_in") this.#send(enabled);
    return preference;
  }).bind(this);

  /** Runs on each account change. A signed-in account brings its answer, or receives the unsent one. */
  followAccount(user: CentralAuthUser): void {
    Effect.runFork(
      this.#follow(user).pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The analytics answer did not sync.", toLogValue(error))),
        ),
      ),
    );
  }

  readonly #follow = Effect.fn("AnalyticsPreferences.followAccount")(function* (
    this: AnalyticsPreferenceService,
    user: CentralAuthUser,
  ) {
    const account = user.analyticsEnabled ?? null;
    const unsent = yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const saved = yield* readSavedAnalyticsPreference(this.#path);
        if (saved?.accountPending) {
          if (account !== saved.enabled) return saved.enabled;
          // The account has the choice now.
          yield* writeAnalyticsPreference(this.#path, saved.enabled);
          return null;
        }
        if (account === null || account === saved?.enabled) return null;
        yield* writeAnalyticsPreference(this.#path, account);
        this.#setTrackingEnabled(account);
        return null;
      }),
    );
    if (unsent !== null) this.#send(unsent);
  }).bind(this);

  /** Sends a choice to the account. A failure keeps it unsent until the next account change. */
  #send(enabled: boolean): void {
    if (this.#sending) return;
    this.#sending = true;
    Effect.runFork(
      this.#account.updateAnalytics(enabled).pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The account did not save the analytics answer.", toLogValue(error))),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#sending = false;
          }),
        ),
      ),
    );
  }
}
