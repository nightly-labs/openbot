import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kimiHomeDirectory } from "./process-confinement";

export type SignInRegion = "global" | "mainland-cn";

const PYTHON_GLOBAL_ENV: Readonly<Record<string, string>> = {
  KIMI_CODE_OAUTH_HOST: "https://auth.kimi.ai",
  KIMI_CODE_BASE_URL: "https://api.kimi.ai/coding/v1",
};

export function isPythonKimiCli(cli: { version: string }): boolean {
  return Number.parseInt(cli.version, 10) < 2;
}

export function kimiPythonLoginEnv(region: SignInRegion): Record<string, string> {
  return region === "global" ? { ...PYTHON_GLOBAL_ENV } : {};
}

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
