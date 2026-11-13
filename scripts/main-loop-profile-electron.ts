// Electron side of `scripts/main-loop-profile-e2e.ts`. It blocks the main thread in a named function
// and writes what the stall profiler reports to `--result-file`.
// 1. Always: one profile with `MainLoopProfiler`, as the resource monitor makes it.
// 2. With `--trigger`: the resource monitor itself, at its real one-minute samples. The main thread
//    blocks every 20 s from the start, so the first profile comes after the two start-up minutes.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { app } from "electron";
import { MainLoopProfiler, summarizeCpuProfile } from "../src/main/main-loop-profile";
import { type MainLoopStallProfile, ResourceMonitor } from "../src/main/resource-monitor";
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
const appRoot = dirname(fileURLToPath(import.meta.url));

function blockMainLoopForTest(durationMs: number): number {
  const end = Date.now() + durationMs;
  let turns = 0;
  while (Date.now() < end) turns += 1;
  return turns;
}

// No top-level await: Electron does not get ready until an ESM main module has run to its end.
void app.whenReady().then(async () => {
  const profiler = new MainLoopProfiler();
  await Effect.runPromise(profiler.start());
  blockMainLoopForTest(1_500);
  const profile = await Effect.runPromise(profiler.stop());
  const direct = profile ? summarizeCpuProfile(profile, appRoot) : null;

  let triggered: MainLoopStallProfile | null = null;
  if (process.argv.includes("--trigger")) {
    const trace = new TraceFile({ directory: join(userDataPath, "logs") });
    const monitor = new ResourceMonitor({
      userDataPath,
      server: true,
      trace,
      statementTimings: new StatementTimings(),
      tabProcessIds: () => [],
      turnRunning: () => false,
      appPath: appRoot,
    });
    triggered = await new Promise<MainLoopStallProfile>((done) => {
      monitor.start(() => undefined, done);
      setInterval(() => blockMainLoopForTest(2_600), 20_000);
    });
    await Effect.runPromise(monitor.close());
    await Effect.runPromise(trace.close());
  }
  writeFileSync(argument("result-file"), JSON.stringify({ direct, triggered }));
  app.quit();
});
