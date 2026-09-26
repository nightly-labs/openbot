import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// This project runs files in worker threads, and a thread's `process.env` does not reach the native
// `homedir()`. Only the global setup, which runs before the threads start, can move it.
it("moves the home directory of a thread-pool test into a temporary directory", () => {
  expect(join(homedir(), "OpenBot").startsWith(join(tmpdir(), "openbot-test-home-"))).toBe(true);
});
