import { create } from "zustand";
import { ElevenLabsError, listElevenLabsVoices } from "./elevenlabs";
import { type ElevenLabsVoice, readElevenLabsKey } from "./voice-settings";

interface ElevenLabsVoicesState {
  phase: "idle" | "loading" | "ready" | "failed";
  voices: ElevenLabsVoice[];
  failure: ElevenLabsError["code"] | null;
}

/** The voices of the saved key, shared by the Voice page and the voice list. */
export const useElevenLabsVoices = create<ElevenLabsVoicesState>(() => ({ phase: "idle", voices: [], failure: null }));

let loading: Promise<void> | null = null;

/** Lists the voices of the saved key. A second call while one runs waits for it. */
export function loadElevenLabsVoices(): Promise<void> {
  loading ??= (async () => {
    useElevenLabsVoices.setState({ phase: "loading", failure: null });
    try {
      const key = await readElevenLabsKey();
      if (!key) {
        useElevenLabsVoices.setState({ phase: "idle", voices: [] });
        return;
      }
      useElevenLabsVoices.setState({ phase: "ready", voices: await listElevenLabsVoices(key) });
    } catch (error) {
      useElevenLabsVoices.setState({
        phase: "failed",
        failure: error instanceof ElevenLabsError ? error.code : "failed",
      });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Forgets the voices of a removed key. */
export function clearElevenLabsVoices(): void {
  useElevenLabsVoices.setState({ phase: "idle", voices: [], failure: null });
}
