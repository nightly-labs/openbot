// Builds run-tasks-electron.ts and runs the multi-step browser tasks with one driver under the repository's Electron.
// Usage: bun research/670-typed-decisions/run-tasks.ts --driver=jev|muse-minimal|muse-low|jev+muse|jev+opus [--tasks=login,filters]
// The jev drivers need TYPESAFE_API_KEY and OPENCODE_API_KEY (text helper); the muse drivers need OPENCODE_API_KEY.
// jev+opus calls the signed-in `claude` CLI.
import { launchElectron } from "./electron-launch";

process.exitCode = await launchElectron("run-tasks-electron.ts", process.argv.slice(2));
