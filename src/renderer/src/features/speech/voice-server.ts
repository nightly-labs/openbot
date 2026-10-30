import type { VoiceServerSettings } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";

const [server, setServer] = createSignal<VoiceServerSettings | null | undefined>(undefined);
let following = false;

/**
 * The user's own voice server, or null. The first read starts to follow the setting; the answer is
 * undefined until main tells it.
 */
export function voiceServer(): VoiceServerSettings | null | undefined {
  if (!following) {
    following = true;
    const voice = speechPort().voice;
    voice.onServerSettings((next) => setServer(next));
    void voice.getServer().then(
      (next) => setServer((current) => (current === undefined ? next : current)),
      () => undefined,
    );
  }
  return server();
}
