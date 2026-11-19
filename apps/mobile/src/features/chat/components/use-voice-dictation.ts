import { referenceFrom } from "@openbot/user-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import {
  isLocalRecognition,
  localRecognitionSupported,
  useParakeetModel,
  useParakeetUnifiedModel,
  useQwenModel,
} from "@/features/voice/model/recognition-models";
import { speechNative } from "@/features/voice/model/speech-native";
import { useVoiceServer } from "@/features/voice/model/voice-server";
import { useVoiceSettings } from "@/features/voice/model/voice-settings";
import { haptics } from "@/shared/lib/haptics";
import { phoneLanguages } from "@/shared/lib/phone-languages";
import { isIOS } from "@/shared/lib/platform";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import {
  applyDictationResult,
  type DictationPhase,
  type DictationTranscript,
  dictationDraft,
  dictationFailedNotice,
  dictationNotice,
  emptyDictationTranscript,
  hasRecognitionLocale,
  isRepeatedFinal,
  microphoneOffNotice,
  pickRecognitionLocale,
  retriesWithSystemService,
  spokenText,
} from "../model/voice-dictation";
import {
  type ModelRecognition,
  modelCaptureAvailable,
  showNotice,
  trackTurn,
  useModelDictation,
} from "./use-model-dictation";

type Recognizer = NonNullable<typeof speechRecognition>;
type StartOptions = Parameters<Recognizer["start"]>[0];
type SupportedLocales = { locales: string[]; installedLocales: string[] };

interface DictationSession {
  base: string;
  transcript: DictationTranscript;
  options: StartOptions | null;
  native: boolean;
  heard: boolean;
  fallback: "none" | "pending" | "used";
  listeningAt: number | null;
  stoppingAt: number | null;
  ending: "cancelled" | "permission_denied" | "operation_failed" | null;
}

function transcriptionOf(options: StartOptions | null): "cloud" | "local" | undefined {
  return !options ? undefined : !options.requiresOnDeviceRecognition ? "cloud" : isIOS ? undefined : "local";
}

let owner: symbol | null = null;

const STOP_TIMEOUT_MS = 3000;

let cachedAvailable: boolean | null = null;

function recognitionAvailable(): boolean {
  if (!speechRecognition) return false;
  if (isIOS) return true;
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    cachedAvailable = speechRecognition.isRecognitionAvailable();
  } catch {
    return false;
  }
  return cachedAvailable;
}

let cachedLocales: Promise<SupportedLocales> | null = null;
let forgetsLocalesOnReturn = false;

function supportedLocales(module: Recognizer): Promise<SupportedLocales> {
  if (!forgetsLocalesOnReturn) {
    forgetsLocalesOnReturn = true;
    AppState.addEventListener("change", (state) => {
      if (state === "active") cachedLocales = null;
    });
  }
  cachedLocales ??= module.getSupportedLocales({}).catch((): SupportedLocales => {
    cachedLocales = null;
    return { locales: [], installedLocales: [] };
  });
  return cachedLocales;
}

async function recognitionOptions(module: Recognizer, supported: Promise<SupportedLocales>) {
  const chosen = useDictationLanguage.getState().value;
  const preferred =
    chosen !== AUTOMATIC_DICTATION_LANGUAGE
      ? [chosen]
      : [...phoneLanguages(), Intl.DateTimeFormat().resolvedOptions().locale];
  const locales = await supported;
  const lang = pickRecognitionLocale(preferred, locales.locales);
  const requiresOnDeviceRecognition =
    isIOS || (module.supportsOnDeviceRecognition() && hasRecognitionLocale(lang, locales.installedLocales));
  return { lang, requiresOnDeviceRecognition };
}

export interface VoiceDictation {
  available: boolean;
  phase: DictationPhase;
  level: SharedValue<number>;
  start: (base: string) => boolean;
  finish: () => Promise<void>;
  cancel: () => void;
}

function useSystemDictation({
  enabled,
  onDraft,
}: {
  enabled: boolean;
  onDraft: (text: string) => void;
}): VoiceDictation {
  const [id] = useState(() => Symbol("dictation"));
  const [available] = useState(recognitionAvailable);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const phaseRef = useRef<DictationPhase>("idle");
  const level = useSharedValue(0);
  const session = useRef<DictationSession | null>(null);
  const finished = useRef<(() => void)[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locales = useRef<Promise<SupportedLocales> | null>(null);
  useEffect(() => {
    const module = speechRecognition;
    if (!module || !available) return;
    const idle = requestIdleCallback(() => {
      locales.current ??= supportedLocales(module);
    });
    return () => cancelIdleCallback(idle);
  }, [available]);
  const onDraftRef = useRef(onDraft);
  useEffect(() => {
    onDraftRef.current = onDraft;
  });

  const update = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const settle = useCallback(() => {
    if (session.current) trackTurn(session.current, transcriptionOf(session.current.options));
    if (owner === id) owner = null;
    session.current = null;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    level.set(0);
    update("idle");
    for (const resolve of finished.current.splice(0)) resolve();
  }, [id, level, update]);

  useEffect(() => {
    if (!speechRecognition) return;
    const subscriptions = [
      speechRecognition.addListener("start", () => {
        if (owner !== id || !session.current?.native || phaseRef.current !== "starting") return;
        session.current.listeningAt ??= performance.now();
        speechNative?.allowHapticsWhileRecording?.();
        update("listening");
        void haptics.impact("light");
      }),
      speechRecognition.addListener("result", (event) => {
        const current = session.current;
        if (owner !== id || !current?.native) return;
        current.heard = true;
        const result = { isFinal: event.isFinal, text: event.results[0]?.transcript ?? "" };
        if (isIOS && isRepeatedFinal(current.transcript, result)) return;
        current.transcript = applyDictationResult(current.transcript, result);
        onDraftRef.current(dictationDraft(current.base, spokenText(current.transcript)));
      }),
      speechRecognition.addListener("error", (event) => {
        const current = session.current;
        if (owner !== id || !current?.native) return;
        if (
          current.options?.requiresOnDeviceRecognition &&
          current.fallback === "none" &&
          !current.heard &&
          phaseRef.current !== "stopping" &&
          retriesWithSystemService(event.error)
        ) {
          current.fallback = "pending";
          return;
        }
        if (phaseRef.current === "stopping" && (!current.heard || event.error === "client")) return;
        const notice = dictationNotice(event.error);
        if (notice) current.ending = event.error === "not-allowed" ? "permission_denied" : "operation_failed";
        if (notice) showNotice(notice, { reference: referenceFrom("speech", event.error) });
      }),
      speechRecognition.addListener("end", () => {
        const current = session.current;
        if (owner !== id || !current?.native) return;
        if (current.fallback === "pending" && current.options && phaseRef.current !== "stopping") {
          current.fallback = "used";
          current.options = { ...current.options, requiresOnDeviceRecognition: false };
          speechRecognition?.start(current.options);
          return;
        }
        settle();
      }),
      speechRecognition.addListener("volumechange", ({ value }) => {
        if (owner === id && session.current?.native)
          level.set(withTiming(Math.min(1, Math.max(0, value / 10)), { duration: 100 }));
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [id, level, settle, update]);

  const start = useCallback(
    (base: string): boolean => {
      const module = speechRecognition;
      if (!module || !available || owner || phaseRef.current !== "idle") return false;
      owner = id;
      const current: DictationSession = {
        base,
        transcript: emptyDictationTranscript,
        options: null,
        native: false,
        heard: false,
        fallback: "none",
        listeningAt: null,
        stoppingAt: null,
        ending: null,
      };
      session.current = current;
      update("starting");
      const stillCurrent = () => owner === id && session.current === current && phaseRef.current === "starting";
      void (async () => {
        try {
          const permission = await module.requestPermissionsAsync();
          if (!stillCurrent()) return;
          if (!permission.granted) {
            current.ending = "permission_denied";
            settle();
            showNotice(microphoneOffNotice);
            return;
          }
          locales.current ??= supportedLocales(module);
          const locale = await recognitionOptions(module, locales.current);
          if (!stillCurrent()) return;
          current.options = {
            ...locale,
            interimResults: true,
            continuous: true,
            addsPunctuation: true,
            iosTaskHint: "dictation",
            volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
          };
          current.native = true;
          module.start(current.options);
        } catch (error) {
          if (session.current !== current) return;
          current.ending = "operation_failed";
          settle();
          showNotice(dictationFailedNotice, error);
        }
      })();
      return true;
    },
    [available, id, settle, update],
  );

  const finish = useCallback((): Promise<void> => {
    if (owner !== id || !speechRecognition) return Promise.resolve();
    if (phaseRef.current === "starting") {
      speechRecognition.abort();
      settle();
      return Promise.resolve();
    }
    const module = speechRecognition;
    return new Promise((resolve) => {
      finished.current.push(resolve);
      if (phaseRef.current === "stopping") return;
      if (session.current) session.current.stoppingAt = performance.now();
      update("stopping");
      void haptics.selection();
      module.stop();
      stopTimer.current = setTimeout(() => {
        if (owner !== id) return;
        module.abort();
        settle();
      }, STOP_TIMEOUT_MS);
    });
  }, [id, settle, update]);

  const cancel = useCallback(() => {
    const current = session.current;
    if (owner !== id || !current) return;
    current.ending = "cancelled";
    speechRecognition?.abort();
    onDraftRef.current(current.base);
    void haptics.selection();
    settle();
  }, [id, settle]);

  const foreground = useAppForeground();
  useEffect(() => {
    if (owner !== id) return;
    if (!enabled || (!foreground && phaseRef.current !== "starting")) void finish();
  }, [enabled, foreground, finish, id]);

  useEffect(
    () => () => {
      for (const resolve of finished.current.splice(0)) resolve();
      if (owner !== id) return;
      speechRecognition?.abort();
      owner = null;
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [id],
  );

  return { available, phase, level, start, finish, cancel };
}

function useActiveRecognition(): "system" | ModelRecognition {
  const recognition = useVoiceSettings((state) => state.recognition);
  const hasKey = useVoiceSettings((state) => state.hasElevenLabsKey);
  const parakeetReady = useParakeetModel((state) => state.phase === "ready");
  const unifiedReady = useParakeetUnifiedModel((state) => state.phase === "ready");
  const qwenReady = useQwenModel((state) => state.phase === "ready");
  const serverDictates = useVoiceServer((state) => state.server?.routes.dictation === true);
  if (!modelCaptureAvailable()) return "system";
  const ready = { parakeet: parakeetReady, "parakeet-unified": unifiedReady, "qwen3-asr": qwenReady };
  if (isLocalRecognition(recognition) && ready[recognition] && localRecognitionSupported(recognition))
    return recognition;
  if (recognition === "elevenlabs" && hasKey) return "elevenlabs";
  if (recognition === "voice-server" && serverDictates) return "voice-server";
  return "system";
}

export function useVoiceDictation({
  enabled,
  onDraft,
  endsOnPause = false,
}: {
  enabled: boolean;
  onDraft: (text: string) => void;
  endsOnPause?: boolean;
}): VoiceDictation {
  const engine = useActiveRecognition();
  const system = useSystemDictation({ enabled: enabled && engine === "system", onDraft });
  const model = useModelDictation({
    engine: engine === "system" ? null : engine,
    enabled: enabled && engine !== "system",
    onDraft,
    endsOnPause,
  });
  return engine === "system" ? system : model;
}
