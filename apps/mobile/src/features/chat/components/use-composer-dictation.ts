import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard } from "react-native";
import { Easing, ReduceMotion, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { speechNative } from "@/features/voice/model/speech-native";
import type { DictationPhase } from "../model/voice-dictation";
import { useVoiceDictation } from "./use-voice-dictation";

export interface ComposerDictation {
  available: boolean;
  active: boolean;
  busy: boolean;
  phase: DictationPhase;
  level: SharedValue<number>;
  presence: SharedValue<number>;
  start: () => boolean;
  finish: () => void;
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PRESENCE_MS = 220;

export function useComposerDictation({
  enabled,
  focused,
  draft,
  onDraft,
}: {
  enabled: boolean;
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

  const previousPhase = useRef(phase);
  useEffect(() => {
    const ended = previousPhase.current !== "idle" && phase === "idle";
    previousPhase.current = phase;
    if (ended && activeRef.current) moveTo(false);
  }, [phase, moveTo]);

  const keepAwakeTag = useId();
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [active, keepAwakeTag]);

  useEffect(() => {
    if (!active || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      finish();
      return true;
    });
    return () => subscription.remove();
  }, [active, focused, finish]);

  const { available, level } = dictation;
  return useMemo(
    () => ({ available, active, busy: active || phase === "stopping", phase, level, presence, start, finish }),
    [available, active, phase, level, presence, start, finish],
  );
}

export function useComposerDictationWithSettings(dictation: ComposerDictation): ComposerDictation {
  return useMemo(
    () =>
      !speechNative && !dictation.available
        ? {
            ...dictation,
            available: true,
            start: () => {
              Keyboard.dismiss();
              router.push("/settings/voice");
              return false;
            },
          }
        : dictation,
    [dictation],
  );
}
