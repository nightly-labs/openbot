import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateTestEnvironment } from "./hermetic-environment";

// A worker thread's `process.env` is a copy: setting HOME in it does not reach the native
// `homedir()`. This runs in the main process before any thread starts, so a thread-pool project
// shares one temporary home instead of the real one.
export default function setup(): () => void {
  const home = mkdtempSync(join(tmpdir(), "openbot-test-home-"));
  isolateTestEnvironment(process.env, home);
  return () => rmSync(home, { recursive: true, force: true });
}
