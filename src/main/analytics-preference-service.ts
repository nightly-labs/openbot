import type { CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import {
  readAnalyticsPreference,
  readSavedAnalyticsPreference,
  type SavedAnalyticsPreference,
  saveAnalyticsDefault,
  writeAnalyticsPreference,
} from "./analytics-preference-store";

const logger = createOpenBotLogger("analytics-preference");

/** The account side: the signed-in user, and the request that saves an answer on the account. */
export interface AnalyticsAccount {
  getState(): CentralAuthState;
  /** `ageMs` is the age of the choice. The account keeps it only when it has no newer answer. */
  updateAnalytics(enabled: boolean, ageMs: number): Effect.Effect<CentralAuthState, unknown>;
}

export interface AnalyticsPreferenceServiceOptions {
  path: string;
  account: AnalyticsAccount;
  setTrackingEnabled: (enabled: boolean) => void;
  /** Tells the windows about an answer that this computer took from the account. */
  followed: (enabled: boolean) => void;
}

/**
 * The analytics answer of this computer, kept the same as the account's latest answer. A choice of
 * the user goes to the account; a default does not. When the account has an answer and this
 * computer has no unsent choice, this computer follows the account. An "off" from before the
 * account kept answers does not follow an account answer of "on".
 */
export class AnalyticsPreferenceService {
  // One write at a time, so two quick toggles leave the file and the tracker at the last choice.
  readonly #writes = Semaphore.makeUnsafe(1);
  // One send of a choice at a time. Each send reads the latest unsent choice.
  readonly #sends = Semaphore.makeUnsafe(1);
  readonly #path: string;
  readonly #account: AnalyticsAccount;
  readonly #setTrackingEnabled: (enabled: boolean) => void;
  readonly #followed: (enabled: boolean) => void;

  constructor(options: AnalyticsPreferenceServiceOptions) {
    this.#path = options.path;
    this.#account = options.account;
    this.#setTrackingEnabled = options.setTrackingEnabled;
    this.#followed = options.followed;
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

  saveDefault(setupCompleted: boolean) {
    return this.#writes.withPermit(saveAnalyticsDefault(this.#path, setupCompleted));
  }

  readonly set = Effect.fn("AnalyticsPreferences.set")(function* (
    this: AnalyticsPreferenceService,
    enabled: boolean,
    chosen: boolean,
  ) {
    const preference = yield* this.#writes.withPermit(
      readSavedAnalyticsPreference(this.#path).pipe(
        // A choice is always saved. When the earlier answer cannot be read, an "off" stays kept.
        Effect.map((saved) => saved?.keepOff ?? false),
        Effect.orElseSucceed(() => true),
        Effect.flatMap((keepOff) => writeAnalyticsPreference(this.#path, enabled, keepOff, chosen ? Date.now() : null)),
        Effect.tap((saved) => Effect.sync(() => this.#setTrackingEnabled(saved.enabled))),
        Effect.uninterruptible,
      ),
    );
    if (chosen) this.#run(this.#sendUnsent(), "The account did not save the analytics answer.");
    return preference;
  }).bind(this);

  /** Runs on each account change. A signed-in account brings its answer, or receives the unsent one. */
  followAccount(user: CentralAuthUser): void {
    this.#run(this.#follow(user), "The analytics answer did not sync.");
  }

  #run(effect: Effect.Effect<void, unknown>, message: string): void {
    Effect.runFork(effect.pipe(Effect.catch((error) => Effect.sync(() => logger.warn(message, toLogValue(error))))));
  }

  // An unsent choice goes to the account outside the write permit, so reads and writes do not wait for it.
  readonly #follow = Effect.fn("AnalyticsPreferences.followAccount")(function* (
    this: AnalyticsPreferenceService,
    user: CentralAuthUser,
  ) {
    const account = user.analyticsEnabled ?? null;
    const unsent = yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const saved = yield* readSavedAnalyticsPreference(this.#path);
        if (saved?.unsentAt != null) return true;
        if (account === null || account === saved?.enabled || (account && saved?.keepOff)) return false;
        yield* writeAnalyticsPreference(this.#path, account, saved?.keepOff ?? false);
        this.#adopt(account);
        return false;
      }),
    );
    if (unsent) yield* this.#sendUnsent();
  }).bind(this);

  // The account change after a send runs this again. It waits for the send, and then finds no unsent choice.
  readonly #sendUnsent = Effect.fn("AnalyticsPreferences.sendUnsent")(function* (this: AnalyticsPreferenceService) {
    yield* this.#sends.withPermit(
      Effect.gen({ self: this }, function* () {
        const saved = yield* this.#writes.withPermit(readSavedAnalyticsPreference(this.#path));
        if (saved?.unsentAt == null) return;
        const unsentAt = saved.unsentAt;
        const account = yield* this.#request(saved.enabled, unsentAt);
        if (account === undefined) return;
        yield* this.#writes.withPermit(
          Effect.gen({ self: this }, function* () {
            // A newer choice stays unsent; the send that it started reads it.
            const current = yield* readSavedAnalyticsPreference(this.#path);
            if (current?.unsentAt !== unsentAt) return;
            yield* this.#keep(current, account);
          }),
        );
      }),
    );
  }).bind(this);

  /** The account's answer after the send, null when it has none, or undefined when signed out. */
  readonly #request = Effect.fn("AnalyticsPreferences.request")(function* (
    this: AnalyticsPreferenceService,
    enabled: boolean,
    unsentAt: number,
  ) {
    if (this.#account.getState().status !== "signed_in") return undefined;
    const state = yield* this.#account.updateAnalytics(enabled, Math.max(0, Date.now() - unsentAt));
    return state.status === "signed_in" ? (state.user.analyticsEnabled ?? null) : undefined;
  }).bind(this);

  /**
   * Clears the unsent mark. The account keeps a newer answer from another device, and this computer
   * follows it, except for an "on" over a kept "off".
   */
  readonly #keep = Effect.fn("AnalyticsPreferences.keep")(function* (
    this: AnalyticsPreferenceService,
    saved: SavedAnalyticsPreference,
    account: boolean | null,
  ) {
    const answer = saved.keepOff ? saved.enabled : (account ?? saved.enabled);
    yield* writeAnalyticsPreference(this.#path, answer, saved.keepOff);
    if (answer !== saved.enabled) this.#adopt(answer);
  }).bind(this);

  #adopt(enabled: boolean): void {
    this.#setTrackingEnabled(enabled);
    this.#followed(enabled);
  }
}
