import { open, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { stopStuckExitAfterLimit } from "../src/main/exit-watchdog";
import { startMainLog } from "../src/main/provider-log";

const LIBUV_THREADS = 4;

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

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

void app.whenReady().then(() => {
  writeFileSync(argument("ready-file"), JSON.stringify({ pid: process.pid, hasLock }));
  if (!hasLock) {
    app.quit();
    return;
  }
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line === "stall") {
      for (let thread = 0; thread < LIBUV_THREADS; thread++) open(argument("fifo"), "r", () => undefined);
    }
    if (line === "quit") app.quit();
    if (line === "exit") app.exit(0);
    if (line === "process-exit") process.exit(0);
  });
});
