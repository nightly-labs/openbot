import { nextSpeechSpeed, type OpenBotDesktopApi, type SpeechSettings, type SpeechSpeed } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { setReplyPlaybackRate } from "./speech-playback";
import { speechPort } from "./speech-port";

const [speed, setSpeed] = createSignal<SpeechSpeed>(1);
let loading: Promise<void> | undefined;
/** True after the user changed the speed, so that a slower first load does not undo the change. */
let changed = false;
/** The speed that main saved last. A failed save goes back to it. */
let saved: SpeechSpeed = 1;
/** The saves of speech settings in the order of the changes, so that the last change is also the last save. */
let saving: Promise<unknown> = Promise.resolve();

function apply(next: SpeechSpeed): void {
  setSpeed(next);
  setReplyPlaybackRate(next);
}

/**
 * Saves a change to the speech settings after the saves before it. Each save reads the settings
 * again, so that it keeps a change that another control made since its own load.
 */
export function updateSpeechSettings(
  voice: Pick<OpenBotDesktopApi["voice"], "getSpeechSettings" | "setSpeechSettings">,
  patch: Partial<SpeechSettings>,
): Promise<SpeechSettings> {
  const next = saving.then(async () => voice.setSpeechSettings({ ...(await voice.getSpeechSettings()), ...patch }));
  saving = next.catch(() => undefined);
  return next;
}

/**
 * The speed of replies that are read aloud. The first read loads the saved speed; until main
 * answers, it is normal speed.
 */
export function speechSpeed(): SpeechSpeed {
  void loadSpeechSpeed();
  return speed();
}

/** Loads the saved speed once, before a reply plays. A failure is forgotten, so the next call tries again. */
export function loadSpeechSpeed(): Promise<void> {
  loading ??= speechPort()
    .voice.getSpeechSettings()
    .then(
      (settings) => {
        if (changed) return;
        saved = settings.speed;
        apply(settings.speed);
      },
      () => {
        loading = undefined;
      },
    );
  return loading;
}

/**
 * Changes the speed of replies, also of the reply that plays now, and saves it. A failed save goes
 * back to the speed that main saved last.
 */
export function changeSpeechSpeed(next: SpeechSpeed): void {
  if (next === speed()) return;
  changed = true;
  apply(next);
  updateSpeechSettings(speechPort().voice, { speed: next }).then(
    (settings) => {
      saved = settings.speed;
    },
    () => {
      if (speed() === next) apply(saved);
      toast.error(currentText().t("settings.voice.saveFailed"), {
        report: { operation: "settings", source: "system", cause_code: "unknown" },
      });
    },
  );
}

/**
 * Changes to the next speed of a speed button: 1×, 1.25×, 1.5×, 2×, 0.75×, then 1× again. It waits
 * for the saved speed, so that a click before the load does not start from normal speed.
 */
export function cycleSpeechSpeed(): void {
  void loadSpeechSpeed().then(() => {
    changeSpeechSpeed(nextSpeechSpeed(speed()));
  });
}
