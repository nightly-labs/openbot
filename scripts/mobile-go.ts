import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mobileRoot = join(repositoryRoot, "apps/mobile");
const expo = createRequire(join(mobileRoot, "package.json")).resolve("expo/bin/cli");
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--");

function currentBranch(): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function sessionName(branch: string): string | undefined {
  const issueNumber = /-(\d+)$/.exec(branch)?.[1];
  return issueNumber ? `Issue #${issueNumber}` : undefined;
}

const name = process.env.OPENBOT_EXPO_SESSION_NAME || sessionName(currentBranch());
const result = spawnSync("node", [expo, "start", "--go", "--clear", ...extraArgs], {
  cwd: mobileRoot,
  stdio: "inherit",
  env: name ? { ...process.env, OPENBOT_EXPO_SESSION_NAME: name } : process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
