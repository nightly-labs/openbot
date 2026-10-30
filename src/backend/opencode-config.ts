// The OpenCode config OpenBot hands to a spawned `opencode acp` process.
//
// OpenCode reads its own global and project config files first and then applies
// `OPENCODE_CONFIG_CONTENT` as one more layer, so this is an overlay: it adds a provider without
// touching the user's file or their `opencode auth login` credentials. Verified against OpenCode
// 1.18.27, where `opencode models` listed the user's own 20 models plus the two named here.
//
// This lives beside `provider-drivers.ts` rather than inside it because the driver table is a table:
// the shape of one CLI's config is a concern of its own, and it is the half worth unit testing.

import type { CustomProviderHeader, CustomProviderModel } from "@openbot/contracts/ipc";

/** One endpoint, as the main process stores it. Carries the secrets, so it never crosses IPC. */
export interface CustomProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly models: readonly CustomProviderModel[];
  readonly headers: readonly CustomProviderHeader[];
}

/**
 * Read at spawn, never captured.
 *
 * A getter rather than a value because one `opencode acp` process serves the whole app and the
 * config only reaches it through a respawn: a saved endpoint must land in the *next* process, and a
 * captured array would pin whatever was stored when the driver was built.
 */
export type CustomProviderSource = () => readonly CustomProviderConfig[];

/** The options block OpenCode hands to its bundled OpenAI-compatible, OpenAI or Anthropic adapter. */
interface OpenCodeProviderOptions {
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * One model of an endpoint. OpenCode refuses a `limit` without `output`, and then lists none of the
 * endpoint's models. `output: 0` keeps OpenCode's own output budget, which it also cuts to the room
 * the context leaves. Checked in OpenCode 2.1.4: a model with no `limit` reports 200K context, and
 * `{ context: 32768, output: 0 }` sent `max_completion_tokens: 21071`.
 */
interface OpenCodeModelEntry {
  readonly name: string;
  readonly limit?: { readonly context: number; readonly output: 0 };
}

/** One entry under OpenCode's own `provider` key, keyed there by the endpoint's id. */
interface OpenCodeProviderEntry {
  readonly npm: string;
  readonly name: string;
  readonly options: OpenCodeProviderOptions;
  readonly models: Readonly<Record<string, OpenCodeModelEntry>>;
}

/**
 * The stored OpenCode Go key, under a built-in provider that `OPENCODE_API_KEY` also reaches.
 *
 * OpenCode applies the key from its own `auth.json` (`opencode auth login`) after the environment
 * key, so an old key saved there replaced the key pasted into OpenBot, and a new key could not fix
 * an expired one (#2544). Config `options.apiKey` comes after both. Checked in OpenCode 1.18.30 to
 * 1.18.35: with both keys present, the request carried the config key.
 */
interface OpenCodeKeyEntry {
  readonly options: { readonly apiKey: string };
}

/** One rule per tool pattern, which is all OpenBot sends under `permission`. */
type OpenCodePermissionLayer = Readonly<Record<string, "allow" | "ask" | "deny">>;

/** The config layer OpenBot owns on `OPENCODE_CONFIG_CONTENT`. The user's own file is untouched. */
interface OpenCodeConfig {
  readonly permission?: OpenCodePermissionLayer;
  readonly provider?: Readonly<Record<string, OpenCodeProviderEntry | OpenCodeKeyEntry>>;
}

/** What a caller starts from: every layer except the providers this module adds. */
export type OpenCodeConfigBase = Omit<OpenCodeConfig, "provider">;

/**
 * Profile generation runs a throwaway OpenCode session for a one-shot prompt, so it must not be able
 * to touch the computer. This layer is the reason the custom-provider config has to merge rather than
 * replace: both live under the same environment variable.
 *
 * `bash` and `read` ask rather than deny. OpenCode leaves a denied tool out of the request, and Zen
 * refuses a free model a request that offers no `bash` and `read`: "OpenCode's free tier can only be
 * used from within OpenCode". Checked in OpenCode 1.19.3 and 2.1.1. The profile client cancels every
 * permission request, and OpenCode rejects a cancelled one, so neither tool can run.
 */
export const OPENCODE_PROFILE_CONFIG: OpenCodeConfigBase = { permission: { "*": "deny", bash: "ask", read: "ask" } };

const OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

/** The built-in providers that read `OPENCODE_API_KEY`: OpenCode Go and the free tier. */
const OPENCODE_KEY_PROVIDERS = ["opencode-go", "opencode"] as const;

/** What a plain OpenCode user needs, now that the free models run without an account at all. */
const OPENCODE_GO_ADVICE = "OpenCode listed no model. Add an OpenCode Go key to continue.";

/** The provider adapter OpenCode bundles for an OpenAI-compatible endpoint. */
const OPENCODE_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/** The adapter OpenCode bundles for its own Anthropic provider. */
const OPENCODE_ANTHROPIC_NPM = "@ai-sdk/anthropic";

/** The adapter OpenCode bundles for OpenAI, which calls the Responses API. */
const OPENCODE_OPENAI_NPM = "@ai-sdk/openai";

/**
 * Anthropic's OpenAI-compatible endpoint ignores prompt caching, so each turn paid the full input
 * price. An endpoint on Anthropic's own API host uses the Messages API instead: OpenCode 1.19.3 adds
 * `cacheControl` breakpoints for the `@ai-sdk/anthropic` adapter, and that adapter appends
 * `/messages` to a base URL that ends in `/v1`.
 */
function anthropicBaseUrl(baseUrl: string): string | null {
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && url.hostname === "api.anthropic.com" ? `${url.origin}/v1` : null;
}

/**
 * Azure OpenAI and Foundry refuse function tools with `reasoning_effort` on `/chat/completions`, and
 * every agent turn sends both, so each turn failed with a 400 (#3460). Their v1 API serves
 * `/responses` at the same base URL and takes the key as a bearer token, so the OpenAI adapter works
 * unchanged. `@ai-sdk/azure` is no fix: it builds `/deployments/<model>/responses`, which a v1
 * resource answers with 404.
 *
 * Only with a key: without `apiKey`, the OpenAI adapter reads `OPENAI_API_KEY` from the environment
 * that OpenCode inherits, and would send the user's OpenAI key to Azure. A keyless endpoint, such as
 * one with an Entra ID `Authorization` header, keeps the OpenAI-compatible adapter.
 */
function isAzureOpenAiV1(provider: CustomProviderConfig): boolean {
  const url = URL.parse(provider.baseUrl);
  return (
    Boolean(provider.apiKey) &&
    url?.protocol === "https:" &&
    (url.hostname.endsWith(".openai.azure.com") || url.hostname.endsWith(".services.ai.azure.com")) &&
    (url.pathname === "/openai/v1" || url.pathname === "/openai/v1/")
  );
}

function providerEntry(provider: CustomProviderConfig): OpenCodeProviderEntry {
  const anthropic = anthropicBaseUrl(provider.baseUrl);
  return {
    npm: anthropic ? OPENCODE_ANTHROPIC_NPM : isAzureOpenAiV1(provider) ? OPENCODE_OPENAI_NPM : OPENCODE_COMPATIBLE_NPM,
    name: provider.name,
    options: {
      baseURL: anthropic ?? provider.baseUrl,
      // An absent key and an empty key are different things to an HTTP client: an empty `apiKey`
      // would be sent as a blank Authorization header, which a keyless local endpoint may reject
      // outright. The spread keeps the key out of the object rather than setting it to undefined.
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.headers.length > 0
        ? { headers: Object.fromEntries(provider.headers.map((header) => [header.name, header.value])) }
        : {}),
    },
    models: Object.fromEntries(provider.models.map((model) => [model.id, modelEntry(model)])),
  };
}

function modelEntry(model: CustomProviderModel): OpenCodeModelEntry {
  return model.contextWindow === undefined
    ? { name: model.name }
    : { name: model.name, limit: { context: model.contextWindow, output: 0 } };
}

/**
 * The `provider` block, or null when there is nothing to say. A provider with no models is dropped:
 * OpenCode would advertise the provider and no model, which reads to the user as a broken endpoint
 * rather than an empty one.
 */
function customProviderEntries(
  providers: readonly CustomProviderConfig[],
): Readonly<Record<string, OpenCodeProviderEntry>> | null {
  const usable = providers.filter((provider) => provider.models.length > 0);
  if (usable.length === 0) return null;
  return Object.fromEntries(usable.map((provider) => [provider.id, providerEntry(provider)]));
}

/**
 * Merges the custom providers and the stored key into a base layer. Providers only ever land under
 * the `provider` key, so no provider id can reach a sibling setting: an endpoint named `permission`
 * is a provider named `permission`, not a permission rule. The custom entries come last: an
 * endpoint saved as `opencode-go` replaces that built-in provider, so the stored key must not drop
 * its URL and models.
 */
function mergeOpenCodeConfig(
  base: OpenCodeConfigBase,
  providers: readonly CustomProviderConfig[],
  apiKey: string | null,
): OpenCodeConfig | null {
  const entries = {
    ...(apiKey ? Object.fromEntries(OPENCODE_KEY_PROVIDERS.map((id) => [id, { options: { apiKey } }])) : {}),
    ...customProviderEntries(providers),
  };
  if (Object.keys(entries).length === 0) return Object.keys(base).length > 0 ? { ...base } : null;
  return { ...base, provider: entries };
}

/**
 * The spawn environment for one OpenCode client. Returns `{}` when there is nothing to configure, so
 * a build with no custom providers, no stored key and no base layer spawns exactly as it did before
 * this existed. With no stored key, the user's own `opencode auth login` keys stay in use.
 */
export function openCodeConfigEnv(
  base: OpenCodeConfigBase,
  source: CustomProviderSource,
  apiKey: string | null,
): Record<string, string> {
  const config = mergeOpenCodeConfig(base, source(), apiKey);
  return config ? { [OPENCODE_CONFIG_ENV]: JSON.stringify(config) } : {};
}

/** OpenCode's own providers, by the names that OpenCode 1 showed (models.dev). */
const OPENCODE_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
};

/**
 * A model name with the provider's name before the `/`, as OpenCode 1 sent it.
 *
 * OpenCode 1.19.3 named a model `OpenCode/Big Pickle` or `My Lab/Lab Model`; OpenCode 2.1.1 sends the
 * provider id, `opencode/Big Pickle` and `mylab/Lab Model`. The model picker groups by that part,
 * so a custom endpoint showed its id and not the name the user gave it.
 */
export function openCodeModelName(id: string, name: string, source: CustomProviderSource): string {
  const separator = id.indexOf("/");
  if (separator <= 0) return name;
  const providerId = id.slice(0, separator);
  if (!name.startsWith(`${providerId}/`)) return name;
  const providerName =
    source().find((provider) => provider.id === providerId)?.name ?? OPENCODE_PROVIDER_NAMES[providerId];
  return providerName ? `${providerName}${name.slice(providerId.length)}` : name;
}

/**
 * What to tell the user when OpenCode will not start a session.
 *
 * With a custom endpoint configured, the Go key is usually the wrong advice: OpenCode reports "not
 * signed in" for a refused key or an unreachable base URL just as it does for an empty catalog, and
 * the endpoint brings its own credentials.
 */
export function openCodeSignInMessage(customProviderCount: number): string {
  if (customProviderCount === 0) return OPENCODE_GO_ADVICE;
  return `OpenCode could not start a session. Check your custom provider's base URL and API key, or add an OpenCode Go key if you also use OpenCode's own models.`;
}
