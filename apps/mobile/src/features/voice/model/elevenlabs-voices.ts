import { create } from "zustand";
import { ElevenLabsError, listElevenLabsVoices } from "./elevenlabs";
import { type ElevenLabsVoice, readElevenLabsKey } from "./voice-settings";

interface ElevenLabsVoicesState {
  phase: "idle" | "loading" | "ready" | "failed";
  voices: ElevenLabsVoice[];
  failure: ElevenLabsError["code"] | null;
  reason: string | null;
}

export const useElevenLabsVoices = create<ElevenLabsVoicesState>(() => ({
  phase: "idle",
  voices: [],
  failure: null,
  reason: null,
}));

let loading: Promise<void> | null = null;

export function loadElevenLabsVoices(): Promise<void> {
  loading ??= (async () => {
    useElevenLabsVoices.setState({ phase: "loading", failure: null, reason: null });
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
        reason: error instanceof ElevenLabsError ? error.reason : null,
      });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function clearElevenLabsVoices(): void {
  useElevenLabsVoices.setState({ phase: "idle", voices: [], failure: null, reason: null });
}
