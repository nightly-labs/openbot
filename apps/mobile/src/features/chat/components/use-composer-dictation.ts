import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { Easing, ReduceMotion, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import type { DictationPhase } from "../model/voice-dictation";
import { useVoiceDictation } from "./use-voice-dictation";

export interface ComposerDictation {
  available: boolean;
  /** Dictation listens hands-free, from the press on the mic until Stop. */
  active: boolean;
  /** True from the start until the last words are in the draft. Send waits, and a key stops it. */
  busy: boolean;
  phase: DictationPhase;
  /** Input level from 0 to 1. */
  level: SharedValue<number>;
  /** 0 with the composer at rest, 1 while dictation listens. Drives the composer on the UI thread. */
  presence: SharedValue<number>;
  /** Listens and writes the speech after the draft. False when the recognizer cannot start. */
  start: () => boolean;
  /** Stop, and keep the text. */
  finish: () => void;
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
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const presence = useSharedValue(0);
  const dictation = useVoiceDictation({ enabled, onDraft });
  const { start: listen, finish: stop, phase } = dictation;

  const moveTo = useCallback(
    (next: boolean) => {
      activeRef.current = next;
      setActive(next);
      presence.set(
        withTiming(next ? 1 : 0, { duration: PRESENCE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }),
      );
    },
    [presence],
  );

  const start = useCallback(() => {
    if (activeRef.current || !listen(draftRef.current)) return false;
    moveTo(true);
    return true;
  }, [listen, moveTo]);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    moveTo(false);
    void stop();
  }, [moveTo, stop]);

  // The session can end without the user: an error, a denied permission, the app in the background or
  // a lost server. The draft already has what was said.
  const previousPhase = useRef(phase);
  useEffect(() => {
    const ended = previousPhase.current !== "idle" && phase === "idle";
    previousPhase.current = phase;
    if (ended && activeRef.current) moveTo(false);
  }, [phase, moveTo]);

  // A screen lock ends the session, so the screen stays on while the user speaks hands-free.
  const keepAwakeTag = useId();
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [active, keepAwakeTag]);

  // Android back stops dictation and keeps the text before it leaves the chat.
  useEffect(() => {
    if (!active || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      finish();
      return true;
    });
    return () => subscription.remove();
  }, [active, focused, finish]);

  return {
    available: dictation.available,
    active,
    busy: active || phase === "stopping",
    phase,
    level: dictation.level,
    presence,
    start,
    finish,
  };
}
