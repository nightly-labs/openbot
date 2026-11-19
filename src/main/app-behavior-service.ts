import {
  type AppBehaviorPreference,
  type AppBehaviorPreferenceChange,
  DEFAULT_QUIT_GUARD,
  QUIT_GUARDS,
  type QuitGuard,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import type { LoginItem, LoginItemFailure } from "./login-item";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const logger = createOpenBotLogger("app-behavior");

export class AppBehaviorService {
  readonly #path: string;
  readonly #loginItem: LoginItem | null;
  readonly #offersBackground: boolean;
  readonly #menuBar: boolean;
  readonly #offersKeepAwake: boolean;
  readonly #offersQuitGuard: boolean;
  #keepRunningInBackground = false;
  #keepAwake = false;
  #keepAwakeOnBattery = false;
  #quitGuard: QuitGuard = DEFAULT_QUIT_GUARD;
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<() => void>();

  constructor(input: {
    path: string;
    loginItem: LoginItem | null;
    offersBackground: boolean;
    menuBar: boolean;
    offersKeepAwake: boolean;
    offersQuitGuard: boolean;
  }) {
    this.#path = input.path;
    this.#loginItem = input.loginItem;
    this.#offersBackground = input.offersBackground;
    this.#menuBar = input.menuBar;
    this.#keepRunningInBackground = input.menuBar;
    this.#offersKeepAwake = input.offersKeepAwake;
    this.#offersQuitGuard = input.offersQuitGuard;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed) =>
          isDynamicRecord(parsed) && parsed.version === 1
            ? {
                keepRunningInBackground: this.#menuBar
                  ? parsed.menuBar !== false
                  : parsed.keepRunningInBackground === true,
                keepAwake: parsed.keepAwake === true,
                keepAwakeOnBattery: parsed.keepAwakeOnBattery === true,
                quitGuard: isOneOf(QUIT_GUARDS, parsed.quitGuard) ? parsed.quitGuard : DEFAULT_QUIT_GUARD,
              }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success !== null) {
          this.#keepRunningInBackground = loaded.success.keepRunningInBackground;
          this.#keepAwake = loaded.success.keepAwake;
          this.#keepAwakeOnBattery = loaded.success.keepAwakeOnBattery;
          this.#quitGuard = loaded.success.quitGuard;
        }
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get keepRunningInBackground(): boolean {
    return this.#offersBackground && this.#keepRunningInBackground;
  }

  get keepAwake(): boolean {
    return this.#offersKeepAwake && this.#keepAwake;
  }

  get keepAwakeOnBattery(): boolean {
    return this.#offersKeepAwake && this.#keepAwakeOnBattery;
  }

  get quitGuard(): QuitGuard {
    return this.#offersQuitGuard ? this.#quitGuard : DEFAULT_QUIT_GUARD;
  }

  readonly get = Effect.fn("AppBehavior.get")(function* (this: AppBehaviorService) {
    const preference: AppBehaviorPreference = {
      launchAtLogin: yield* this.#readLoginItem(),
      keepRunningInBackground: this.#offersBackground ? this.#keepRunningInBackground : null,
      keepAwake: this.#offersKeepAwake ? this.#keepAwake : null,
      keepAwakeOnBattery: this.#offersKeepAwake ? this.#keepAwakeOnBattery : null,
      quitGuard: this.#offersQuitGuard ? this.#quitGuard : null,
    };
    return preference;
  });

  #readLoginItem(): Effect.Effect<boolean | null> {
    if (!this.#loginItem) return Effect.succeed(null);
    return this.#loginItem.read().pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("The login item could not be read.", toLogValue(error));
          return null;
        }),
      ),
    );
  }

  readonly set = Effect.fn("AppBehavior.set")(function* (
    this: AppBehaviorService,
    change: AppBehaviorPreferenceChange,
  ): Effect.fn.Return<AppBehaviorPreference, LoginItemFailure | PreferenceFileFailure> {
    const launchAtLogin = change.launchAtLogin;
    const loginItem = this.#loginItem;
    if (launchAtLogin !== undefined && loginItem)
      yield* this.#writes.withPermit(Effect.uninterruptible(loginItem.write(launchAtLogin)));
    const keepRunningInBackground = this.#offersBackground ? change.keepRunningInBackground : undefined;
    const keepAwake = this.#offersKeepAwake ? change.keepAwake : undefined;
    const keepAwakeOnBattery = this.#offersKeepAwake ? change.keepAwakeOnBattery : undefined;
    const quitGuard = this.#offersQuitGuard ? change.quitGuard : undefined;
    if (
      keepRunningInBackground !== undefined ||
      keepAwake !== undefined ||
      keepAwakeOnBattery !== undefined ||
      quitGuard !== undefined
    ) {
      yield* this.#writes.withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const next = {
              keepRunningInBackground: keepRunningInBackground ?? this.#keepRunningInBackground,
              keepAwake: keepAwake ?? this.#keepAwake,
              keepAwakeOnBattery: keepAwakeOnBattery ?? this.#keepAwakeOnBattery,
              quitGuard: quitGuard ?? this.#quitGuard,
            };
            const { keepRunningInBackground: running, ...others } = next;
            const file = this.#menuBar
              ? { menuBar: running, ...others }
              : { keepRunningInBackground: running, ...others };
            return writePreferenceFile(this.#path, { version: 1, ...file }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  this.#keepRunningInBackground = next.keepRunningInBackground;
                  this.#keepAwake = next.keepAwake;
                  this.#keepAwakeOnBattery = next.keepAwakeOnBattery;
                  this.#quitGuard = next.quitGuard;
                }),
              ),
            );
          }),
        ),
      );
      for (const listener of this.#listeners) listener();
    }
    return yield* this.get();
  });

  refreshLoginItem(): Effect.Effect<void, LoginItemFailure> {
    return this.#loginItem ? this.#writes.withPermit(Effect.uninterruptible(this.#loginItem.refresh())) : Effect.void;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
