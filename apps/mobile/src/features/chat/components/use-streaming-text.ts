import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

const WORD_GAP_MS = 60;
// Every reveal reparses Markdown. Bound that extra work for long responses.
const MAX_SMOOTHED_CHARACTERS = 2_000;
const WORD_WITH_SEPARATOR = /^(?:\s*(?:(?:#{1,6}|[-+*>]|\d+[.)])\s+)?\S+\s+)/u;

export function useStreamingText(body: string, streaming: boolean, enabled: boolean) {
  const reducedMotion = useReducedMotion();
  const smooth = streaming && enabled && !reducedMotion && body.length <= MAX_SMOOTHED_CHARACTERS;
  const [display, setDisplay] = useState(() => ({
    body: smooth ? "" : body,
    animateTail: false,
  }));
  const visible = useRef(display.body);
  const target = useRef({ body, streaming });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    target.current = { body, streaming };
    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    if (!smooth || !body.startsWith(visible.current)) {
      cancel();
      visible.current = body;
      setDisplay((current) => (current.body === body && !current.animateTail ? current : { body, animateTail: false }));
      return;
    }
    const reveal = () => {
      timer.current = null;
      const remaining = target.current.body.slice(visible.current.length);
      if (!remaining) {
        return;
      }
      const word = remaining.match(WORD_WITH_SEPARATOR)?.[0];
      if (!word && target.current.streaming) return;
      visible.current += word ?? remaining;
      setDisplay({ body: visible.current, animateTail: true });
      if (visible.current !== target.current.body) timer.current = setTimeout(reveal, WORD_GAP_MS);
    };
    if (body !== visible.current && timer.current === null) timer.current = setTimeout(reveal, WORD_GAP_MS);
  }, [body, smooth, streaming]);

  // Completed responses must be available in this render, before effect cleanup runs.
  return !smooth ? { body, animateTail: false } : display;
}
