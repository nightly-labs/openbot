// Node ends the process only after every libuv request has finished. A file request that the kernel
// never answers holds every exit path in `node::FreeEnvironment` for ever, `app.exit` of the shutdown
// deadline included: an `open` that waits for a macOS privacy approval that nobody answers is one.
// No JavaScript timer runs there, and Node stops worker threads before it waits. The process then
// keeps the single-instance lock, so every later launch exits without opening anything.
import { spawn } from "node:child_process";
import { join } from "node:path";

const EXIT_LIMIT_SECONDS = 10;
const FILE_REQUESTS = new Set(["FSReqCallback", "FSReqPromise"]);

// $0 is the process id, $1 the limit, $2 the main log and $3 the open file requests at exit. The start
// time makes sure that a process id the system gave to another process since is not stopped. The kill
// comes before the log write: the write can wait for the same approval as the stuck request.
const WATCHDOG_SCRIPT = [
  'start=$(ps -o lstart= -p "$0") || exit 0',
  'sleep "$1"',
  '[ "$(ps -o lstart= -p "$0" 2>/dev/null)" = "$start" ] || exit 0',
  'kill -9 "$0"',
  'mkdir -p "$(dirname "$2")"',
  'printf \'%s WARN [main] OpenBot did not exit within %s s with %s open file requests and was stopped.\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$3" >> "$2"',
].join("\n");

/**
 * Starts a detached shell when Node exits. It stops the process with SIGKILL when it is still there
 * after the limit, and adds one line to the main log. `exit` comes on `app.quit`, `app.exit` and
 * `process.exit`. Windows has no `/bin/sh`.
 */
export function stopStuckExitAfterLimit(logsDirectory: string): void {
  if (process.platform === "win32") return;
  process.once("exit", () => {
    const fileRequests = process.getActiveResourcesInfo().filter((name) => FILE_REQUESTS.has(name)).length;
    try {
      spawn(
        "/bin/sh",
        [
          "-c",
          WATCHDOG_SCRIPT,
          String(process.pid),
          String(EXIT_LIMIT_SECONDS),
          join(logsDirectory, "main", "main.log"),
          String(fileRequests),
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
    } catch {
      // A throw here would be an uncaught exception during exit.
    }
  });
}
