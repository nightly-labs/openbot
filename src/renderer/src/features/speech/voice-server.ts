import type { VoiceServerSettings } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";

const [server, setServer] = createSignal<VoiceServerSettings | null | undefined>(undefined);
let following = false;

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
