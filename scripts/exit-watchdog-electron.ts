// Electron side of `scripts/exit-watchdog-e2e.ts`. It takes the single-instance lock and starts the
// main log and the exit watchdog as `src/main/index.ts` does, then writes `--ready-file`. A "stall"
// line on stdin opens a FIFO that has no writer on every libuv thread: the opens never finish, as an
// open that waits for a macOS privacy approval. "quit", "exit" and "process-exit" end the process
// with `app.quit`, `app.exit` and `process.exit`.
import { open, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { stopStuckExitAfterLimit } from "../src/main/exit-watchdog";
import { startMainLog } from "../src/main/provider-log";

// The default size of the libuv thread pool.
const LIBUV_THREADS = 4;

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
const userDataPath = argument("user-data");
app.setPath("userData", userDataPath);
const hasLock = app.requestSingleInstanceLock();
const logs = join(userDataPath, "logs");
if (hasLock) {
  startMainLog(logs);
  stopStuckExitAfterLimit(logs);
}

// No top-level await: Electron does not get ready until an ESM main module has run to its end.
void app.whenReady().then(() => {
  writeFileSync(argument("ready-file"), JSON.stringify({ pid: process.pid, hasLock }));
  if (!hasLock) {
    app.quit();
    return;
  }
  // `readline` keeps a line that a pipe splits between two chunks.
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line === "stall") {
      for (let thread = 0; thread < LIBUV_THREADS; thread++) open(argument("fifo"), "r", () => undefined);
    }
    if (line === "quit") app.quit();
    if (line === "exit") app.exit(0);
    if (line === "process-exit") process.exit(0);
  });
});
