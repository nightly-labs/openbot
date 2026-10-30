import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { CustomProviderConfig } from "./opencode-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

const VARIABLE = "OPENBOT_PI_CUSTOM_ENDPOINTS";

/** Pi's defaults for a model with no limits (Pi 1.4.0 `models-configuration.md`). */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/** What the extension reads from the environment: the endpoints with their keys and header values. */
interface EndpointPayload {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly models: readonly { id: string; name: string; contextWindow: number; maxTokens: number }[];
}

// As in `pi-key-providers.ts`, the endpoints come from the environment, and the extension removes
// them before a tool can start a child process. Pi runs an extension again when it switches
// sessions, so the endpoints stay in a process slot for those later runs. Pi reads `$` in an apiKey
// or a header value as an environment reference, and a leading `!` as a shell command, so both are
// escaped to stay literal. Pi lists a model only when its provider has a key, so a keyless endpoint
// gets a placeholder key, as Pi's own Ollama example does; a local server ignores it.
const SOURCE = `export default function (pi) {
  const slot = Symbol.for("openbot.pi.customEndpoints");
  globalThis[slot] ??= process.env.${VARIABLE};
  delete process.env.${VARIABLE};
  const payload = globalThis[slot];
  if (!payload) return;
  const literal = (value) => value.replaceAll("$", "$$$$").replace(/^!/, "$$!");
  for (const endpoint of JSON.parse(payload)) {
    pi.registerProvider(endpoint.id, {
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      api: "openai-completions",
      apiKey: endpoint.apiKey ? literal(endpoint.apiKey) : "openbot",
      headers: Object.fromEntries(Object.entries(endpoint.headers).map(([name, value]) => [name, literal(value)])),
      models: endpoint.models.map((model) => ({
        type: "chat",
        id: model.id,
        name: model.name,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
    });
  }
}
`;

function payload(endpoint: CustomProviderConfig): EndpointPayload {
  return {
    id: endpoint.id,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    headers: Object.fromEntries(endpoint.headers.map((header) => [header.name, header.value])),
    models: endpoint.models.map((model) => {
      const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      // A small context leaves room for the prompt: a server refuses a request whose prompt and
      // output budget together pass the model's length.
      return {
        id: model.id,
        name: model.name,
        contextWindow,
        maxTokens: Math.min(DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 2)),
      };
    }),
  };
}

/**
 * Owns one temporary extension file that registers the custom endpoints that run on Pi. The keys and
 * header values never reach the file. Null when no endpoint with a model runs on Pi.
 */
export const createPiCustomEndpointExtension = Effect.fn("PiCustomEndpoints.createExtension")(function* (
  endpoints: readonly CustomProviderConfig[],
  directory?: string,
) {
  const usable = endpoints.filter((endpoint) => endpoint.models.length > 0);
  if (usable.length === 0) return null;
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "custom-endpoints.mjs");
  yield* providerCall(() => writeFile(path, SOURCE, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  const secrets = usable.flatMap((endpoint) => [
    ...(endpoint.apiKey ? [endpoint.apiKey] : []),
    ...endpoint.headers.map((header) => header.value).filter((value) => value.length > 0),
  ]);
  return {
    path,
    environment: { [VARIABLE]: JSON.stringify(usable.map(payload)) },
    secrets,
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
