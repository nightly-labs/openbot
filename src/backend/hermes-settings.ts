import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { hermesHome } from "./process-confinement";

const logger = createOpenBotLogger("provider-runtime");

/** The `agent` keys of the Hermes `config.yaml` that OpenBot sets. */
export interface HermesAgentSettings {
  readonly coding_context?: "auto" | "focus" | "on" | "off";
  readonly disabled_toolsets?: readonly string[];
}

/**
 * The `agent` settings that OpenBot gives its Hermes agents. Measured with
 * `bun run bench:hermes-prompt-settings` on Hermes Agent 0.21.5, with the bundled skills: together
 * 14,524 → 12,159 prompt tokens per reply (−16%), 29,303 → 24,545 for a task of 2 requests.
 * - `coding_context: focus` shows the skills of the non-coding categories by name only (−617 per
 *   reply). The agent can still load each of them. Hermes uses focus only in a code workspace, and
 *   collapses the toolset in focus only in its own terminal, not in ACP.
 * - `disabled_toolsets: [browser]` removes the 6 Hermes browser tools (−1,748 per reply). OpenBot gives
 *   each agent its own browser (`openbot_browser`), which shows the user the pages that the agent opens.
 */
export const HERMES_AGENT_SETTINGS = {
  coding_context: "focus",
  disabled_toolsets: ["browser"],
} as const satisfies HermesAgentSettings;

/** Hermes reads this folder as an administrator scope when `HERMES_MANAGED_DIR` does not name one. */
const HERMES_SYSTEM_MANAGED_DIR = "/etc/hermes";

/**
 * The variables that give a Hermes process the OpenBot settings. Hermes 0.21.5 reads the
 * `config.yaml` of the folder that `HERMES_MANAGED_DIR` names, and its values replace the user's own.
 * A Hermes process that saves its settings also removes these keys from the user's `config.yaml`. So
 * OpenBot sets only the keys that the user's `config.yaml` does not have. It sets nothing when
 * another managed scope applies, or when it cannot read the user's settings.
 */
export function hermesSettingsEnvironment(
  env: NodeJS.ProcessEnv,
  directory: string | undefined,
): Readonly<Record<string, string>> {
  if (!directory) return {};
  // An administrator scope: `HERMES_MANAGED_DIR` would replace it.
  if (env.HERMES_MANAGED_DIR?.trim() || existsSync(HERMES_SYSTEM_MANAGED_DIR)) return {};
  const agent = unsetAgentSettings(join(hermesHome(env), "config.yaml"));
  if (agent === null || Object.keys(agent).length === 0) return {};
  const content = stringifyYaml({ agent });
  // One folder for each content: a running process keeps the file that it started with.
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

/** The OpenBot `agent` settings that the user's `config.yaml` does not set, or null when it cannot be read. */
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
