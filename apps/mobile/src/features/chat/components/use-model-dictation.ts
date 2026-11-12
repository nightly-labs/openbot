import { sourceText } from "@openbot/i18n/source";
import { referenceFrom } from "@openbot/user-errors";
import { CodedError } from "expo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { ElevenLabsError, scribeToken } from "@/features/voice/model/elevenlabs";
import { type LocalRecognition, loadLocalRecognizer } from "@/features/voice/model/recognition-models";
import { type ScribeFailure, ScribeRealtimeSession } from "@/features/voice/model/scribe-realtime";
import { speechNative } from "@/features/voice/model/speech-native";
import { transcribeWithVoiceServer, useVoiceServer, VoiceServerError } from "@/features/voice/model/voice-server";
import { readElevenLabsKey, useVoiceSettings } from "@/features/voice/model/voice-settings";
import { haptics } from "@/shared/lib/haptics";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { base64Bytes } from "../model/base64-bytes";
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
export type ModelRecognition = LocalRecognition | "elevenlabs" | "voice-server";

/** A model on the phone decodes faster with more threads, and a phone has four or more cores. */
const LOCAL_MODEL_THREADS = 4;
/**
 * A finish that never reports its end must not hold the composer. Parakeet decodes the last segment
 * in about a second; Qwen3-ASR writes the words one at a time, so it takes longer; ElevenLabs can
 * take up to ten seconds for its last segment.
 */
const STOP_TIMEOUT_MS = {
  parakeet: 8_000,
  "parakeet-unified": 8_000,
  "qwen3-asr": 20_000,
  elevenlabs: 12_000,
  // The whole recording goes at the end, and a server without a GPU can take two minutes.
  "voice-server": 125_000,
} as const;

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
  /** The ElevenLabs session; null for a model on the phone. */
  scribe: ScribeRealtimeSession | null;
  /** The voice server: the audio so far, as Base64 PCM chunks. It goes to the server at the end. */
  recording: string[] | null;
  /** When the user last spoke, for the end of a turn after a pause. Null before the first word. */
  spokeAt: number | null;
  /** The token request, which a cancel stops. */
  abort: AbortController;
  /** The microphone is open for this session. Events before that belong to an earlier one. */
  native: boolean;
  heard: boolean;
  listeningAt: number | null;
  stoppingAt: number | null;
  ending: "cancelled" | "permission_denied" | "operation_failed" | null;
}

/** The sentence of a failed voice server request names the host and what to change. */
function showVoiceServerNotice(error: VoiceServerError): void {
  void haptics.notification("error");
  const text = currentText();
  showFailureAlert(
    error,
    "voice",
    text.t("mobile.chat.dictation.stopped"),
    text.errorMessage(error, text.t("mobile.chat.dictation.tryAgain")),
  );
}

/** The 16 kHz mono PCM of a recording, from the Base64 chunks of the speech module. */
function joinRecording(chunks: readonly string[]): Uint8Array {
  const parts = chunks.map(base64Bytes);
  const pcm = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.byteLength;
  }
  return pcm;
}

/** The language of the dictation for the server, or null to let the server find it. */
function voiceServerLanguage(): string | null {
  const chosen = useDictationLanguage.getState().value;
  return chosen === AUTOMATIC_DICTATION_LANGUAGE ? null : (chosen.split(/[-_]/)[0]?.toLowerCase() ?? null);
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
    transcription: current.engine === "elevenlabs" || current.engine === "voice-server" ? "cloud" : "local",
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
 * Dictation with Parakeet or Qwen3-ASR on the phone, or ElevenLabs Scribe, which all find the spoken
 * language themselves. The speech module opens the microphone: the model on the phone recognizes
 * each segment there, and ElevenLabs gets the audio through a socket. The draft and the phases work as
 * with the phone's recognizer, so the composer and the voice conversation use both the same way.
 */
export function useModelDictation({
  engine,
  enabled,
  onDraft,
  endsOnPause = false,
}: {
  /** Null while the phone's recognizer is in use. */
  engine: ModelRecognition | null;
  enabled: boolean;
  onDraft: (text: string) => void;
  /** The voice server ends the capture after the pause of a voice conversation. */
  endsOnPause?: boolean;
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
  const endsOnPauseRef = useRef(endsOnPause);
  const finishRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    onDraftRef.current = onDraft;
    endsOnPauseRef.current = endsOnPause;
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
        const current = session.current;
        if (owner !== id || !current?.native) return;
        level.set(withTiming(Math.min(1, Math.max(0, value)), { duration: 100 }));
        // The server sends no text before the end, so the pause after the words ends the turn here.
        if (!current.recording || !endsOnPauseRef.current || phaseRef.current !== "listening") return;
        const now = performance.now();
        if (speaking) current.spokeAt = now;
        else if (current.spokeAt !== null && now - current.spokeAt >= useVoiceSettings.getState().turnPauseMs)
          void finishRef.current();
      }),
      module.addListener("onCaptureAudio", ({ pcm }) => {
        if (owner !== id || !session.current?.native) return;
        session.current.scribe?.append(pcm);
        session.current.recording?.push(pcm);
      }),
      module.addListener("onCaptureText", ({ text, final }) => {
        const current = session.current;
        if (owner !== id || !current?.native || current.engine === "elevenlabs" || current.engine === "voice-server")
          return;
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
        else if (current.recording) {
          // The voice server gets the whole recording now. A cancel aborts the request.
          const pcm = joinRecording(current.recording);
          current.recording = [];
          if (pcm.byteLength === 0) {
            settle();
            return;
          }
          void transcribeWithVoiceServer(pcm, voiceServerLanguage(), current.abort.signal).then(
            (text) => {
              if (session.current !== current) return;
              showText(current, text);
              settle();
            },
            (failure: unknown) => {
              if (session.current !== current || current.abort.signal.aborted) return;
              current.ending = "operation_failed";
              settle();
              if (failure instanceof VoiceServerError) showVoiceServerNotice(failure);
              else showNotice(dictationFailedNotice, failure);
            },
          );
        } else settle();
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
        recording: engine === "voice-server" ? [] : null,
        spokeAt: null,
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
          if (engine === "voice-server") {
            if (!useVoiceServer.getState().server?.routes.dictation)
              throw new VoiceServerError("address", sourceText("error.voice.server.routeOff"));
          } else if (engine !== "elevenlabs") {
            try {
              // The first start loads about 650 MB, or 1 GB for Qwen3-ASR, which takes a few seconds.
              await loadLocalRecognizer(engine, LOCAL_MODEL_THREADS);
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
          await module.startCapture?.(engine === "elevenlabs" || engine === "voice-server" ? "stream" : "transcribe");
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
          else if (error instanceof VoiceServerError) showVoiceServerNotice(error);
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

  finishRef.current = finish;

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
