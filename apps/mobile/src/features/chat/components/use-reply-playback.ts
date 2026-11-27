import { useEffect, useRef, useState } from "react";
import { REPLY_CATCH_UP_STEP_MS, replyCatchUpStep } from "../model/reply-catch-up";
import type { createReplyReveal } from "../model/reply-reveal";
import { REPLY_FLUSH_AFTER_MS, replyFlushes, replyWordDelay } from "../model/reply-reveal";

export interface ReplyPlayback {
  progress: Map<string, number>;
  id: string;
  enabled: boolean;
  active: boolean;
  paused: boolean;
  complete: boolean;
  onWord: (word: string, index: number) => void;
  onFlush: () => void;
  onComplete: () => void;
}

function resumable(playback: ReplyPlayback | undefined, total: number) {
  const position = playback?.progress.get(playback.id) ?? 0;
  return position > 0 && position < total;
}

export function useReplyPlayback(plan: ReturnType<typeof createReplyReveal>, playback?: ReplyPlayback) {
  const unfinished = resumable(playback, plan.words.length);
  const enabled = Boolean(playback?.enabled || (playback?.active && unfinished));
  const held = !enabled && Boolean(playback?.paused) && unfinished;
  const [visible, setVisible] = useState(() =>
    playback && (enabled || held) ? (playback.progress.get(playback.id) ?? 0) : plan.words.length,
  );
  const callbacks = useRef(playback);
  const currentPlan = useRef(plan);
  useEffect(() => {
    callbacks.current = playback;
    currentPlan.current = plan;
  }, [playback, plan]);
  const id = playback?.id;
  const progress = playback?.progress;
  useEffect(() => {
    if (enabled || held) return;
    setVisible(plan.words.length);
    if (id && progress) progress.set(id, plan.words.length);
  }, [enabled, held, id, progress, plan.words.length]);
  useEffect(() => {
    if (!enabled || !id || !progress) {
      return;
    }
    let position = progress.get(id) ?? 0;
    let played = false;
    let catchUp = 0;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const show = (next: number) => {
      position = next;
      progress.set(id, position);
      setVisible(position);
    };
    const tick = () => {
      const words = currentPlan.current.words;
      if (
        !catchUp &&
        callbacks.current?.complete &&
        Date.now() - started >= REPLY_FLUSH_AFTER_MS &&
        replyFlushes(words, position)
      ) {
        catchUp = replyCatchUpStep(words.length - position);
        callbacks.current.onFlush();
      }
      if (catchUp) {
        show(Math.min(words.length, position + catchUp));
        if (position < words.length) timer = setTimeout(tick, REPLY_CATCH_UP_STEP_MS);
        return;
      }
      const word = words[position];
      if (word === undefined) {
        if (callbacks.current?.complete) {
          if (played) callbacks.current.onComplete();
          return;
        }
        timer = setTimeout(tick, 32);
        return;
      }
      played = true;
      show(position + 1);
      callbacks.current?.onWord(word, position - 1);
      timer = setTimeout(tick, position < words.length ? replyWordDelay(word) : 180);
    };
    timer = setTimeout(tick, 32);
    return () => clearTimeout(timer);
  }, [enabled, id, progress]);
  return { tokens: enabled || held ? plan.at(visible) : plan.at(plan.words.length), playing: enabled };
}
