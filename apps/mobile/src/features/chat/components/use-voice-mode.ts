import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { Easing, ReduceMotion, type SharedValue, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import type { DictationPhase } from "../model/voice-dictation";
import { useVoiceDictation } from "./use-voice-dictation";

/** `review` shows Cancel, Continue and Send after the user stops speaking. */
type VoiceStage = "closed" | "listening" | "review";
type VoiceExit = "send" | "cancel";

export interface VoiceMode {
  available: boolean;
  stage: VoiceStage;
  /** Set while the voice mode animates out, until the stage is closed. */
  exit: VoiceExit | null;
  phase: DictationPhase;
  transcript: string;
  /** Input level from 0 to 1. */
  level: SharedValue<number>;
  /** 0 with the composer, 1 with the voice mode: the morph, the dim and the glow. */
  presence: SharedValue<number>;
  /** 0 with one voice button, 1 with Cancel, Continue and Send. */
  split: SharedValue<number>;
  /** Send can take the transcript now. */
  canSend: boolean;
  /** Continue can listen again: the chat is in front and online. */
  canResume: boolean;
  open: () => void;
  /** Stops listening and keeps the text for review. */
  stop: () => void;
  /** Listens again and adds the speech after the text. */
  resume: () => void;
  send: () => void;
  cancel: () => void;
  /** Android back, from the button or the edge swipe: stops listening, then cancels. */
  back: () => void;
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 460;
const SPLIT_MS = 320;
const MERGE_MS = 180;
const CLOSE_MS = 400;

function timing(value: number, duration: number) {
  return withTiming(value, { duration, easing: EASE_OUT, reduceMotion: ReduceMotion.System });
}

/**
 * Voice input as its own mode. The speech goes to a transcript, not to the
 * composer draft, and nothing is sent until the user presses Send. The
 * recognizer session and its errors stay in `useVoiceDictation`.
 */
export function useVoiceMode({
  enabled,
  focused,
  sendable,
  onSend,
}: {
  /** False stops listening and keeps the text, for example when the chat goes offline. */
  enabled: boolean;
  /** The chat is the screen in front. Only then does Android back belong to the voice mode. */
  focused: boolean;
  /** The composer could send now: online, and no other send in progress. */
  sendable: boolean;
  onSend: (text: string) => void;
}): VoiceMode {
  const [stage, setStage] = useState<VoiceStage>("closed");
  const [exit, setExit] = useState<VoiceExit | null>(null);
  const [transcript, setTranscript] = useState("");
  // Read by the async steps below, which must see the newest values.
  const stageRef = useRef<VoiceStage>("closed");
  const exitRef = useRef<VoiceExit | null>(null);
  const transcriptRef = useRef("");
  const finishing = useRef<Promise<void>>(Promise.resolve());
  const sendRef = useRef({ enabled, sendable, onSend });
  useEffect(() => {
    sendRef.current = { enabled, sendable, onSend };
  });
  const presence = useSharedValue(0);
  const split = useSharedValue(0);

  const dictation = useVoiceDictation({
    enabled,
    onDraft: (text) => {
      // A cancel puts back the text from before the session. The words must
      // stay for their exit animation, and nothing after a send may change them.
      if (exitRef.current) return;
      transcriptRef.current = text;
      setTranscript(text);
    },
  });
  const { start, finish, cancel: abort, phase } = dictation;

  const moveTo = useCallback((next: VoiceStage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const closed = useCallback(() => {
    exitRef.current = null;
    transcriptRef.current = "";
    setExit(null);
    setTranscript("");
    moveTo("closed");
  }, [moveTo]);

  const leave = useCallback(
    (outcome: VoiceExit) => {
      if (stageRef.current === "closed" || exitRef.current) return;
      exitRef.current = outcome;
      setExit(outcome);
      // The side buttons go back into the circle first, then the circle opens into the composer.
      split.set(timing(0, MERGE_MS));
      presence.set(
        withDelay(
          MERGE_MS / 2,
          withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (finished) => {
            if (finished) scheduleOnRN(closed);
          }),
          ReduceMotion.System,
        ),
      );
    },
    [closed, presence, split],
  );

  const showReview = useCallback(() => split.set(timing(1, SPLIT_MS)), [split]);

  const open = useCallback(() => {
    if (stageRef.current !== "closed" || !start("")) return;
    transcriptRef.current = "";
    setTranscript("");
    moveTo("listening");
    split.set(0);
    presence.set(timing(1, OPEN_MS));
  }, [moveTo, presence, split, start]);

  // The session can end without the stop button: an error, a denied
  // permission, the app in the background or a lost server. Keep what was
  // said for review, and leave when nothing was.
  useEffect(() => {
    if (stage !== "listening" || phase !== "idle" || exitRef.current) return;
    if (transcriptRef.current.trim()) {
      moveTo("review");
      showReview();
    } else leave("cancel");
  }, [stage, phase, leave, moveTo, showReview]);

  const stop = useCallback(() => {
    if (stageRef.current !== "listening" || exitRef.current) return;
    moveTo("review");
    // With no text yet, wait for the final result: a stop with nothing said
    // closes the voice mode, and the three buttons must not flash first.
    if (transcriptRef.current.trim()) showReview();
    const done = finish();
    finishing.current = done;
    void done.then(() => {
      if (stageRef.current !== "review" || exitRef.current) return;
      if (transcriptRef.current.trim()) showReview();
      else leave("cancel");
    });
  }, [finish, leave, moveTo, showReview]);

  const resume = useCallback(() => {
    // The dictation stops a session only when `enabled` changes, so a session
    // started while it is false would keep running.
    if (stageRef.current !== "review" || exitRef.current || !sendRef.current.enabled) return;
    void finishing.current.then(() => {
      if (stageRef.current !== "review" || exitRef.current || !sendRef.current.enabled) return;
      if (!start(transcriptRef.current)) return;
      moveTo("listening");
      split.set(timing(0, MERGE_MS));
    });
  }, [moveTo, split, start]);

  const send = useCallback(() => {
    if (stageRef.current !== "review" || exitRef.current) return;
    // A press during the stop waits for the final result, so no words are lost.
    void finishing.current.then(() => {
      const text = transcriptRef.current.trim();
      if (stageRef.current !== "review" || exitRef.current || !text || !sendRef.current.sendable) return;
      leave("send");
      sendRef.current.onSend(text);
    });
  }, [leave]);

  const cancel = useCallback(() => {
    if (stageRef.current === "closed" || exitRef.current) return;
    // The dictation plays its own feedback when it still has a session to abort.
    if (phase === "idle") void haptics.selection();
    // Leave first: the abort reports the old text at once, and the exit ignores it.
    leave("cancel");
    abort();
  }, [abort, leave, phase]);

  // Android back leaves the voice mode before it leaves the chat: the first
  // press stops listening, the next one cancels.
  const back = useCallback(() => {
    if (stageRef.current === "listening") stop();
    else cancel();
  }, [stop, cancel]);
  // Only while the chat is in front: a screen opened above it, such as the
  // queue, must go back normally and leave the transcript for review.
  useEffect(() => {
    if (stage === "closed" || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [stage, focused, back]);

  return {
    available: dictation.available,
    stage,
    exit,
    phase,
    transcript,
    level: dictation.level,
    presence,
    split,
    canSend: sendable && Boolean(transcript.trim()) && exit === null,
    canResume: enabled && exit === null,
    open,
    stop,
    resume,
    send,
    cancel,
    back,
  };
}
