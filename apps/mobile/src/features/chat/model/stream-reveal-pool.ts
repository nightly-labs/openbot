interface Reveal {
  start: (done: () => void) => void;
  skip: () => void;
}

const STREAM_WORD_INTERVAL_MS = 32;
const CATCH_UP_SHARE = 4;
const FADE_OVERLAP = 5;
const MOST_ACTIVE = 24;
const STREAM_REVEAL_WINDOW = 48;

function streamRevealStep(waiting: number, limit: number) {
  const count = Math.min(MOST_ACTIVE, Math.ceil(waiting / CATCH_UP_SHARE));
  return { count, room: count > 1 ? Math.min(MOST_ACTIVE, Math.max(limit, count * FADE_OVERLAP)) : limit };
}

export function createStreamRevealPool(limit = 4) {
  const waiting = new Set<Reveal>();
  const active = new Set<Reveal>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer !== null || waiting.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      const { count, room } = streamRevealStep(waiting.size, limit);
      for (const oldest of Array.from(active).slice(0, Math.max(0, active.size + count - room))) {
        active.delete(oldest);
        oldest.skip();
      }
      for (const item of Array.from(waiting).slice(0, count)) {
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

export function streamRevealWindow(body: string, baseline: string, enabled: boolean, limit = STREAM_REVEAL_WINDOW) {
  if (!enabled || !body.startsWith(baseline)) return { prefix: body, words: [] };
  const words = Array.from(body.slice(baseline.length).matchAll(/\s*\S+\s*|\s+/gu), (match) => ({
    start: baseline.length + match.index,
    end: baseline.length + match.index + match[0].length,
    text: match[0],
  })).slice(-limit);
  return { prefix: body.slice(0, words[0]?.start ?? body.length), words };
}
