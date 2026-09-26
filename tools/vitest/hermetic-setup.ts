import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { isolateTestEnvironment } from "./hermetic-environment";

// Runs before each test file, ahead of its imports, so no module can read the
// real HOME first. Each file gets its own home, so files cannot share state
// through it.
const home = mkdtempSync(join(tmpdir(), "openbot-test-home-"));
isolateTestEnvironment(process.env, home);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
