import { spawn } from "node:child_process";
import { join } from "node:path";

const EXIT_LIMIT_SECONDS = 10;
const FILE_REQUESTS = new Set(["FSReqCallback", "FSReqPromise"]);

const WATCHDOG_SCRIPT = [
  'start=$(ps -o lstart= -p "$0") || exit 0',
  'sleep "$1"',
  '[ "$(ps -o lstart= -p "$0" 2>/dev/null)" = "$start" ] || exit 0',
  'kill -9 "$0"',
  'mkdir -p "$(dirname "$2")"',
  'printf \'%s WARN [main] OpenBot did not exit within %s s with %s open file requests and was stopped.\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$3" >> "$2"',
].join("\n");

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
    } catch {}
  });
}
