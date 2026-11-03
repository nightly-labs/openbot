import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kimiHomeDirectory } from "./process-confinement";

/**
 * The site of a Kimi account. `global`: kimi.ai. `mainland-cn`: kimi.com, for mainland China.
 * Connect signs in with `global`; the ⋯ menu of this computer signs in with `mainland-cn`.
 */
export type SignInRegion = "global" | "mainland-cn";

/**
 * The hosts of a global account for the Python Kimi CLI. It has no region option, and it reads the
 * sign-in host for each token refresh, so every process of a global account needs both variables.
 */
const PYTHON_GLOBAL_ENV: Readonly<Record<string, string>> = {
  KIMI_CODE_OAUTH_HOST: "https://auth.kimi.ai",
  KIMI_CODE_BASE_URL: "https://api.kimi.ai/coding/v1",
};

/** The Python CLI is 1.x. Kimi Code 2.x keeps the region of its sign-in by itself. */
export function isPythonKimiCli(cli: { version: string }): boolean {
  return Number.parseInt(cli.version, 10) < 2;
}

/** The variables that make a Python CLI sign in to the region. */
export function kimiPythonLoginEnv(region: SignInRegion): Record<string, string> {
  return region === "global" ? { ...PYTHON_GLOBAL_ENV } : {};
}

/**
 * The variables for a Python CLI process. Its sign-in writes the API address into `config.toml`,
 * so the file tells which region the saved sign-in belongs to. A missing or unreadable file is a
 * CLI that is not signed in, which needs no variables.
 */
export function kimiPythonSavedRegionEnv(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Record<string, string> {
  let config: string;
  try {
    config = readFileSync(join(kimiHomeDirectory(env, home), "config.toml"), "utf8");
  } catch {
    return {};
  }
  return /^\s*base_url\s*=\s*["']https:\/\/api\.kimi\.ai\//mu.test(config) ? { ...PYTHON_GLOBAL_ENV } : {};
}
