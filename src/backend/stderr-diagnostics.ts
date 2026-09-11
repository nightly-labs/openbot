// Reading a provider CLI's stderr as records, not as chunks.
//
// A `data` event carries whatever the pipe held, so it ends wherever the pipe filled up: often in the
// middle of a JSON record the CLI is writing. Redaction reads one string at a time and cannot know
// that a string is half of something, so a record split across two chunks used to pass its second
// half through untouched, credentials and all. Lines are held here until the newline that ends them
// arrives, and only whole lines are redacted.

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
 * The held text is bounded: a CLI that writes megabytes without a newline must not grow the main
 * process. What is over the bound is read as it stands, which is safe because the redactor drops an
 * unterminated payload rather than passing on what it could not parse.
 */
export function createDiagnosticStream(options: {
  redact: (value: string) => string;
  emit: (message: string) => void;
  limit?: number;
}): DiagnosticStream {
  const limit = options.limit ?? DEFAULT_LIMIT;
  let pending = "";
  /** Set while the rest of a record that went over the bound is being thrown away. */
  let dropping = false;

  function emitRecord(record: string): void {
    const message = options.redact(record.trim());
    if (message) options.emit(message);
  }

  return {
    push(chunk) {
      let text = chunk;
      if (dropping) {
        // The rest of an over-long record is thrown away, not read: its first bytes were already
        // emitted, and reading its tail as a record of its own is what would hand on the half of a
        // payload that carries the credential.
        const newline = text.indexOf("\n");
        if (newline < 0) return;
        text = text.slice(newline + 1);
        dropping = false;
      }
      pending += text;
      const records = pending.split("\n");
      // The last piece has no newline yet, so it is the start of the next record.
      pending = records.pop() ?? "";
      for (const record of records) emitRecord(record);
      if (pending.length > limit) {
        emitRecord(pending);
        pending = "";
        dropping = true;
      }
    },
    flush() {
      const record = dropping ? "" : pending;
      pending = "";
      dropping = false;
      if (record) emitRecord(record);
    },
  };
}
