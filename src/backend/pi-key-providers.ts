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
  // Opper is a gateway with an OpenAI-compatible endpoint. Pi has no built-in Opper provider, so this
  // extension registers one for this process only, as for Inception. Model ids are Opper's bare ids.
  // The limits are the smallest that Opper's public catalog (https://api.opper.ai/v3/models) lists for
  // a route of the id, and the prices are those of the lab's own route. A model takes OpenAI's
  // `reasoning_effort` only with the levels that the catalog lists for every route of the id.
  opper: {
    variable: "OPENBOT_PI_OPPER_API_KEY",
    source: `export default function (pi) {${readKey("opper", "OPENBOT_PI_OPPER_API_KEY")}
  const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const levels = (efforts) => ({
    ...(efforts.includes("none") ? { off: "none" } : {}),
    ...Object.fromEntries(LEVELS.map((level) => [level, efforts.includes(level) ? level : null])),
  });
  const model = (id, name, input, contextWindow, maxTokens, cost, efforts = []) => ({
    id, name, reasoning: efforts.length > 0, input, contextWindow, maxTokens, cost,
    ...(efforts.length > 0 ? { thinkingLevelMap: levels(efforts) } : {}),
  });
  const price = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0 });
  const text = ["text"];
  const image = ["text", "image"];
  const fromLow = ["low", "medium", "high", "xhigh", "max"];
  const fromNone = ["none", ...fromLow];
  const all = ["none", "minimal", ...fromLow];
  pi.registerProvider("opper", {
    baseUrl: "https://api.opper.ai/v3/compat",
    api: "openai-completions",
    apiKey,
    headers: { Authorization: "Bearer " + literal },
    models: [
      model("claude-sonnet-5-5", "Claude Sonnet 5.5", image, 1000000, 128000, price(2, 10, 0.1), fromLow),
      model("claude-opus-5-5", "Claude Opus 5.5", image, 1000000, 128000, price(4, 20, 0.2), fromLow),
      model("claude-haiku-5-5", "Claude Haiku 5.5", image, 1000000, 128000, price(0.1, 0.5, 0.01), fromLow),
      model("gpt-6-astra", "GPT-6 Astra", image, 1050000, 128000, price(10, 50, 1), fromLow),
      model("gpt-6.1-sol", "GPT-6.1 Sol", image, 1000000, 128000, price(2, 10, 0.1), fromLow),
      model("gpt-6.1-terra", "GPT-6.1 Terra", image, 1050000, 128000, price(1, 5, 0.05), fromNone),
      model("gemini-4-argon", "Gemini 4 Argon", image, 1048576, 65536, price(2, 10, 0.1)),
      model("gemini-3.8-flash", "Gemini 3.8 Flash", image, 1048576, 65536, price(0.75, 3.75, 0.075)),
      model("qwen3.8-max", "Qwen3.8-Max", image, 983616, 131072, price(1.65, 4.951, 0.25), all),
      model("glm-5.3", "GLM-5.3", text, 1000000, 131072, price(1.4, 4.4, 0.26)),
      model("kimi-k3", "Kimi K3", text, 1048576, 1048576, price(3, 15, 0.3)),
    ],
  });
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
