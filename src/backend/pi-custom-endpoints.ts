import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomProviderReasoningEffort } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { type CustomProviderConfig, customModelOutputLimit, isMistralApi } from "./opencode-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

const VARIABLE = "OPENBOT_PI_CUSTOM_ENDPOINTS";

const DEFAULT_CONTEXT_WINDOW = 128_000;

interface EndpointPayload {
  readonly id: string;
  readonly name: string;
  readonly api: "openai-completions" | "mistral-conversations";
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly models: readonly PiModelPayload[];
  readonly compat?: PiCompat;
}

interface PiCompat {
  readonly supportsStore: false;
  readonly supportsDeveloperRole: false;
}

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
  readonly thinkingLevelMap?: PiThinkingLevelMap;
  readonly input: readonly ("text" | "image")[];
}

type PiThinkingLevelMap = Readonly<
  Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", CustomProviderReasoningEffort | null>
>;

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
      return {
        id: model.id,
        name: model.name,
        contextWindow,
        maxTokens: customModelOutputLimit(model, contextWindow),
        ...(model.reasoningEfforts ? { thinkingLevelMap: thinkingLevelMap(model.reasoningEfforts) } : {}),
        input: model.inputs?.includes("image") ? ["text", "image"] : ["text"],
      };
    }),
  };
}

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
