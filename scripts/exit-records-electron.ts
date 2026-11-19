import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, crashReporter } from "electron";
import { startMainLog } from "../src/main/provider-log";
import { ResourceMonitor } from "../src/main/resource-monitor";
import { StatementTimings } from "../src/main/resource-summary";
import { TraceFile } from "../src/main/trace-file";

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
const userDataPath = argument("user-data");
app.setPath("userData", userDataPath);
const logs = join(userDataPath, "logs");
startMainLog(logs);
crashReporter.start({ uploadToServer: false });
const logger = createOpenBotLogger("main");

void app.whenReady().then(async () => {
  const trace = new TraceFile({ directory: logs });
  const monitor = new ResourceMonitor({
    userDataPath,
    server: false,
    trace,
    statementTimings: new StatementTimings(),
    tabProcessIds: () => [],
    turnRunning: () => false,
    appPath: app.getAppPath(),
  });
  monitor.start(() => undefined);
  const window = new BrowserWindow({ width: 480, height: 320, show: false });
  await window.loadURL(`data:text/html,${encodeURIComponent("<body>exit records</body>")}`);
  writeFileSync(argument("ready-file"), JSON.stringify({ pid: process.pid, crashDumps: app.getPath("crashDumps") }));

  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    logger.info("Quitting: quit.");
    await Effect.runPromise(monitor.close());
    await Effect.runPromise(trace.close());
    app.quit();
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (line === "crash") {
        window.webContents.debugger.attach();
        void window.webContents.debugger.sendCommand("Page.crash").catch(() => undefined);
      }
      if (line === "quit") void quit();
    }
  });
  process.stdin.on("end", () => void quit());
});
