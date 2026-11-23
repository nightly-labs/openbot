const MAX_KEPT_TIMES = 4000;

interface KeptTime {
  at: number;
  day: number | undefined;
}

const keptTimes = new Map<string, KeptTime>();
let keptTimeZoneOffset: number | null = null;

function keptTime(createdAt: string): KeptTime {
  let kept = keptTimes.get(createdAt);
  if (!kept) {
    if (keptTimes.size >= MAX_KEPT_TIMES) keptTimes.clear();
    kept = { at: Date.parse(createdAt), day: undefined };
    keptTimes.set(createdAt, kept);
  }
  return kept;
}

export function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function messageTime(createdAt: string): number {
  return keptTime(createdAt).at;
}

export function messageDay(createdAt: string, timeZoneOffset: number): number {
  if (keptTimeZoneOffset !== timeZoneOffset) {
    for (const kept of keptTimes.values()) kept.day = undefined;
    keptTimeZoneOffset = timeZoneOffset;
  }
  const kept = keptTime(createdAt);
  if (kept.day === undefined) kept.day = Number.isNaN(kept.at) ? Number.NaN : startOfDay(new Date(kept.at));
  return kept.day;
}
