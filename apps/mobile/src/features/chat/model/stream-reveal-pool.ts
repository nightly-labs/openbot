interface Reveal {
  start: (done: () => void) => void;
  skip: () => void;
}

/** Bounds native animated nodes; bursts catch up instead of delaying the answer. */
export function createStreamRevealPool(limit = 4) {
  const waiting = new Set<Reveal>();
  const active = new Set<Reveal>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer !== null || waiting.size === 0 || active.size >= limit) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = Math.max(2, Math.ceil(waiting.size / 5));
      for (const item of Array.from(waiting).slice(0, Math.min(batch, limit - active.size))) {
        waiting.delete(item);
        active.add(item);
        item.start(() => {
          active.delete(item);
          schedule();
        });
      }
      schedule();
    }, 32);
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
