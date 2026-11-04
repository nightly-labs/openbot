import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyOnlyProviderId } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

// Each extension takes the key from the environment and removes it before a tool can start a child
// process. The key is never written to the extension file. Pi runs an extension again when it
// switches sessions, so the key stays in a process slot for those later runs. Pi reads an apiKey
// that starts with `$` or `!` as an environment reference or a shell command, so the key is escaped
// to stay a literal. A header value reads `$` in the same way, but not a `!` after the start.
const readKey = (provider: KeyOnlyProviderId, variable: string) => `
  const slot = Symbol.for("openbot.pi.${provider}ApiKey");
  globalThis[slot] ??= process.env.${variable};
  delete process.env.${variable};
  const key = globalThis[slot];
  if (!key) return;
  const literal = key.replaceAll("$", "$$$$");
  const apiKey = literal.replace(/^!/, "$$!");`;

const KEY_EXTENSIONS = {
  // Inception serves Mercury through OpenAI chat completions. Pi has no built-in Inception provider,
  // so this extension registers one for this process only.
  inception: {
    variable: "OPENBOT_PI_INCEPTION_API_KEY",
    source: `export default function (pi) {${readKey("inception", "OPENBOT_PI_INCEPTION_API_KEY")}
  const levels = { off: "instant", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
  const model = (id, name, contextWindow, maxTokens, cost) => ({
    id, name, reasoning: true, input: ["text"], contextWindow, maxTokens, cost, thinkingLevelMap: levels,
  });
  pi.registerProvider("inception", {
    baseUrl: "https://api.inceptionlabs.ai/v1",
    api: "openai-completions",
    apiKey,
    models: [
      model("mercury-3", "Mercury 3", 1000000, 131072, { input: 0.1, output: 0.35, cacheRead: 0.01, cacheWrite: 0 }),
      model("mercury-2.5", "Mercury 2.5", 260000, 65536, { input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0 }),
      model("mercury-2", "Mercury 2", 128000, 50000, { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 }),
    ],
  });
}
`,
  },
  // Pi has a built-in DeepSeek provider. A registration with only the key keeps its models, endpoint
  // and thinking levels, which Pi updates (checked in Pi 1.4.0). Pi prefers a DeepSeek key that
  // `/login` stored in auth.json to this apiKey, but the Authorization header replaces either one.
  // DeepSeek refuses the whole request when a tool `pattern` has an unescaped `[` in a character class,
  // such as `^[^[\]]*$` from an MCP server (#4037). JSON Schema reads it as ECMA-262, where it is valid;
  // DeepSeek reads a nested class. Pi sends patterns as they are, so this removes those patterns only.
  // Values in `const`, `default`, `enum` and `examples` are data, and the keys of `properties` are names,
  // so they stay as they are.
  deepseek: {
    variable: "OPENBOT_PI_DEEPSEEK_API_KEY",
    source: String.raw`export default function (pi) {${readKey("deepseek", "OPENBOT_PI_DEEPSEEK_API_KEY")}
  pi.registerProvider("deepseek", { apiKey, headers: { Authorization: "Bearer " + literal } });
  const nestsClass = (pattern) => {
    let inClass = false;
    for (let index = 0; index < pattern.length; index++) {
      if (pattern[index] === "\\") index++;
      else if (pattern[index] === "[") {
        if (inClass) return true;
        inClass = true;
      } else if (pattern[index] === "]") inClass = false;
    }
    return false;
  };
  const DATA = new Set(["const", "default", "enum", "examples"]);
  const NAMES = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
  const portable = (value, names = false) => {
    if (Array.isArray(value)) return value.map((item) => portable(item));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (names) return [[key, portable(item)]];
        if (key === "pattern" && typeof item === "string" && nestsClass(item)) return [];
        return [[key, DATA.has(key) ? item : portable(item, NAMES.has(key))]];
      }),
    );
  };
  pi.on("before_provider_request", (event) =>
    Array.isArray(event.payload?.tools) ? { ...event.payload, tools: portable(event.payload.tools) } : undefined,
  );
}
`,
  },
  // Pi has a built-in OpenRouter provider with OpenRouter's model list (401 models in Pi 1.4.0). As for
  // DeepSeek, a registration with only the key keeps that list, and the Authorization header replaces a
  // key from Pi's auth.json or OPENROUTER_API_KEY. Pi sends Anthropic models to OpenRouter's Anthropic
  // Messages endpoint, which also gets the auth.json key as `x-api-key`, so that header is replaced too.
  openrouter: {
    variable: "OPENBOT_PI_OPENROUTER_API_KEY",
    source: `export default function (pi) {${readKey("openrouter", "OPENBOT_PI_OPENROUTER_API_KEY")}
  pi.registerProvider("openrouter", { apiKey, headers: { Authorization: "Bearer " + literal, "x-api-key": literal } });
}
`,
  },
} as const satisfies Record<KeyOnlyProviderId, { variable: string; source: string }>;

/** Owns one temporary, key-free extension file that gives a key-only provider its key in Pi. */
export const createPiKeyExtension = Effect.fn("PiKeyProviders.createExtension")(function* (
  provider: KeyOnlyProviderId,
  key: string,
  directory?: string,
) {
  const { variable, source } = KEY_EXTENSIONS[provider];
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, `${provider}.mjs`);
  yield* providerCall(() => writeFile(path, source, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  return {
    path,
    environment: { [variable]: key },
    secrets: [key],
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
