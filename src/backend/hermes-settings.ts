import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { hermesHome } from "./process-confinement";

const logger = createOpenBotLogger("provider-runtime");

export interface HermesAgentSettings {
  readonly coding_context?: "auto" | "focus" | "on" | "off";
  readonly disabled_toolsets?: readonly string[];
}

export const HERMES_AGENT_SETTINGS = {
  coding_context: "focus",
  disabled_toolsets: ["browser"],
} as const satisfies HermesAgentSettings;

const HERMES_SYSTEM_MANAGED_DIR = "/etc/hermes";

export function hermesSettingsEnvironment(
  env: NodeJS.ProcessEnv,
  directory: string | undefined,
): Readonly<Record<string, string>> {
  if (!directory) return {};
  if (env.HERMES_MANAGED_DIR?.trim() || existsSync(HERMES_SYSTEM_MANAGED_DIR)) return {};
  const agent = unsetAgentSettings(join(hermesHome(env), "config.yaml"));
  if (agent === null || Object.keys(agent).length === 0) return {};
  const content = stringifyYaml({ agent });
  const folder = join(directory, "hermes-settings", createHash("sha256").update(content).digest("hex").slice(0, 16));
  const path = join(folder, "config.yaml");
  try {
    if (!existsSync(path)) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, content, { mode: 0o600 });
      renameSync(temporary, path);
    }
  } catch (error) {
    logger.warn("OpenBot could not write the Hermes settings.", { error: String(error) });
    return {};
  }
  return { HERMES_MANAGED_DIR: folder };
}

function unsetAgentSettings(path: string): HermesAgentSettings | null {
  let user: unknown;
  try {
    user = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (error) {
    if (isDynamicRecord(error) && error.code === "ENOENT") user = {};
    else return null;
  }
  if (!isDynamicRecord(user)) return null;
  const agent = user.agent ?? {};
  if (!isDynamicRecord(agent)) return null;
  return {
    ...("coding_context" in agent ? {} : { coding_context: HERMES_AGENT_SETTINGS.coding_context }),
    ...("disabled_toolsets" in agent ? {} : { disabled_toolsets: HERMES_AGENT_SETTINGS.disabled_toolsets }),
  };
}
