// Reading a provider CLI's stderr as records, not as chunks.
//
// A `data` event carries whatever the pipe held, so it ends wherever the pipe filled up: often in the
// middle of a JSON record the CLI is writing. Redaction reads one string at a time and cannot know
// that a string is half of something, so a record split across two chunks used to pass its second
// half through untouched, credentials and all. Records are held here until they are whole, and only
// whole records are redacted. A record usually ends at the next newline, but a CLI may pretty-print
// one payload over several lines, and a line of such a payload read on its own loses the parent key
// that tells the redactor what it holds.
//
// The text is read once, left to right: every character is classified as it arrives, and the state
// of that scan (bracket depth, whether it is inside a string) is what survives between chunks. A
// scan that started again at each newline would walk the whole record every time, which a CLI could
// turn into seconds of blocked main process with one long payload.

/** What a record may grow to before it is read anyway. One line of provider stderr is far shorter. */
const DEFAULT_LIMIT = 64 * 1024;

export interface DiagnosticStream {
  /** Takes one stderr chunk and emits every record it completes. */
  push: (chunk: string) => void;
  /** Reads what is held, for a process that exits without a final newline. */
  flush: () => void;
}

/**
 * `redact` is given a whole record, and `emit` its redacted form; an empty result is not emitted.
 *
 * The held text is bounded: a CLI that writes megabytes without ending a record must not grow the
 * main process. What is over the bound is read as it stands, which is safe because the redactor
 * drops an unterminated payload rather than passing on what it could not parse, and the rest of that
 * record is then read and thrown away rather than emitted as a record of its own.
 */
export function createDiagnosticStream(options: {
  redact: (value: string) => string;
  emit: (message: string) => void;
  limit?: number;
}): DiagnosticStream {
  const limit = options.limit ?? DEFAULT_LIMIT;
  let pending = "";
  /** Where the scan stopped. Everything before it in `pending` is classified. */
  let cursor = 0;
  /** Bracket depth of the payload being read, and 0 while the scan is in plain text. */
  let depth = 0;
  let inString = false;
  let escaped = false;
  /**
   * An opening bracket whose kind is still undecided, with `at` the place the search for the first
   * character after it goes on. `{` at the end of a chunk may open a record or end a sentence, and
   * the text that decides it has not arrived yet.
   */
  let undecided: { open: number; at: number } | null = null;
  /** Set while the rest of a record that went over the bound is being read and thrown away. */
  let dropping = false;

  function resetScan(): void {
    cursor = 0;
    depth = 0;
    inString = false;
    escaped = false;
    undecided = null;
  }

  function emitRecord(record: string): void {
    const message = options.redact(record.trim());
    if (message) options.emit(message);
  }

  /** Ends the record that stops at `end`, and starts the scan again on what follows it. */
  function takeRecord(end: number): void {
    if (!dropping) emitRecord(pending.slice(0, end));
    dropping = false;
    pending = pending.slice(end + 1);
    resetScan();
  }

  /**
   * Decides whether the held bracket opens what a serializer wrote. `{"headers":` is a record;
   * `note {` is a sentence, and holding a sentence open would keep every line after it unread until
   * the bound. Answers `false` while only spaces follow the bracket, so the decision waits for text
   * rather than being guessed.
   */
  function decideUndecided(held: { open: number; at: number }): boolean {
    for (; held.at < pending.length; held.at += 1) {
      const char = pending[held.at];
      if (char === " " || char === "\t" || char === "\n" || char === "\r") continue;
      undecided = null;
      // Back to the bracket either way: as the first level of a payload, or as one more character of
      // the line it sits in.
      cursor = held.open + 1;
      if (char === '"' || char === "{" || char === "[") depth = 1;
      return true;
    }
    return false;
  }

  function scan(): void {
    while (true) {
      if (undecided) {
        if (!decideUndecided(undecided)) return;
        continue;
      }
      if (cursor >= pending.length) return;
      const char = pending[cursor];
      if (depth > 0) {
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === "{" || char === "[") depth += 1;
        else if (char === "}" || char === "]") depth -= 1;
        cursor += 1;
        continue;
      }
      if (char === "\n") {
        takeRecord(cursor);
        continue;
      }
      if (char === "{" || char === "[") {
        undecided = { open: cursor, at: cursor + 1 };
        continue;
      }
      cursor += 1;
    }
  }

  return {
    push(chunk) {
      pending += chunk;
      scan();
      if (pending.length <= limit) return;
      if (!dropping) emitRecord(pending);
      // The bound was passed inside a record. What was read is emitted, and the rest of that same
      // record is read on and dropped: shown as a record of its own it would be half a payload, and
      // half a payload is the half the redactor cannot name.
      pending = "";
      cursor = 0;
      // An undecided bracket loses its place with the text it pointed into. It counts as a payload,
      // which keeps the rest of the record held back rather than passed on.
      if (undecided) {
        undecided = null;
        depth = 1;
        inString = false;
        escaped = false;
      }
      dropping = true;
    },
    flush() {
      const record = dropping ? "" : pending;
      pending = "";
      dropping = false;
      resetScan();
      if (record) emitRecord(record);
    },
  };
}
