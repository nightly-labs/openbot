import {
  type CustomProviderHarness,
  type CustomProviderHeader,
  type CustomProviderModel,
  customModelKey,
} from "@openbot/contracts/ipc";

export interface CustomProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly models: readonly CustomProviderModel[];
  readonly headers: readonly CustomProviderHeader[];
  readonly harness?: CustomProviderHarness;
  readonly withoutReasoning?: readonly string[];
}

export type CustomProviderSource = () => readonly CustomProviderConfig[];

export function customProvidersOn(source: CustomProviderSource, harness: CustomProviderHarness): CustomProviderSource {
  return () => source().filter((provider) => (provider.harness ?? "opencode") === harness);
}

const PUBLIC_HEADER_NAMES = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "anthropic-beta",
  "anthropic-version",
  "api-version",
  "content-type",
  "http-referer",
  "openai-organization",
  "openai-project",
  "origin",
  "referer",
  "user-agent",
  "x-title",
]);

export function customProviderSecretValues(
  providers: readonly Pick<CustomProviderConfig, "apiKey" | "headers">[],
): string[] {
  return providers.flatMap((provider) => [
    ...(provider.apiKey ? [provider.apiKey] : []),
    ...provider.headers
      .filter((header) => !PUBLIC_HEADER_NAMES.has(header.name.trim().toLowerCase()))
      .map((header) => header.value),
  ]);
}

export const CUSTOM_ENDPOINT_SILENCE_MS = 30 * 60_000;

interface OpenCodeProviderOptions {
  readonly baseURL: string;
  readonly headerTimeout: number;
  readonly chunkTimeout: number;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface OpenCodeModelEntry {
  readonly id?: string;
  readonly name: string;
  readonly limit?: { readonly context: number; readonly output: number };
  readonly variants?: Readonly<Record<string, { readonly reasoningEffort: string }>>;
  readonly modalities?: { readonly input: readonly string[]; readonly output: readonly string[] };
}

interface OpenCodeProviderEntry {
  readonly npm: string;
  readonly name: string;
  readonly options: OpenCodeProviderOptions;
  readonly models: Readonly<Record<string, OpenCodeModelEntry>>;
}

interface OpenCodeNativeModelEntry {
  readonly modelID?: string;
  readonly name: string;
  readonly limit?: { readonly context: number; readonly output: number };
  readonly capabilities?: { readonly input: readonly string[]; readonly output: readonly string[] };
  readonly variants?: readonly { readonly id: string; readonly settings: { readonly reasoningEffort: string } }[];
}

interface OpenCodeNativeProviderEntry {
  readonly package: string;
  readonly name: string;
  readonly compatibility: { readonly reasoningField?: "reasoning"; readonly requireReasoning: false };
  readonly settings: Omit<OpenCodeProviderOptions, "headers">;
  readonly headers?: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<string, OpenCodeNativeModelEntry>>;
}

interface OpenCodeKeyEntry {
  readonly options: { readonly apiKey: string };
}

type OpenCodePermissionLayer = Readonly<Record<string, "allow" | "ask" | "deny">>;

interface OpenCodeConfig {
  readonly agent?: { readonly title: { readonly disable: true } };
  readonly permission?: OpenCodePermissionLayer;
  readonly provider?: Readonly<Record<string, OpenCodeProviderEntry | OpenCodeKeyEntry>>;
  readonly providers?: Readonly<Record<string, OpenCodeNativeProviderEntry>>;
  readonly experimental?: { readonly image_generate: false; readonly video_generate: false };
}

export type OpenCodeConfigBase = Omit<OpenCodeConfig, "agent" | "provider" | "providers">;

const OPENCODE_TITLE_OFF = { title: { disable: true } } as const;

export const OPENCODE_PROFILE_CONFIG: OpenCodeConfigBase = { permission: { "*": "deny", bash: "ask", read: "ask" } };

const OPENCODE_AGENT_CONFIG: OpenCodeConfigBase = {
  permission: {
    "opencode_session_*": "deny",
    "opencode_worktree_*": "deny",
    automation_create: "deny",
    automation_resume: "deny",
  },
};

const OPENCODE_MEDIA_TOOLS_OFF = { image_generate: false, video_generate: false } as const;

export function openCodeAgentConfig(mediaSignIn: boolean): OpenCodeConfigBase {
  return mediaSignIn ? OPENCODE_AGENT_CONFIG : { ...OPENCODE_AGENT_CONFIG, experimental: OPENCODE_MEDIA_TOOLS_OFF };
}

const OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

export const OPENCODE_GO_PROVIDER = "opencode-go";

const OPENCODE_GO_ADVICE = "OpenCode listed no model. Add an OpenCode Go key to continue.";

const OPENCODE_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

const OPENCODE_ANTHROPIC_NPM = "@ai-sdk/anthropic";

const OPENCODE_OPENAI_NPM = "@ai-sdk/openai";

function anthropicBaseUrl(baseUrl: string): string | null {
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && url.hostname === "api.anthropic.com" ? `${url.origin}/v1` : null;
}

function usesResponsesApi(provider: CustomProviderConfig): boolean {
  const url = URL.parse(provider.baseUrl);
  if (!provider.apiKey || url?.protocol !== "https:") return false;
  if (url.hostname === "api.openai.com") return url.pathname === "/v1" || url.pathname === "/v1/";
  return (
    (url.hostname.endsWith(".openai.azure.com") || url.hostname.endsWith(".services.ai.azure.com")) &&
    (url.pathname === "/openai/v1" || url.pathname === "/openai/v1/")
  );
}

function providerEntry(provider: CustomProviderConfig): OpenCodeProviderEntry {
  const anthropic = anthropicBaseUrl(provider.baseUrl);
  return {
    npm: anthropic
      ? OPENCODE_ANTHROPIC_NPM
      : usesResponsesApi(provider)
        ? OPENCODE_OPENAI_NPM
        : OPENCODE_COMPATIBLE_NPM,
    name: provider.name,
    options: {
      baseURL: anthropic ?? provider.baseUrl,
      headerTimeout: CUSTOM_ENDPOINT_SILENCE_MS,
      chunkTimeout: CUSTOM_ENDPOINT_SILENCE_MS,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.headers.length > 0
        ? { headers: Object.fromEntries(provider.headers.map((header) => [header.name, header.value])) }
        : {}),
    },
    models: Object.fromEntries(
      provider.models.map((model) => {
        const key = customModelKey(provider.id, model.id);
        const entry = modelEntry(model, provider.withoutReasoning?.includes(model.id) === true);
        return [key, key === model.id ? entry : { id: model.id, ...entry }];
      }),
    ),
  };
}

const DEFAULT_OUTPUT_LIMIT = 16_384;

export function customModelOutputLimit(model: CustomProviderModel, contextWindow: number): number {
  return model.maxOutput ?? Math.min(DEFAULT_OUTPUT_LIMIT, Math.floor(contextWindow / 2));
}

function modelEntry(model: CustomProviderModel, withoutReasoning: boolean): OpenCodeModelEntry {
  return {
    name: model.name,
    ...(model.contextWindow === undefined
      ? {}
      : { limit: { context: model.contextWindow, output: customModelOutputLimit(model, model.contextWindow) } }),
    ...(model.reasoningEfforts === undefined
      ? withoutReasoning
        ? { variants: {} }
        : {}
      : {
          variants: Object.fromEntries(model.reasoningEfforts.map((effort) => [effort, { reasoningEffort: effort }])),
        }),
    ...(model.inputs === undefined ? {} : { modalities: { input: ["text", ...model.inputs], output: ["text"] } }),
  };
}

export function hasCustomProviderCredentials(providers: readonly CustomProviderConfig[]): boolean {
  return providers.some(
    (provider) => provider.models.length > 0 && (Boolean(provider.apiKey) || provider.headers.length > 0),
  );
}

function customProviderEntries(
  providers: readonly CustomProviderConfig[],
): Readonly<Record<string, OpenCodeProviderEntry>> | null {
  const usable = providers.filter((provider) => provider.models.length > 0);
  if (usable.length === 0) return null;
  return Object.fromEntries(usable.map((provider) => [provider.id, providerEntry(provider)]));
}

export function isMistralApi(baseUrl: string): boolean {
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && (url.hostname === "mistral.ai" || url.hostname.endsWith(".mistral.ai"));
}

const OPENCODE_MISTRAL_PACKAGE = "aisdk:@ai-sdk/mistral";

function isGroqApi(baseUrl: string): boolean {
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && (url.hostname === "groq.com" || url.hostname.endsWith(".groq.com"));
}

function nativeProviderEntry(
  { npm, name, options, models }: OpenCodeProviderEntry,
  groq: boolean,
): OpenCodeNativeProviderEntry {
  const { headers, ...settings } = options;
  return {
    package: options.apiKey && !groq ? OPENCODE_MISTRAL_PACKAGE : `aisdk:${npm}`,
    name,
    compatibility: groq ? { reasoningField: "reasoning", requireReasoning: false } : { requireReasoning: false },
    settings,
    ...(headers ? { headers } : {}),
    models: Object.fromEntries(Object.entries(models).map(([id, model]) => [id, nativeModelEntry(model)])),
  };
}

function nativeModelEntry({ id, name, limit, modalities, variants }: OpenCodeModelEntry): OpenCodeNativeModelEntry {
  return {
    ...(id ? { modelID: id } : {}),
    name,
    ...(limit ? { limit } : {}),
    ...(modalities ? { capabilities: modalities } : {}),
    ...(variants ? { variants: Object.entries(variants).map(([id, settings]) => ({ id, settings })) } : {}),
  };
}

function nativeProviderEntries(
  providers: readonly CustomProviderConfig[],
): Readonly<Record<string, OpenCodeNativeProviderEntry>> | null {
  const usable = providers.filter(
    (provider) => provider.models.length > 0 && (isMistralApi(provider.baseUrl) || isGroqApi(provider.baseUrl)),
  );
  if (usable.length === 0) return null;
  return Object.fromEntries(
    usable.map((provider) => [provider.id, nativeProviderEntry(providerEntry(provider), isGroqApi(provider.baseUrl))]),
  );
}

function mergeOpenCodeConfig(
  base: OpenCodeConfigBase,
  providers: readonly CustomProviderConfig[],
  apiKey: string | null,
): OpenCodeConfig {
  const entries = {
    ...(apiKey ? { [OPENCODE_GO_PROVIDER]: { options: { apiKey } } } : {}),
    ...customProviderEntries(providers),
  };
  const native = nativeProviderEntries(providers);
  return {
    ...base,
    agent: OPENCODE_TITLE_OFF,
    ...(Object.keys(entries).length > 0 ? { provider: entries } : {}),
    ...(native ? { providers: native } : {}),
  };
}

export function clearedInheritedOpenCodeKeyEnv(apiKey: string | null): Record<string, string> {
  return apiKey && process.env.OPENCODE_API_KEY?.trim() ? { OPENCODE_API_KEY: "" } : {};
}

export function openCodeConfigEnv(
  base: OpenCodeConfigBase,
  source: CustomProviderSource,
  apiKey: string | null,
): Record<string, string> {
  return { [OPENCODE_CONFIG_ENV]: JSON.stringify(mergeOpenCodeConfig(base, source(), apiKey)) };
}

const OPENCODE_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
};

export function openCodeModelName(id: string, name: string, source: CustomProviderSource): string {
  const separator = id.indexOf("/");
  if (separator <= 0) return name;
  const providerId = id.slice(0, separator);
  if (!name.startsWith(`${providerId}/`)) return name;
  const providerName =
    source().find((provider) => provider.id === providerId)?.name ?? OPENCODE_PROVIDER_NAMES[providerId];
  return providerName ? `${providerName}${name.slice(providerId.length)}` : name;
}

export function openCodeSignInMessage(customProviderCount: number): string {
  if (customProviderCount === 0) return OPENCODE_GO_ADVICE;
  return `OpenCode could not start a session. Check your custom provider's base URL and API key, or add an OpenCode Go key if you also use OpenCode's own models.`;
}
