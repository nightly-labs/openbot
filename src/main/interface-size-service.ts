import {
  APP_INTERFACE_SIZES,
  type AppInterfaceSizePreference,
  DEFAULT_APP_INTERFACE_SIZE,
  isAppInterfaceSize,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const logger = createOpenBotLogger("interface-size");

const DEFAULT_PREFERENCE: AppInterfaceSizePreference = { percent: DEFAULT_APP_INTERFACE_SIZE };

/** A zoom shortcut or View menu item: one step larger, one step smaller, or the default size. */
export type InterfaceSizeStep = "larger" | "smaller" | "default";

/**
 * The saved size, or the default. A file that is missing, unreadable or names a size this build
 * does not offer reads as the default: a lost size must not stop the app from starting.
 */
const readInterfaceSizePreference = Effect.fn("InterfaceSizePreference.read")((path: string) =>
  readPreferenceFile(path, (parsed): AppInterfaceSizePreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppInterfaceSize(parsed.percent))
      return { ...DEFAULT_PREFERENCE };
    return { percent: parsed.percent };
  }).pipe(Effect.catch(() => Effect.succeed({ ...DEFAULT_PREFERENCE }))),
);

/**
 * The size of the main window's interface. Main holds it because it sets the zoom factor of the
 * window, and the zoom shortcuts and the View menu change it here, not in the renderer.
 */
export class InterfaceSizeService {
  readonly #path: string;
  readonly #listeners = new Set<(preference: AppInterfaceSizePreference) => void>();
  #preference: AppInterfaceSizePreference = { ...DEFAULT_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(input: { path: string }) {
    this.#path = input.path;
  }

  get preference(): AppInterfaceSizePreference {
    return { ...this.#preference };
  }

  /** The zoom factor of the main window. */
  get zoomFactor(): number {
    return this.#preference.percent / 100;
  }

  /** Read the saved preference. Called once at startup, before the renderer loads. */
  load(): Effect.Effect<AppInterfaceSizePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* readInterfaceSizePreference(this.#path);
      return this.preference;
    });
  }

  /** Serialized, as `LogoColorService.set` is, so two quick choices save the newer one. */
  set(preference: AppInterfaceSizePreference): Effect.Effect<AppInterfaceSizePreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(preference.percent));
  }

  /**
   * The step is taken from the size saved when the write starts, inside the same permit, so each
   * press of a held shortcut moves one step from the size before it. A shortcut and a menu item have
   * no place to show an error, so a failed write is logged and the size does not change.
   */
  step(step: InterfaceSizeStep): Effect.Effect<void> {
    return this.#writes
      .withPermit(
        Effect.suspend(() => {
          const index = APP_INTERFACE_SIZES.indexOf(this.#preference.percent);
          const next =
            step === "default"
              ? DEFAULT_APP_INTERFACE_SIZE
              : (APP_INTERFACE_SIZES[
                  Math.min(Math.max(index + (step === "larger" ? 1 : -1), 0), APP_INTERFACE_SIZES.length - 1)
                ] ?? DEFAULT_APP_INTERFACE_SIZE);
          return next === this.#preference.percent ? Effect.void : this.#write(next).pipe(Effect.asVoid);
        }),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The interface size could not be saved.", toLogValue(error))),
        ),
      );
  }

  #write(
    percent: AppInterfaceSizePreference["percent"],
  ): Effect.Effect<AppInterfaceSizePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      yield* writePreferenceFile(this.#path, { version: 1, percent });
      this.#preference = { percent };
      for (const listener of this.#listeners) listener(this.preference);
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  subscribe(listener: (preference: AppInterfaceSizePreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

/**
 * The zoom keys of the main window, as browsers have them: Cmd on macOS, or Ctrl, with = or + (also
 * on the number pad) for larger, - for smaller, and 0 for the default size. + needs Shift on many
 * keyboards, and a menu item takes only one accelerator, so the window reads the keys itself.
 */
export function interfaceSizeShortcut(
  input: { type: string; key: string; control: boolean; meta: boolean; alt: boolean },
  mac: boolean,
): InterfaceSizeStep | null {
  if (input.type !== "keyDown" || input.alt) return null;
  if (!(mac ? input.meta && !input.control : input.control && !input.meta)) return null;
  if (input.key === "=" || input.key === "+") return "larger";
  if (input.key === "-") return "smaller";
  return input.key === "0" ? "default" : null;
}
