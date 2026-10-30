import type { SpeechModelStatus } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";
import { voiceServer } from "./voice-server";

const [status, setStatus] = createSignal<SpeechModelStatus["phase"] | null>(null);
let following = false;

/**
 * Whether a reply can be read aloud: the speech model is on this computer, or the user's own voice
 * server speaks. The first read starts to follow the model status; the answer is false until main
 * tells it.
 */
export function speechModelReady(): boolean {
  if (!following) {
    following = true;
    const voice = speechPort().voice;
    voice.onSpeechModelStatus((next) => setStatus(next.phase));
    void voice.getSpeechModelStatus().then(
      (next) => setStatus((current) => current ?? next.phase),
      () => undefined,
    );
  }
  return status() === "ready" || voiceServer()?.routes.speech === true;
}
