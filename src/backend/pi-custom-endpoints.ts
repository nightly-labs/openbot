import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomProviderReasoningEffort } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { type CustomProviderConfig, customModelOutputLimit } from "./opencode-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

const VARIABLE = "OPENBOT_PI_CUSTOM_ENDPOINTS";

/** Pi's default for a model with no context window (Pi 1.4.0 `models-configuration.md`). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** What the extension reads from the environment: the endpoints with their keys and header values. */
interface EndpointPayload {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly models: readonly PiModelPayload[];
}

interface PiModelPayload {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  /** Absent: the model does not reason. */
  readonly thinkingLevelMap?: PiThinkingLevelMap;
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
      api: "openai-completions",
      apiKey: endpoint.apiKey ? literal(endpoint.apiKey) : "openbot",
      headers: Object.fromEntries(Object.entries(endpoint.headers).map(([name, value]) => [name, literal(value)])),
      models: endpoint.models.map((model) => ({
        type: "chat",
        id: model.id,
        name: model.name,
        reasoning: model.thinkingLevelMap !== undefined,
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
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
      // Pi cuts `maxTokens` to the room that the prompt leaves in the window, so a saved max output
      // above the window does not overflow (`clampMaxTokensToContext`, Pi 1.1.0:
      // https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/ai/src/api/simple-options.ts#L18-L22).
      return {
        id: model.id,
        name: model.name,
        contextWindow,
        maxTokens: customModelOutputLimit(model, contextWindow),
        ...(model.reasoningEfforts ? { thinkingLevelMap: thinkingLevelMap(model.reasoningEfforts) } : {}),
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
