import { referenceFrom } from "@openbot/user-errors";
import { CodedError } from "expo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { ElevenLabsError, scribeToken } from "@/features/voice/model/elevenlabs";
import { parakeetModel } from "@/features/voice/model/parakeet-model";
import { type ScribeFailure, ScribeRealtimeSession } from "@/features/voice/model/scribe-realtime";
import { speechNative } from "@/features/voice/model/speech-native";
import { readElevenLabsKey } from "@/features/voice/model/voice-settings";
import { haptics } from "@/shared/lib/haptics";
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
  emptyDictationTranscript,
  microphoneOffNotice,
  spokenText,
} from "../model/voice-dictation";
import type { VoiceDictation } from "./use-voice-dictation";

/** The engines that capture the microphone in the speech module, not in the phone's recognizer. */
export type ModelRecognition = "parakeet" | "elevenlabs";

/** Parakeet decodes faster with more threads, and a phone has four or more cores. */
const PARAKEET_THREADS = 4;
/**
 * A finish that never reports its end must not hold the composer. Parakeet decodes the last segment
 * in about a second; ElevenLabs can take up to ten seconds for its last segment.
 */
const STOP_TIMEOUT_MS = { parakeet: 8_000, elevenlabs: 12_000 } as const;

const SCRIBE_NOTICES: Record<ScribeFailure | ElevenLabsError["code"], DictationNotice> = {
  network: { title: "mobile.chat.dictation.stopped", message: "mobile.chat.liveVoice.networkNeeded" },
  "invalid-key": { title: "mobile.chat.dictation.stopped", message: "mobile.chat.liveVoice.elevenLabsKeyInvalid" },
  "missing-transcription-permission": {
    title: "mobile.chat.dictation.stopped",
    message: "mobile.chat.dictation.elevenLabsPermission",
  },
  "missing-voices-permission": {
    title: "mobile.chat.dictation.stopped",
    message: "mobile.chat.liveVoice.elevenLabsPermission",
  },
  "missing-speech-permission": {
    title: "mobile.chat.dictation.stopped",
    message: "mobile.chat.liveVoice.elevenLabsPermission",
  },
  quota: { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.elevenLabsQuota" },
  "rate-limited": { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.elevenLabsBusy" },
  terms: { title: "mobile.chat.dictation.stopped", message: "mobile.chat.dictation.elevenLabsTerms" },
  failed: dictationFailedNotice,
};

const modelLoadNotice: DictationNotice = {
  title: "mobile.chat.dictation.unavailable",
  message: "mobile.chat.dictation.modelLoadFailed",
};

interface CaptureSession {
  engine: ModelRecognition;
  base: string;
  transcript: DictationTranscript;
  /** The ElevenLabs session; null for Parakeet. */
  scribe: ScribeRealtimeSession | null;
  /** The token request, which a cancel stops. */
  abort: AbortController;
  /** The microphone is open for this session. Events before that belong to an earlier one. */
  native: boolean;
  heard: boolean;
  listeningAt: number | null;
  stoppingAt: number | null;
  ending: "cancelled" | "permission_denied" | "operation_failed" | null;
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

/** One analytics event for each session. It has no words of the transcript. */
function trackTurn(current: CaptureSession): void {
  const now = performance.now();
  const failed = current.ending === "permission_denied" || current.ending === "operation_failed";
  mobileAnalytics.track("voice_turn", {
    server_kind: "remote",
    transcription: current.engine === "parakeet" ? "local" : "cloud",
    result: failed ? "failed" : current.ending === "cancelled" || !current.heard ? "cancelled" : "succeeded",
    failure_code: !failed
      ? undefined
      : current.ending === "permission_denied"
        ? "permission_denied"
        : "operation_failed",
    audio_duration_seconds:
      current.listeningAt === null ? 0 : ((current.stoppingAt ?? now) - current.listeningAt) / 1_000,
    duration_ms: current.stoppingAt === null ? undefined : now - current.stoppingAt,
  });
}

/** The speech module has the microphone and the recognizer: an app binary from before them does not. */
export const modelCaptureAvailable = (): boolean =>
  typeof speechNative?.startCapture === "function" && speechRecognition !== null;

// The microphone of the speech module is one for the whole app, and every mounted chat receives its
// events. Only the composer that started the session reacts.
let owner: symbol | null = null;

/**
 * Dictation with Parakeet on the phone or ElevenLabs Scribe, which both find the spoken language
 * themselves, as on desktop. The speech module opens the microphone: Parakeet recognizes each
 * segment there, and ElevenLabs gets the audio through a socket. The draft and the phases work as
 * with the phone's recognizer, so the composer and the voice conversation use both the same way.
 */
export function useModelDictation({
  engine,
  enabled,
  onDraft,
  onSpeaking,
}: {
  /** Null while the phone's recognizer is in use. */
  engine: ModelRecognition | null;
  enabled: boolean;
  onDraft: (text: string) => void;
  onSpeaking?: () => void;
}): VoiceDictation {
  const [id] = useState(() => Symbol("model-dictation"));
  const available = engine !== null && modelCaptureAvailable();
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const phaseRef = useRef<DictationPhase>("idle");
  const level = useSharedValue(0);
  const session = useRef<CaptureSession | null>(null);
  const finished = useRef<(() => void)[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraftRef = useRef(onDraft);
  const onSpeakingRef = useRef(onSpeaking);
  useEffect(() => {
    onDraftRef.current = onDraft;
    onSpeakingRef.current = onSpeaking;
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

  /** Ends the session that failed while it listened. The draft keeps the text so far. */
  const fail = useCallback(
    (current: CaptureSession, notice: DictationNotice, error?: unknown) => {
      if (session.current !== current) return;
      current.ending = "operation_failed";
      speechNative?.cancelCapture?.();
      current.scribe?.cancel();
      settle();
      showNotice(notice, error);
    },
    [settle],
  );

  const showText = useCallback((current: CaptureSession, spoken: string) => {
    current.heard ||= spoken.length > 0;
    onDraftRef.current(dictationDraft(current.base, spoken));
  }, []);

  useEffect(() => {
    const module = speechNative;
    if (!module || typeof module.startCapture !== "function") return;
    const subscriptions = [
      module.addListener("onCaptureLevel", ({ level: value, speaking }) => {
        if (owner !== id || !session.current?.native) return;
        level.set(withTiming(Math.min(1, Math.max(0, value)), { duration: 100 }));
        if (speaking && phaseRef.current === "listening") onSpeakingRef.current?.();
      }),
      module.addListener("onCaptureAudio", ({ pcm }) => {
        if (owner === id && session.current?.native) session.current.scribe?.append(pcm);
      }),
      module.addListener("onCaptureText", ({ text, final }) => {
        const current = session.current;
        if (owner !== id || !current?.native || current.engine !== "parakeet") return;
        current.transcript = applyDictationResult(current.transcript, { isFinal: final, text });
        showText(current, spokenText(current.transcript));
      }),
      module.addListener("onCaptureEnd", ({ error }) => {
        const current = session.current;
        if (owner !== id || !current?.native) return;
        current.native = false;
        // A phone call or a new audio route ended it: the draft keeps the text so far, with no alert,
        // as with the phone's recognizer.
        if (error === "interrupted") {
          current.scribe?.cancel();
          settle();
          return;
        }
        if (error && phaseRef.current !== "stopping") {
          fail(current, error === "permission" ? microphoneOffNotice : dictationFailedNotice, {
            reference: referenceFrom("speech", error),
          });
          return;
        }
        // ElevenLabs has the last audio now: wait for its last segment.
        if (current.scribe) void current.scribe.finish().then(() => session.current === current && settle());
        else settle();
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [fail, id, level, settle, showText]);

  const start = useCallback(
    (base: string): boolean => {
      const module = speechNative;
      const recognizer = speechRecognition;
      if (!module?.startCapture || !recognizer || !engine || owner || phaseRef.current !== "idle") return false;
      owner = id;
      const current: CaptureSession = {
        engine,
        base,
        transcript: emptyDictationTranscript,
        scribe: null,
        abort: new AbortController(),
        native: false,
        heard: false,
        listeningAt: null,
        stoppingAt: null,
        ending: null,
      };
      session.current = current;
      update("starting");
      // A cancel, or a cancel and a new press, can happen during any wait. Only this session may continue.
      const stillCurrent = () => owner === id && session.current === current && phaseRef.current === "starting";
      void (async () => {
        try {
          const permission = await recognizer.requestMicrophonePermissionsAsync();
          if (!stillCurrent()) return;
          if (!permission.granted) {
            current.ending = "permission_denied";
            settle();
            showNotice(microphoneOffNotice);
            return;
          }
          if (engine === "parakeet") {
            const directory = parakeetModel.uri();
            try {
              if (!directory || !module.loadRecognizer) throw new Error("The model is not downloaded.");
              // The first start loads about 650 MB, which takes a few seconds.
              await module.loadRecognizer(directory, PARAKEET_THREADS);
            } catch (error) {
              if (!stillCurrent()) return;
              current.ending = "operation_failed";
              settle();
              showNotice(modelLoadNotice, error);
              return;
            }
          } else {
            const key = await readElevenLabsKey();
            if (!key) throw new ElevenLabsError("invalid-key");
            const token = await scribeToken(key, current.abort.signal);
            if (!stillCurrent()) return;
            current.scribe = new ScribeRealtimeSession({
              token,
              onText: (text) => {
                if (session.current === current) showText(current, text);
              },
              onFailure: (failure) =>
                fail(current, SCRIBE_NOTICES[failure], { reference: referenceFrom("speech", failure) }),
            });
          }
          if (!stillCurrent()) {
            current.scribe?.cancel();
            return;
          }
          current.native = true;
          await module.startCapture?.(engine === "parakeet" ? "transcribe" : "stream");
          if (!stillCurrent()) return;
          current.listeningAt = performance.now();
          update("listening");
          void haptics.impact("light");
        } catch (error) {
          if (session.current !== current) return;
          current.native = false;
          current.scribe?.cancel();
          current.ending = "operation_failed";
          settle();
          if (error instanceof ElevenLabsError)
            showNotice(SCRIBE_NOTICES[error.code], { reference: referenceFrom("speech", error.code) });
          else if (error instanceof CodedError && error.code === "ERR_CAPTURE_PERMISSION")
            showNotice(microphoneOffNotice);
          else showNotice(dictationFailedNotice, error);
        }
      })();
      return true;
    },
    [engine, fail, id, settle, showText, update],
  );

  const cancelNative = useCallback((current: CaptureSession) => {
    current.abort.abort();
    if (current.native) speechNative?.cancelCapture?.();
    current.native = false;
    current.scribe?.cancel();
  }, []);

  const finish = useCallback((): Promise<void> => {
    const current = session.current;
    if (owner !== id || !current) return Promise.resolve();
    if (phaseRef.current === "starting") {
      // No speech yet: the permission prompt, the model or the socket is still opening.
      cancelNative(current);
      settle();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      finished.current.push(resolve);
      if (phaseRef.current === "stopping") return;
      current.stoppingAt = performance.now();
      update("stopping");
      void haptics.selection();
      speechNative?.finishCapture?.();
      stopTimer.current = setTimeout(() => {
        if (owner !== id || session.current !== current) return;
        cancelNative(current);
        settle();
      }, STOP_TIMEOUT_MS[current.engine]);
    });
  }, [cancelNative, id, settle, update]);

  const cancel = useCallback(() => {
    const current = session.current;
    if (owner !== id || !current) return;
    current.ending = "cancelled";
    cancelNative(current);
    onDraftRef.current(current.base);
    void haptics.selection();
    settle();
  }, [cancelNative, id, settle]);

  const foreground = useAppForeground();
  useEffect(() => {
    if (owner !== id) return;
    // Android reports the app as in the background while its permission dialog is open, so the
    // first press must not stop itself there.
    if (!enabled || (!foreground && phaseRef.current !== "starting")) void finish();
  }, [enabled, foreground, finish, id]);

  useEffect(
    () => () => {
      if (owner !== id) return;
      // The draft already holds the last text, so leaving the chat keeps it.
      if (session.current) cancelNative(session.current);
      owner = null;
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [cancelNative, id],
  );

  return { available, phase, level, start, finish, cancel };
}
