// Builds capture-electron.ts and runs it under the repository's Electron.
// Usage: bun research/670-typed-decisions/capture-snapshots.ts
import { launchElectron } from "./electron-launch";

process.exitCode = await launchElectron("capture-electron.ts", []);
