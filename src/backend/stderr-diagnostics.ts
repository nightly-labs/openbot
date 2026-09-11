// Reading a provider CLI's stderr as records, not as chunks.
//
// A `data` event carries whatever the pipe held, so it ends wherever the pipe filled up: often in the
// middle of a JSON record the CLI is writing. Redaction reads one string at a time and cannot know
// that a string is half of something, so a record split across two chunks used to pass its second
// half through untouched, credentials and all. Records are held here until they are whole, and only
// whole records are redacted. A record usually ends at the next newline, but a CLI may write one
// payload over several lines, and a line of such a payload read on its own loses the parent key that
// tells the redactor what it holds.

import { hasUnterminatedPayload } from "@openbot/logging";

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
      for (let from = 0; ; ) {
        const newline = pending.indexOf("\n", from);
        // What is left has no newline yet, so it is the start of the next record.
        if (newline < 0) break;
        const record = pending.slice(0, newline);
        if (hasUnterminatedPayload(record)) {
          // The payload this record began has not closed, so the rest of it is on the lines that
          // follow and the newline does not end anything. `{"headers":` read alone says nothing, and
          // the `{"X-Tenant":"…"}` under it would then be read without the name that redacts it.
          from = newline + 1;
          continue;
        }
        emitRecord(record);
        pending = pending.slice(newline + 1);
        from = 0;
      }
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
