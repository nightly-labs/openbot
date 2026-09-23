import { useEffect, useRef, useState } from "react";
import type { createReplyReveal } from "../model/reply-reveal";
import { replyWordDelay } from "../model/reply-reveal";

export interface ReplyPlayback {
  progress: Map<string, number>;
  id: string;
  enabled: boolean;
  complete: boolean;
  onWord: (word: string, index: number) => void;
  onComplete: () => void;
}

export function useReplyPlayback(plan: ReturnType<typeof createReplyReveal>, playback?: ReplyPlayback) {
  const [visible, setVisible] = useState(() =>
    playback?.enabled ? (playback.progress.get(playback.id) ?? 0) : plan.words.length,
  );
  const callbacks = useRef(playback);
  const currentPlan = useRef(plan);
  useEffect(() => {
    callbacks.current = playback;
    currentPlan.current = plan;
  }, [playback, plan]);
  const enabled = playback?.enabled ?? false;
  const id = playback?.id;
  const progress = playback?.progress;
  useEffect(() => {
    if (enabled) return;
    setVisible(plan.words.length);
    if (id && progress) progress.set(id, plan.words.length);
  }, [enabled, id, progress, plan.words.length]);
  useEffect(() => {
    if (!enabled || !id || !progress) {
      return;
    }
    let position = progress.get(id) ?? 0;
    let played = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const words = currentPlan.current.words;
      if (position >= words.length) {
        if (callbacks.current?.complete) {
          if (played) callbacks.current.onComplete();
          return;
        }
        // Keep one clock while the provider streams. Incoming chunks must not
        // reset the next reveal and starve playback during rapid updates.
        timer = setTimeout(tick, 32);
        return;
      }
      const word = words[position];
      position += 1;
      played = true;
      progress.set(id, position);
      setVisible(position);
      callbacks.current?.onWord(word, position - 1);
      timer = setTimeout(tick, position < words.length ? replyWordDelay(word) : 180);
    };
    timer = setTimeout(tick, 32);
    return () => clearTimeout(timer);
  }, [enabled, id, progress]);
  return enabled ? plan.at(visible) : plan.at(plan.words.length);
}
