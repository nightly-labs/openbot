import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { Easing, ReduceMotion, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import type { DictationPhase } from "../model/voice-dictation";
import { useVoiceDictation } from "./use-voice-dictation";

/**
 * `holding` listens while a finger holds the mic, `locked` listens hands-free until Done or Cancel.
 */
export type ComposerDictationStage = "idle" | "holding" | "locked";

export interface ComposerDictation {
  available: boolean;
  stage: ComposerDictationStage;
  /** The mic that started the session: the one of an empty composer, or the one next to Send. */
  origin: "empty" | "draft";
  /** True from the start until the last words are in the draft. Send waits, and a key stops it. */
  busy: boolean;
  phase: DictationPhase;
  /** Input level from 0 to 1. */
  level: SharedValue<number>;
  /** 0 with the composer at rest, 1 while dictation listens. Drives the composer on the UI thread. */
  presence: SharedValue<number>;
  /** Listens and writes the speech after the draft. False when the recognizer cannot start. */
  start: (mode: "hold" | "locked", origin: "empty" | "draft") => boolean;
  /** The finger left the mic: stop, and keep the text. */
  release: () => void;
  /** The finger slid to the lock: listen on without it. */
  lock: () => void;
  /** Stop, and keep the text. */
  finish: () => void;
  /** Stop, and put back the draft from before. */
  cancel: () => void;
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PRESENCE_MS = 220;

/**
 * Dictation into the composer draft. The words go into the field while the user speaks, and nothing
 * is sent: the user reads the text, edits it and presses Send. The recognizer is the one of
 * Settings > Voice; its session and its errors stay in `useVoiceDictation`.
 */
export function useComposerDictation({
  enabled,
  focused,
  draft,
  onDraft,
}: {
  /** False stops listening and keeps the text, for example when the chat goes offline. */
  enabled: boolean;
  /** The chat is the screen in front. Only then does Android back belong to dictation. */
  focused: boolean;
  draft: string;
  onDraft: (text: string) => void;
}): ComposerDictation {
  const [stage, setStage] = useState<ComposerDictationStage>("idle");
  const [origin, setOrigin] = useState<"empty" | "draft">("empty");
  const stageRef = useRef<ComposerDictationStage>("idle");
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const presence = useSharedValue(0);
  const dictation = useVoiceDictation({ enabled, onDraft });
  const { start: listen, finish: stop, cancel: abort, phase } = dictation;

  const moveTo = useCallback(
    (next: ComposerDictationStage) => {
      stageRef.current = next;
      setStage(next);
      presence.set(
        withTiming(next === "idle" ? 0 : 1, {
          duration: PRESENCE_MS,
          easing: EASE_OUT,
          reduceMotion: ReduceMotion.System,
        }),
      );
    },
    [presence],
  );

  const start = useCallback(
    (mode: "hold" | "locked", from: "empty" | "draft") => {
      if (stageRef.current !== "idle" || !listen(draftRef.current)) return false;
      setOrigin(from);
      moveTo(mode === "hold" ? "holding" : "locked");
      return true;
    },
    [listen, moveTo],
  );

  const finish = useCallback(() => {
    if (stageRef.current === "idle") return;
    moveTo("idle");
    void stop();
  }, [moveTo, stop]);

  const release = useCallback(() => {
    if (stageRef.current === "holding") finish();
  }, [finish]);

  const lock = useCallback(() => {
    if (stageRef.current === "holding") moveTo("locked");
  }, [moveTo]);

  const cancel = useCallback(() => {
    if (stageRef.current === "idle") return;
    moveTo("idle");
    abort();
  }, [abort, moveTo]);

  // The session can end without the user: an error, a denied permission, the app in the background or
  // a lost server. The draft already has what was said.
  const previousPhase = useRef(phase);
  useEffect(() => {
    const ended = previousPhase.current !== "idle" && phase === "idle";
    previousPhase.current = phase;
    if (ended && stageRef.current !== "idle") moveTo("idle");
  }, [phase, moveTo]);

  // A screen lock ends the session, so the screen stays on while the user speaks hands-free.
  const keepAwakeTag = useId();
  const listening = stage !== "idle";
  useEffect(() => {
    if (!listening) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [listening, keepAwakeTag]);

  // Android back stops dictation and keeps the text before it leaves the chat.
  useEffect(() => {
    if (!listening || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      finish();
      return true;
    });
    return () => subscription.remove();
  }, [listening, focused, finish]);

  return {
    available: dictation.available,
    stage,
    origin,
    busy: stage !== "idle" || phase === "stopping",
    phase,
    level: dictation.level,
    presence,
    start,
    release,
    lock,
    finish,
    cancel,
  };
}
