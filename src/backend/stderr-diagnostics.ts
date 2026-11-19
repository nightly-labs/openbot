const DEFAULT_LIMIT = 64 * 1024;

const ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(
  `${ESCAPE}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${ESCAPE}\\u0007]*(?:\\u0007|${ESCAPE}\\\\)|[@-Z\\\\-_])`,
  "gu",
);

const DIAGNOSTIC_TEXT_LIMIT = 2_000;

export function shortenDiagnostic(message: string): string {
  return message.slice(0, DIAGNOSTIC_TEXT_LIMIT);
}

export interface DiagnosticStream {
  push: (chunk: string) => void;
  flush: () => void;
}

export function createDiagnosticStream(options: {
  redact: (value: string) => string;
  emit: (message: string) => void;
  limit?: number | undefined;
}): DiagnosticStream {
  const limit = options.limit ?? DEFAULT_LIMIT;
  let pending = "";
  let cursor = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inspect = false;
  let quote = '"';
  let undecided: { open: number; at: number; newline: boolean; indented: boolean } | null = null;
  let dropping = false;

  function resetScan(): void {
    cursor = 0;
    depth = 0;
    inString = false;
    escaped = false;
    inspect = false;
    undecided = null;
  }

  function emitRecord(record: string): void {
    const message = options.redact(record.replace(ANSI_SEQUENCE, "").trim());
    if (message) options.emit(message);
  }

  function takeRecord(end: number): void {
    if (!dropping) emitRecord(pending.slice(0, end));
    dropping = false;
    pending = pending.slice(end + 1);
    resetScan();
  }

  function decideUndecided(held: NonNullable<typeof undecided>): boolean {
    for (; held.at < pending.length; held.at += 1) {
      const char = pending[held.at];
      if (char === "\n") {
        held.newline = true;
        held.indented = false;
        continue;
      }
      if (char === " " || char === "\t") {
        if (held.newline && pending[held.at - 1] === "\n") held.indented = true;
        continue;
      }
      if (char === "\r") continue;
      undecided = null;
      cursor = held.open + 1;
      if (char === '"' || char === "{" || char === "[") depth = 1;
      else if (held.indented && char !== "}" && char !== "]") {
        depth = 1;
        inspect = true;
      }
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
      if (depth > 0 && inspect && char === "\n") {
        const next = pending[cursor + 1];
        if (next === undefined) return;
        inString = false;
        escaped = false;
        if (next !== " " && next !== "\t" && next !== "}" && next !== "]") {
          takeRecord(cursor);
          continue;
        }
        cursor += 1;
        continue;
      }
      if (depth > 0) {
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) inString = false;
        } else if (char === '"' || (inspect && (char === "'" || char === "`"))) {
          inString = true;
          quote = char;
        } else if (char === "{" || char === "[") depth += 1;
        else if (char === "}" || char === "]") {
          depth -= 1;
          if (depth === 0) inspect = false;
        }
        cursor += 1;
        continue;
      }
      if (char === "\n") {
        takeRecord(cursor);
        continue;
      }
      if (char === "{" || char === "[") {
        undecided = { open: cursor, at: cursor + 1, newline: false, indented: false };
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
      pending = inspect && depth > 0 && pending.endsWith("\n") ? "\n" : "";
      cursor = 0;
      if (undecided) {
        undecided = null;
        depth = 1;
        inString = false;
        escaped = false;
        inspect = false;
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
