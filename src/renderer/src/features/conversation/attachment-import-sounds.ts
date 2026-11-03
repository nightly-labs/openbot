import { playActionSound } from "../../action-sounds";

/** An import that ends before this time plays only its result, so a fast paste does not play two cues. */
const SLOW_IMPORT_MS = 400;
/** Each file of a drop is its own import. Their cues come together, and one of each kind is enough. */
const REPEAT_CUE_MS = 250;

/**
 * The cues of each attachment import: `loading` when the import is slow, then `success` or `error`.
 * `cancel` and `dispose` stop a `loading` cue that did not play yet.
 */
export function createAttachmentImportSounds() {
  // One timer per import, so an import that ends first does not stop the cue of a slower one.
  const slowCues = new Map<string, ReturnType<typeof setTimeout>>();
  let lastCue: { sound: "loading" | "success" | "error"; at: number } | null = null;
  const play = (sound: "loading" | "success" | "error") => {
    const now = Date.now();
    if (lastCue?.sound === sound && now - lastCue.at < REPEAT_CUE_MS) return;
    lastCue = { sound, at: now };
    playActionSound(sound, sound === "error" ? undefined : { emphasis: "subtle" });
  };
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
          play("loading");
        }, SLOW_IMPORT_MS),
      );
    },
    finished(requestId: string, outcome: "success" | "error") {
      cancel(requestId);
      play(outcome);
    },
    cancel,
    dispose() {
      for (const timer of slowCues.values()) clearTimeout(timer);
      slowCues.clear();
    },
  };
}
