import { referenceFrom } from "@openbot/user-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import { type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { parakeetSupported, useParakeetModel } from "@/features/voice/model/parakeet-model";
import { useVoiceSettings } from "@/features/voice/model/voice-settings";
import { haptics } from "@/shared/lib/haptics";
import { phoneLanguages } from "@/shared/lib/phone-languages";
import { isIOS } from "@/shared/lib/platform";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import {
  applyDictationResult,
  type DictationNotice,
  type DictationPhase,
  type DictationTranscript,
  dictationDraft,
  dictationFailedNotice,
  dictationNotice,
  emptyDictationTranscript,
  hasRecognitionLocale,
  microphoneOffNotice,
  pickRecognitionLocale,
  retriesWithSystemService,
  spokenText,
} from "../model/voice-dictation";
import { type ModelRecognition, modelCaptureAvailable, useModelDictation } from "./use-model-dictation";

type Recognizer = NonNullable<typeof speechRecognition>;
type StartOptions = Parameters<Recognizer["start"]>[0];
type SupportedLocales = { locales: string[]; installedLocales: string[] };

interface DictationSession {
  base: string;
  transcript: DictationTranscript;
  /** Null until permission and the locale are known. */
  options: StartOptions | null;
  /**
   * The native recognizer runs for this session. Events before that belong to
   * an earlier one: `abort()` reports its `end` later, sometimes after the next
   * mic press.
   */
  native: boolean;
  heard: boolean;
  /** `pending` restarts with the system service when the failed session ends. */
  fallback: "none" | "pending" | "used";
  /** For analytics: when the recognizer started to listen, and when the user stopped it. */
  listeningAt: number | null;
  stoppingAt: number | null;
  /** For analytics: why the session ended without text, when it did not end normally. */
  ending: "cancelled" | "permission_denied" | "operation_failed" | null;
}

/** One analytics event for each dictation session. It has no words of the transcript. */
function trackTurn(current: DictationSession): void {
  const now = performance.now();
  const failed = current.ending === "permission_denied" || current.ending === "operation_failed";
  const options = current.options;
  mobileAnalytics.track("voice_turn", {
    server_kind: "remote",
    // iOS can use Apple's service where on-device recognition is not available, so iOS does not say which ran.
    transcription: !options ? undefined : !options.requiresOnDeviceRecognition ? "cloud" : isIOS ? undefined : "local",
    result: failed ? "failed" : current.ending === "cancelled" || !current.heard ? "cancelled" : "succeeded",
    failure_code: !failed
      ? undefined
      : current.ending === "permission_denied"
        ? "permission_denied"
        : "operation_failed",
    audio_duration_seconds:
      current.listeningAt === null ? 0 : ((current.stoppingAt ?? now) - current.listeningAt) / 1_000,
    // The time from the stop to the final text.
    duration_ms: current.stoppingAt === null ? undefined : now - current.stoppingAt,
  });
}

// The recognizer is one native session for the whole app, and every mounted
// chat receives its events. Only the composer that started the session reacts.
let owner: symbol | null = null;

// A stop that never reports its end must not hold the composer. The draft
// already has the last partial result, so nothing is lost.
const STOP_TIMEOUT_MS = 3000;

let cachedAvailable: boolean | null = null;

/**
 * iOS answers for the phone's default locale and the network state at the time
 * of the call, which can change or differ from the dictation language. So iOS
 * only needs the module, and a failed start explains itself. Android answers
 * whether any recognition service is installed, which does not change.
 */
function recognitionAvailable(): boolean {
  if (!speechRecognition) return false;
  if (isIOS) return true;
  // Each chat asked again when it opened: on Android a synchronous package manager query.
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    cachedAvailable = speechRecognition.isRecognitionAvailable();
  } catch {
    return false;
  }
  return cachedAvailable;
}

// On Android the service makes a recognizer on the main thread to list its languages, which each
// chat did during its open animation. The list stays for one visit to the app: the user can install
// a language in the meantime.
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
    // The next chat asks again.
    cachedLocales = null;
    return { locales: [], installedLocales: [] };
  });
  return cachedLocales;
}

async function recognitionOptions(module: Recognizer, supported: Promise<SupportedLocales>) {
  // The phone's language list, not the app's locale. OpenBot has one
  // localization, so the app's own locale can be English on a Polish phone.
  const chosen = useDictationLanguage.getState().value;
  const preferred =
    chosen !== AUTOMATIC_DICTATION_LANGUAGE
      ? [chosen]
      : [...phoneLanguages(), Intl.DateTimeFormat().resolvedOptions().locale];
  const locales = await supported;
  const lang = pickRecognitionLocale(preferred, locales.locales);
  // iOS applies this only where the recognizer supports it, and uses Apple's
  // service otherwise. Android fails without an installed language model, so
  // ask for on-device recognition only for an installed locale.
  const requiresOnDeviceRecognition =
    isIOS || (module.supportsOnDeviceRecognition() && hasRecognitionLocale(lang, locales.installedLocales));
  return { lang, requiresOnDeviceRecognition };
}

function showNotice(notice: DictationNotice, error?: unknown): void {
  void haptics.notification("error");
  const { t } = currentText();
  showFailureAlert(
    error,
    "voice",
    t(notice.title),
    t(notice.message),
    notice.openSettings
      ? [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("mobile.chat.dictation.openSettings"), onPress: () => void Linking.openSettings() },
        ]
      : undefined,
  );
}

export interface VoiceDictation {
  available: boolean;
  phase: DictationPhase;
  /** Input level from 0 to 1, for the listening indicator. */
  level: SharedValue<number>;
  /**
   * Starts listening. The speech goes after `base` in the draft. False when it
   * cannot start: no recognizer, or another session still runs.
   */
  start: (base: string) => boolean;
  /** Stops listening and keeps the text. Resolves after the final result. */
  finish: () => Promise<void>;
  /** Stops listening and puts back the draft from before the mic. */
  cancel: () => void;
}

/**
 * Live dictation into the composer draft with the phone's recognizer, in one
 * language. Each result replaces the spoken part of the draft, so the user sees
 * the text while speaking. Nothing is sent here.
 */
function useSystemDictation({
  enabled,
  onDraft,
}: {
  /** False stops listening and keeps the text, for example when the chat goes offline. */
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
  // Read after the chat opens, so a mic press does not wait for the service. A press before then
  // asks the service itself.
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
    if (session.current) trackTurn(session.current);
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
        update("listening");
        void haptics.impact("light");
      }),
      speechRecognition.addListener("result", (event) => {
        const current = session.current;
        if (owner !== id || !current?.native) return;
        current.heard = true;
        current.transcript = applyDictationResult(current.transcript, {
          isFinal: event.isFinal,
          text: event.results[0]?.transcript ?? "",
        });
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
        // The user stopped it. Android reports its own stop as a "client" error,
        // and with nothing said any error there loses nothing. No message.
        if (phaseRef.current === "stopping" && (!current.heard || event.error === "client")) return;
        const notice = dictationNotice(event.error);
        if (notice) current.ending = event.error === "not-allowed" ? "permission_denied" : "operation_failed";
        // The recognizer's error name is a fixed identifier, so it can be the code of the failure.
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
        // The platform reports -2 to 10, and anything below 0 is silence.
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
      // A cancel, or a cancel and a new press, can happen during either wait.
      // Only this session may continue.
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
      // No speech yet: the permission prompt or the recognizer is still opening.
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
    // Android reports the app as in the background while its permission dialog
    // is open, so the first press must not stop itself there.
    if (!enabled || (!foreground && phaseRef.current !== "starting")) void finish();
  }, [enabled, foreground, finish, id]);

  useEffect(
    () => () => {
      if (owner !== id) return;
      // The draft already holds the last result, so leaving the chat keeps it.
      speechRecognition?.abort();
      owner = null;
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [id],
  );

  return { available, phase, level, start, finish, cancel };
}

/**
 * The recognizer that Settings > Voice chose, when it can run now. Parakeet needs its model and
 * enough memory, ElevenLabs needs a key, and both need a speech module with a microphone. Otherwise
 * the phone's recognizer listens, so the microphone always works.
 */
function useActiveRecognition(): "system" | ModelRecognition {
  const recognition = useVoiceSettings((state) => state.recognition);
  const hasKey = useVoiceSettings((state) => state.hasElevenLabsKey);
  const parakeetReady = useParakeetModel((state) => state.phase === "ready");
  if (!modelCaptureAvailable()) return "system";
  if (recognition === "parakeet" && parakeetReady && parakeetSupported()) return "parakeet";
  if (recognition === "elevenlabs" && hasKey) return "elevenlabs";
  return "system";
}

/**
 * Live dictation into the composer draft with the recognizer of Settings > Voice: the phone's own,
 * Parakeet on the phone, or ElevenLabs Scribe. Nothing is sent here.
 */
export function useVoiceDictation({
  enabled,
  onDraft,
  onSpeaking,
}: {
  /** False stops listening and keeps the text, for example when the chat goes offline. */
  enabled: boolean;
  onDraft: (text: string) => void;
  /** The user speaks now. Only Parakeet and ElevenLabs report it, about ten times a second. */
  onSpeaking?: () => void;
}): VoiceDictation {
  const engine = useActiveRecognition();
  const system = useSystemDictation({ enabled: enabled && engine === "system", onDraft });
  const model = useModelDictation({
    engine: engine === "system" ? null : engine,
    enabled: enabled && engine !== "system",
    onDraft,
    onSpeaking,
  });
  return engine === "system" ? system : model;
}
