import { join } from "node:path";

const CREDENTIAL_SUFFIX = /(?:_API_KEY|_TOKEN|_SECRET|_PRIVATE_KEY|_PASSWORD)$/u;
const PROVIDER_PREFIX = /^(?:ANTHROPIC|OPENAI|OPENROUTER|XAI|GEMINI|AWS)_/u;

const REAL_DIRECTORY_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
] as const;

function isCredentialName(name: string): boolean {
  return CREDENTIAL_SUFFIX.test(name) || PROVIDER_PREFIX.test(name);
}

export function isolateTestEnvironment(env: NodeJS.ProcessEnv, home: string): void {
  for (const name of Object.keys(env)) {
    if (isCredentialName(name)) delete env[name];
  }
  for (const name of REAL_DIRECTORY_OVERRIDES) delete env[name];
  delete env.ELECTRON_RUN_AS_NODE;
  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = join(home, "AppData", "Roaming");
  env.LOCALAPPDATA = join(home, "AppData", "Local");
  env.TZ = "UTC";
  env.LANG = "C.UTF-8";
}
