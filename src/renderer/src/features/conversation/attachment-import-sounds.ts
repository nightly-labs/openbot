import { playActionSound } from "../../action-sounds";

/** An import that ends before this time plays only its result, so a fast paste does not play two cues. */
const SLOW_IMPORT_MS = 400;

/**
 * The cues of each attachment import: `loading` when the import is slow, then `success` or `error`.
 * `cancel` and `dispose` stop a `loading` cue that did not play yet.
 */
export function createAttachmentImportSounds() {
  // One timer per import, so an import that ends first does not stop the cue of a slower one.
  const slowCues = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (requestId: string) => {
    clearTimeout(slowCues.get(requestId));
    slowCues.delete(requestId);
  };
  return {
    started(requestId: string) {
      cancel(requestId);
      slowCues.set(
        requestId,
        setTimeout(() => {
          slowCues.delete(requestId);
          playActionSound("loading", { emphasis: "subtle" });
        }, SLOW_IMPORT_MS),
      );
    },
    finished(requestId: string, outcome: "success" | "error") {
      cancel(requestId);
      playActionSound(outcome, outcome === "success" ? { emphasis: "subtle" } : undefined);
    },
    cancel,
    dispose() {
      for (const timer of slowCues.values()) clearTimeout(timer);
      slowCues.clear();
    },
  };
}
