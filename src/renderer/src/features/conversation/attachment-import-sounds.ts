import { playActionSound } from "../../action-sounds";

/** An import that ends before this time plays only its result, so a fast paste does not play two cues. */
const SLOW_IMPORT_MS = 400;

/**
 * The cues of an attachment import: `loading` when the import is slow, then `success` or `error`.
 * `dispose` stops a `loading` cue that did not play yet.
 */
export function createAttachmentImportSounds() {
  let slowCue: ReturnType<typeof setTimeout> | undefined;
  const cancelSlowCue = () => {
    if (slowCue !== undefined) clearTimeout(slowCue);
    slowCue = undefined;
  };
  return {
    started() {
      if (slowCue !== undefined) return;
      slowCue = setTimeout(() => {
        slowCue = undefined;
        playActionSound("loading", { emphasis: "subtle" });
      }, SLOW_IMPORT_MS);
    },
    finished(outcome: "success" | "error") {
      cancelSlowCue();
      playActionSound(outcome, outcome === "success" ? { emphasis: "subtle" } : undefined);
    },
    dispose: cancelSlowCue,
  };
}
