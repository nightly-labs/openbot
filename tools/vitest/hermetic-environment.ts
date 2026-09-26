import { join } from "node:path";

// What a test process may inherit from the shell that started it.
//
// A developer runs the suite from a shell that holds provider keys, a real home
// directory with `~/OpenBot` and the app profile under it, and sometimes the
// environment of a coding agent. None of that may reach a test: a key lets a
// fake-provider test call a real provider, and a real home lets a path bug write
// into the developer's own conversations. Every profile path is derived from
// `homedir()` (see `AgentStore` in `src/main/application-services.ts`), so
// pointing HOME at a temporary directory moves all of them at once.

const CREDENTIAL_SUFFIX = /(?:_API_KEY|_TOKEN|_SECRET|_PRIVATE_KEY|_PASSWORD)$/u;
const PROVIDER_PREFIX = /^(?:ANTHROPIC|OPENAI|OPENROUTER|XAI|GEMINI|AWS)_/u;

// Each of these names a real directory that a provider CLI or a library would
// use in place of one under HOME.
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
  // An agent shell exports this, and it turns every spawned Electron into Node.
  delete env.ELECTRON_RUN_AS_NODE;
  env.HOME = home;
  env.USERPROFILE = home;
  // Windows resolves application data from these, not from USERPROFILE.
  env.APPDATA = join(home, "AppData", "Roaming");
  env.LOCALAPPDATA = join(home, "AppData", "Local");
  env.TZ = "UTC";
  env.LANG = "C.UTF-8";
}
