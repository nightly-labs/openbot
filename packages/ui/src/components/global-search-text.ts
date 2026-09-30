export interface MatchPart {
  text: string;
  match: boolean;
}

export function normalizedSearchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

// Offsets from the lowered text are only valid while lowering keeps each character's length.
function loweredForMatching(text: string): string | undefined {
  const lowered = text.toLocaleLowerCase();
  return lowered.length === text.length ? lowered : undefined;
}

/** Splits `text` into runs that do and do not contain the normalized `query`, for highlighting. */
export function matchParts(text: string, query: string): MatchPart[] {
  const needle = normalizedSearchText(query);
  const lowered = loweredForMatching(text);
  if (!needle || lowered === undefined) return [{ text, match: false }];
  const parts: MatchPart[] = [];
  let cursor = 0;
  let index = lowered.indexOf(needle);
  while (index >= 0) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lowered.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

/** Starts a long one-line preview shortly before the first match, so the match stays visible. */
export function snippetAround(text: string, query: string, lead = 32): string {
  const needle = normalizedSearchText(query);
  const index = needle ? (loweredForMatching(text)?.indexOf(needle) ?? -1) : -1;
  if (index <= lead) return text;
  const start = index - lead;
  const wordStart = text.indexOf(" ", start);
  const from = wordStart >= 0 && wordStart < index ? wordStart + 1 : start;
  return `…${text.slice(from)}`;
}
