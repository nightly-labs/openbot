import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { isolateTestEnvironment } from "./hermetic-environment";

const home = mkdtempSync(join(tmpdir(), "openbot-test-home-"));
isolateTestEnvironment(process.env, home);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
