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

/**
 * How OpenBot starts and stops on this computer, if it keeps the computer awake, and when `Cmd + Q`
 * on a Mac needs a hold or a second press.
 *
 * The keep-running choice is stored here, because main reads it each time the main window closes.
 * On macOS it is the menu bar choice, stored as `menuBar`, and it is on unless the user turned it
 * off. Older versions wrote `keepRunningInBackground: false` on macOS when they saved a keep-awake
 * choice, but they did not offer the switch there, so that value is not a choice of the user.
 * The keep-awake choices and the quit guard are stored in the same file, and each write keeps all of them. The launch-at-login
 * choice is not stored: the operating system holds it, and the user can change it there.
 *
 * A file that is missing or unreadable as JSON reads as the defaults, and so does a switch that it
 * does not have: all off, except the menu bar on macOS, and the quit guard is "working". Writes of the file
 * and of the login item are chained for the reason `update-preference-store.ts` chains its own: on
 * Linux, a removal of the autostart entry must not finish before an earlier write of it.
 */
export class AppBehaviorService {
  readonly #path: string;
  /** Null where this run cannot open itself at login. */
  readonly #loginItem: LoginItem | null;
  /** False on a server, which has no window to close. */
  readonly #offersBackground: boolean;
  /** On macOS the keep-running choice shows OpenBot in the menu bar. */
  readonly #menuBar: boolean;
  /** False on Linux, where Electron does not report a change of the power source, and on a server. */
  readonly #offersKeepAwake: boolean;
  /** Only the Mac desktop app guards `Cmd + Q`. */
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

  /** Read on each close of the main window. */
  get keepRunningInBackground(): boolean {
    return this.#offersBackground && this.#keepRunningInBackground;
  }

  /** The user chose to keep this computer awake while it is on its power adapter. */
  get keepAwake(): boolean {
    return this.#offersKeepAwake && this.#keepAwake;
  }

  /** The user chose to keep this computer awake on battery power too. */
  get keepAwakeOnBattery(): boolean {
    return this.#offersKeepAwake && this.#keepAwakeOnBattery;
  }

  /** Read on each press of `Cmd + Q`. */
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

  /**
   * A login item that cannot be read is not offered, as in a development run. The keep-running
   * switch does not depend on it, so its failure must not hide that switch or fail a save of it.
   */
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

  /** Points an existing login item at the running copy, which an update can move on Linux. */
  refreshLoginItem(): Effect.Effect<void, LoginItemFailure> {
    return this.#loginItem ? this.#writes.withPermit(Effect.uninterruptible(this.#loginItem.refresh())) : Effect.void;
  }

  /** Called when the keep-running choice, a keep-awake choice or the quit guard is saved. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
