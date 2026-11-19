import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomProviderReasoningEffort } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { type CustomProviderConfig, customModelOutputLimit, isMistralApi } from "./opencode-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

const VARIABLE = "OPENBOT_PI_CUSTOM_ENDPOINTS";

/** Pi's default for a model with no context window (Pi 1.4.0 `models-configuration.md`). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** What the extension reads from the environment: the endpoints with their keys and header values. */
interface EndpointPayload {
  readonly id: string;
  readonly name: string;
  readonly api: "openai-completions" | "mistral-conversations";
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly models: readonly PiModelPayload[];
  /** Absent: Pi detects the compat flags from the base URL. */
  readonly compat?: PiCompat;
}

/** Pi's `openai-completions` compat flags that OpenBot sets (Pi 1.1.0 to 1.5.2 `getCompat`). */
interface PiCompat {
  readonly supportsStore: false;
  readonly supportsDeveloperRole: false;
}

/**
 * Pi sends `store` and, for a reasoning model, the `developer` role to each base URL that is not on
 * its own list of other services (`detectCompat`, Pi 1.1.0 to 1.5.2). Strict endpoints refuse the
 * request: EXAONE and DeepSeek hosts refuse `developer` (#7434, #11328). Only OpenAI and Azure OpenAI
 * define both, so other hosts get neither, as in OpenCode. OpenRouter keeps Pi's own choice: Pi sends
 * `developer` there for its OpenAI and Anthropic models only.
 */
function keepsPiCompat(baseUrl: string): boolean {
  const host = URL.parse(baseUrl)?.hostname ?? "";
  return (
    host === "api.openai.com" ||
    host.endsWith(".openai.azure.com") ||
    host.endsWith(".cognitiveservices.azure.com") ||
    host.endsWith(".services.ai.azure.com") ||
    host === "openrouter.ai"
  );
}

/**
 * Mistral's API refuses each field that it does not know with HTTP 422, such as `store` (#11850) and
 * `max_completion_tokens`, and it streams thinking as a list of parts. Pi's own Mistral API sends
 * Mistral's fields and reads those parts, as OpenCode's Mistral adapter does (`isMistralApi`). It adds
 * `v1/chat/completions` to the base URL, so the `/v1` of the OpenAI-compatible URL goes.
 */
function piEndpoint(baseUrl: string): Pick<EndpointPayload, "api" | "baseUrl" | "compat"> {
  if (isMistralApi(baseUrl)) return { api: "mistral-conversations", baseUrl: baseUrl.replace(/\/v1\/*$/u, "") };
  return {
    api: "openai-completions",
    baseUrl,
    ...(keepsPiCompat(baseUrl) ? {} : { compat: { supportsStore: false, supportsDeveloperRole: false } }),
  };
}

interface PiModelPayload {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  /** Absent: the model does not reason. */
  readonly thinkingLevelMap?: PiThinkingLevelMap;
  /** Pi's `input`: text, and images when the user says the model takes them. */
  readonly input: readonly ("text" | "image")[];
}

type PiThinkingLevelMap = Readonly<
  Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", CustomProviderReasoningEffort | null>
>;

/**
 * The `reasoning_effort` that Pi sends for each of its levels, and null for a level that the endpoint
 * does not accept. Pi lists only the levels that are not null (`getSupportedThinkingLevels`, Pi 1.1.0:
 * https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/models.ts#L1224-L1233).
 * Pi's `off` is OpenBot's `none`.
 */
function thinkingLevelMap(efforts: readonly CustomProviderReasoningEffort[]): PiThinkingLevelMap {
  const accepted = (effort: CustomProviderReasoningEffort) => (efforts.includes(effort) ? effort : null);
  return {
    off: accepted("none"),
    minimal: accepted("minimal"),
    low: accepted("low"),
    medium: accepted("medium"),
    high: accepted("high"),
    xhigh: accepted("xhigh"),
    max: accepted("max"),
  };
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
      api: endpoint.api,
      apiKey: endpoint.apiKey ? literal(endpoint.apiKey) : "openbot",
      headers: Object.fromEntries(Object.entries(endpoint.headers).map(([name, value]) => [name, literal(value)])),
      models: endpoint.models.map((model) => ({
        type: "chat",
        id: model.id,
        name: model.name,
        reasoning: model.thinkingLevelMap !== undefined,
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
        input: model.input,
        ...(endpoint.compat ? { compat: endpoint.compat } : {}),
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
    ...piEndpoint(endpoint.baseUrl),
    apiKey: endpoint.apiKey,
    headers: Object.fromEntries(endpoint.headers.map((header) => [header.name, header.value])),
    models: endpoint.models.map((model) => {
      const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      // Pi cuts `maxTokens` to the room that the prompt leaves in the window, so a saved max output
      // above the window does not overflow (`clampMaxTokensToContext`, Pi 1.1.0:
      // https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/simple-options.ts#L18-L22).
      return {
        id: model.id,
        name: model.name,
        contextWindow,
        maxTokens: customModelOutputLimit(model, contextWindow),
        ...(model.reasoningEfforts ? { thinkingLevelMap: thinkingLevelMap(model.reasoningEfforts) } : {}),
        // Pi's model `input` is `("text" | "image")[]` (Pi 1.1.0 `packages/ai/src/types.ts`), so it has no PDF.
        input: model.inputs?.includes("image") ? ["text", "image"] : ["text"],
      };
    }),
  };
}

/**
 * The keys and non-empty header values of the endpoints with a model, which output must not show.
 *
 * A value that is the endpoint's own ID or display name is left out. A local model server ignores its
 * key, so a user can type the provider's name there. The name shows in the model list, and masking it
 * changed it to `•••` in each answer (#12580).
 */
export function piCustomEndpointSecrets(endpoints: readonly CustomProviderConfig[]): string[] {
  return endpoints
    .filter((endpoint) => endpoint.models.length > 0)
    .flatMap((endpoint) => {
      const names = new Set([endpoint.id.toLowerCase(), endpoint.name.toLowerCase()]);
      return [endpoint.apiKey ?? "", ...endpoint.headers.map((header) => header.value)].filter(
        (value) => value.length > 0 && !names.has(value.toLowerCase()),
      );
    });
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
  return {
    path,
    environment: { [VARIABLE]: JSON.stringify(usable.map(payload)) },
    secrets: piCustomEndpointSecrets(usable),
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
