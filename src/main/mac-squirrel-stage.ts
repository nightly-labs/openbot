import { Effect } from "effect";
import type { AutoUpdater } from "electron";

export type SquirrelUpdater = Pick<AutoUpdater, "checkForUpdates" | "once" | "removeListener">;

export class SquirrelStageFailed extends Error {}

export const SQUIRREL_STAGE_TIMEOUT_MS = 120_000;

export function stageSquirrelUpdate(
  nativeUpdater: SquirrelUpdater,
  timeoutMs = SQUIRREL_STAGE_TIMEOUT_MS,
): Effect.Effect<void, SquirrelStageFailed> {
  return Effect.callback<void, SquirrelStageFailed>((resume) => {
    const removeListeners = () => {
      clearTimeout(deadline);
      nativeUpdater.removeListener("update-downloaded", staged);
      nativeUpdater.removeListener("update-not-available", notStaged);
      nativeUpdater.removeListener("error", failed);
    };
    const staged = () => {
      removeListeners();
      resume(Effect.void);
    };
    const notStaged = () => {
      removeListeners();
      resume(Effect.fail(new SquirrelStageFailed("Squirrel found no update to stage.")));
    };
    const failed = (error: Error) => {
      removeListeners();
      resume(Effect.fail(new SquirrelStageFailed(error.message)));
    };
    const deadline = setTimeout(() => {
      removeListeners();
      resume(Effect.fail(new SquirrelStageFailed(`Squirrel did not stage the update within ${timeoutMs} ms.`)));
    }, timeoutMs);
    nativeUpdater.once("update-downloaded", staged);
    nativeUpdater.once("update-not-available", notStaged);
    nativeUpdater.once("error", failed);
    nativeUpdater.checkForUpdates();
    return Effect.sync(removeListeners);
  });
}
