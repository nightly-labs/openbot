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

/** The options block OpenCode hands to its bundled OpenAI-compatible adapter. */
export interface OpenCodeProviderOptions {
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** One entry under OpenCode's own `provider` key, keyed there by the endpoint's id. */
export interface OpenCodeProviderEntry {
  readonly npm: string;
  readonly name: string;
  readonly options: OpenCodeProviderOptions;
  readonly models: Readonly<Record<string, { readonly name: string }>>;
}

/** One rule per tool pattern, which is all OpenBot sends under `permission`. */
export type OpenCodePermissionLayer = Readonly<Record<string, "allow" | "ask" | "deny">>;

/** The config layer OpenBot owns on `OPENCODE_CONFIG_CONTENT`. The user's own file is untouched. */
export interface OpenCodeConfig {
  readonly permission?: OpenCodePermissionLayer;
  readonly provider?: Readonly<Record<string, OpenCodeProviderEntry>>;
}

/** What a caller starts from: every layer except the providers this module adds. */
export type OpenCodeConfigBase = Omit<OpenCodeConfig, "provider">;

/**
 * Profile generation runs a throwaway OpenCode session for a one-shot prompt, so it must not be able
 * to touch the computer. This layer is the reason the custom-provider config has to merge rather than
 * replace: both live under the same environment variable.
 */
export const OPENCODE_PROFILE_CONFIG: OpenCodeConfigBase = { permission: { "*": "deny" } };

export const OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

/** What a plain OpenCode user needs, now that the free models run without an account at all. */
const OPENCODE_ZEN_ADVICE = "OpenCode listed no model. Add an OpenCode Zen key to continue.";

/** The provider adapter OpenCode bundles for an OpenAI-compatible endpoint. */
export const OPENCODE_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

function providerEntry(provider: CustomProviderConfig): OpenCodeProviderEntry {
  return {
    npm: OPENCODE_COMPATIBLE_NPM,
    name: provider.name,
    options: {
      baseURL: provider.baseUrl,
      // An absent key and an empty key are different things to an HTTP client: an empty `apiKey`
      // would be sent as a blank Authorization header, which a keyless local endpoint may reject
      // outright. The spread keeps the key out of the object rather than setting it to undefined.
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.headers.length > 0
        ? { headers: Object.fromEntries(provider.headers.map((header) => [header.name, header.value])) }
        : {}),
    },
    models: Object.fromEntries(provider.models.map((model) => [model.id, { name: model.name }])),
  };
}

/**
 * The `provider` block, or null when there is nothing to say. A provider with no models is dropped:
 * OpenCode would advertise the provider and no model, which reads to the user as a broken endpoint
 * rather than an empty one.
 */
export function customProviderEntries(
  providers: readonly CustomProviderConfig[],
): Readonly<Record<string, OpenCodeProviderEntry>> | null {
  const usable = providers.filter((provider) => provider.models.length > 0);
  if (usable.length === 0) return null;
  return Object.fromEntries(usable.map((provider) => [provider.id, providerEntry(provider)]));
}

/**
 * Merges the custom providers into a base layer. Providers only ever land under the `provider` key,
 * so no provider id can reach a sibling setting: an endpoint named `permission` is a provider named
 * `permission`, not a permission rule.
 */
export function mergeOpenCodeConfig(
  base: OpenCodeConfigBase,
  providers: readonly CustomProviderConfig[],
): OpenCodeConfig | null {
  const entries = customProviderEntries(providers);
  if (!entries) return Object.keys(base).length > 0 ? { ...base } : null;
  return { ...base, provider: entries };
}

/**
 * The spawn environment for one OpenCode client. Returns `{}` when there is nothing to configure, so
 * a build with no custom providers and no base layer spawns exactly as it did before this existed.
 */
export function openCodeConfigEnv(base: OpenCodeConfigBase, source: CustomProviderSource): Record<string, string> {
  const config = mergeOpenCodeConfig(base, source());
  return config ? { [OPENCODE_CONFIG_ENV]: JSON.stringify(config) } : {};
}

/**
 * What to tell the user when OpenCode will not start a session.
 *
 * With a custom endpoint configured, the Zen key is usually the wrong advice: OpenCode reports "not
 * signed in" for a refused key or an unreachable base URL just as it does for an empty catalog, and
 * the endpoint brings its own credentials.
 */
export function openCodeSignInMessage(customProviderCount: number): string {
  if (customProviderCount === 0) return OPENCODE_ZEN_ADVICE;
  return `OpenCode could not start a session. Check your custom provider's base URL and API key, or add an OpenCode Zen key if you also use OpenCode's own models.`;
}
