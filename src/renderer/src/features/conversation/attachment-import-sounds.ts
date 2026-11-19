import { playActionSound } from "../../action-sounds";

const SLOW_IMPORT_MS = 400;
const REPEAT_CUE_MS = 250;

export function createAttachmentImportSounds() {
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
