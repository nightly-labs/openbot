import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyOnlyProviderId } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

const readKey = (provider: KeyOnlyProviderId, variable: string) => `
  const slot = Symbol.for("openbot.pi.${provider}ApiKey");
  globalThis[slot] ??= process.env.${variable};
  delete process.env.${variable};
  const key = globalThis[slot];
  if (!key) return;
  const literal = key.replaceAll("$", "$$$$");
  const apiKey = literal.replace(/^!/, "$$!");`;

const KEY_EXTENSIONS = {
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
  openrouter: {
    variable: "OPENBOT_PI_OPENROUTER_API_KEY",
    source: `export default function (pi) {${readKey("openrouter", "OPENBOT_PI_OPENROUTER_API_KEY")}
  pi.registerProvider("openrouter", { apiKey, headers: { Authorization: "Bearer " + literal, "x-api-key": literal } });
  const OUTPUT_CAP = 128000;
  pi.on("before_provider_request", (event) => {
    const payload = event.payload;
    const field = ["max_tokens", "max_completion_tokens"].find((name) => payload?.[name] > OUTPUT_CAP);
    if (!field || (payload.thinking?.budget_tokens ?? 0) >= OUTPUT_CAP) return undefined;
    return { ...payload, [field]: OUTPUT_CAP };
  });
}
`,
  },
  trustedrouter: {
    variable: "OPENBOT_PI_TRUSTEDROUTER_API_KEY",
    source: `export default function (pi) {${readKey("trustedrouter", "OPENBOT_PI_TRUSTEDROUTER_API_KEY")}
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const model = (route, name, contextWindow) => ({
    id: "trustedrouter/" + route, name, reasoning: false, input: ["text"], contextWindow, maxTokens: 32768, cost,
  });
  pi.registerProvider("trustedrouter", {
    baseUrl: "https://api.trustedrouter.com/v1",
    api: "openai-completions",
    apiKey,
    models: [
      model("auto", "Auto", 1048576),
      model("efficient", "Efficient", 1050000),
      model("fast", "Fast", 131072),
      model("professional", "Professional", 1048576),
      model("advanced", "Advanced", 1050000),
      model("frontier", "Frontier", 1050000),
      model("zdr", "ZDR", 1048576),
      model("e2e", "E2E", 1048576),
    ],
  });
}
`,
  },
} as const satisfies Record<KeyOnlyProviderId, { variable: string; source: string }>;

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
