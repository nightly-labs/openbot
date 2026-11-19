import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateTestEnvironment } from "./hermetic-environment";

export default function setup(): () => void {
  const home = mkdtempSync(join(tmpdir(), "openbot-test-home-"));
  isolateTestEnvironment(process.env, home);
  return () => rmSync(home, { recursive: true, force: true });
}
