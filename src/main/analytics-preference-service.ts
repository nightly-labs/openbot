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

export interface AnalyticsAccount {
  getState(): CentralAuthState;
  updateAnalytics(enabled: boolean, ageMs: number): Effect.Effect<CentralAuthState, unknown>;
}

export interface AnalyticsPreferenceServiceOptions {
  path: string;
  account: AnalyticsAccount;
  setTrackingEnabled: (enabled: boolean) => void;
  followed: (enabled: boolean) => void;
}

export class AnalyticsPreferenceService {
  readonly #writes = Semaphore.makeUnsafe(1);
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

  read(setupCompleted: boolean) {
    return this.#writes.withPermit(readAnalyticsPreference(this.#path, setupCompleted));
  }

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

  followAccount(user: CentralAuthUser): void {
    this.#run(this.#follow(user), "The analytics answer did not sync.");
  }

  #run(effect: Effect.Effect<void, unknown>, message: string): void {
    Effect.runFork(effect.pipe(Effect.catch((error) => Effect.sync(() => logger.warn(message, toLogValue(error))))));
  }

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
            const current = yield* readSavedAnalyticsPreference(this.#path);
            if (current?.unsentAt !== unsentAt) return;
            yield* this.#keep(current, account);
          }),
        );
      }),
    );
  }).bind(this);

  readonly #request = Effect.fn("AnalyticsPreferences.request")(function* (
    this: AnalyticsPreferenceService,
    enabled: boolean,
    unsentAt: number,
  ) {
    if (this.#account.getState().status !== "signed_in") return undefined;
    const state = yield* this.#account.updateAnalytics(enabled, Math.max(0, Date.now() - unsentAt));
    return state.status === "signed_in" ? (state.user.analyticsEnabled ?? null) : undefined;
  }).bind(this);

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
