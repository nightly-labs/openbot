interface Reveal {
  start: (done: () => void) => void;
  skip: () => void;
}

const STREAM_WORD_INTERVAL_MS = 32;

/** Bounds native animated nodes; bursts catch up instead of delaying the answer. */
export function createStreamRevealPool(limit = 4) {
  const waiting = new Set<Reveal>();
  const active = new Set<Reveal>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer !== null || waiting.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      // Never wait for an animation callback to admit the next word. A busy RN
      // runtime can deliver that callback late even though its UI fade has finished.
      if (active.size >= limit) {
        const oldest = active.values().next().value;
        if (oldest) {
          active.delete(oldest);
          oldest.skip();
        }
      }
      for (const item of Array.from(waiting).slice(0, 1)) {
        waiting.delete(item);
        active.add(item);
        item.start(() => {
          active.delete(item);
          schedule();
        });
      }
      schedule();
    }, STREAM_WORD_INTERVAL_MS);
  }
  return {
    add(item: Reveal) {
      waiting.add(item);
      if (waiting.size > 10) {
        for (const older of Array.from(waiting).slice(0, waiting.size - 10)) {
          waiting.delete(older);
          older.skip();
        }
      }
      schedule();
      return () => {
        waiting.delete(item);
        active.delete(item);
        schedule();
      };
    },
    clear() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const item of [...waiting, ...active]) item.skip();
      waiting.clear();
      active.clear();
    },
  };
}

/** Completed text is a single prefix; only a bounded suffix needs React reveal nodes. */
export function streamRevealWindow(body: string, baseline: string, enabled: boolean, limit = 14) {
  if (!enabled || !body.startsWith(baseline)) return { prefix: body, words: [] };
  const words = Array.from(body.slice(baseline.length).matchAll(/\s*\S+\s*|\s+/gu), (match) => ({
    start: baseline.length + match.index,
    end: baseline.length + match.index + match[0].length,
    text: match[0],
  })).slice(-limit);
  return { prefix: body.slice(0, words[0]?.start ?? body.length), words };
}
