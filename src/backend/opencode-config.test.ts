// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type CustomProviderConfig,
  customProviderEntries,
  mergeOpenCodeConfig,
  OPENCODE_COMPATIBLE_NPM,
  OPENCODE_CONFIG_ENV,
  OPENCODE_PROFILE_CONFIG,
  type OpenCodeProviderOptions,
  openCodeConfigEnv,
  openCodeSignInMessage,
} from "./opencode-config";

function provider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: null,
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    headers: [],
    ...overrides,
  };
}

/** The one entry the case describes, so a missing entry fails the case rather than passing it. */
function studioLocalOptions(providers: readonly CustomProviderConfig[]): OpenCodeProviderOptions {
  const entry = customProviderEntries(providers)?.["studio-local"];
  if (!entry) throw new Error("The entry for `studio-local` is missing.");
  return entry.options;
}

/** The shape `opencode models` accepted from OpenCode 1.18.27, listing `studio-local/…`. */
describe("customProviderEntries", () => {
  it("describes the endpoint the way OpenCode's provider config does", () => {
    expect(customProviderEntries([provider({ apiKey: "test-key" })])).toEqual({
      "studio-local": {
        npm: OPENCODE_COMPATIBLE_NPM,
        name: "Studio Local",
        options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "test-key" },
        models: { "qwen3-coder:30b": { name: "Qwen3 Coder 30B" } },
      },
    });
  });

  it("omits the key entirely when the endpoint needs none", () => {
    const options = studioLocalOptions([provider()]);
    // Not `toBeUndefined`: `JSON.stringify` drops an undefined value, so a present-but-undefined key
    // would pass that assertion and still be correct on the wire. The key must not be there at all,
    // because an empty `apiKey` is sent as a blank Authorization header.
    expect("apiKey" in options).toBe(false);
  });

  it("omits the key when it is an empty string", () => {
    expect("apiKey" in studioLocalOptions([provider({ apiKey: "" })])).toBe(false);
  });

  it("turns the header list into an object and omits an empty one", () => {
    const withHeaders = studioLocalOptions([provider({ headers: [{ name: "X-Tenant", value: "studio" }] })]);
    expect(withHeaders.headers).toEqual({ "X-Tenant": "studio" });
    expect("headers" in studioLocalOptions([provider()])).toBe(false);
  });

  it("drops a provider that lists no models", () => {
    expect(customProviderEntries([provider({ models: [] })])).toBeNull();
    expect(Object.keys(customProviderEntries([provider(), provider({ id: "empty", models: [] })]) ?? {})).toEqual([
      "studio-local",
    ]);
  });

  it("keys every provider by its own id", () => {
    const entries = customProviderEntries([provider(), provider({ id: "house-router", name: "House Router" })]);
    expect(Object.keys(entries ?? {})).toEqual(["studio-local", "house-router"]);
  });
});

describe("mergeOpenCodeConfig", () => {
  it("keeps the deny-all permission layer beside the providers", () => {
    const config = mergeOpenCodeConfig(OPENCODE_PROFILE_CONFIG, [provider()]);
    expect(config?.permission).toEqual({ "*": "deny" });
    expect(Object.keys(config?.provider ?? {})).toEqual(["studio-local"]);
  });

  it("cannot let a provider id reach a sibling setting", () => {
    const config = mergeOpenCodeConfig(OPENCODE_PROFILE_CONFIG, [provider({ id: "permission" })]);
    // The endpoint is a provider named `permission`, not a permission rule.
    expect(config?.permission).toEqual({ "*": "deny" });
    expect(config?.provider?.permission).toBeDefined();
  });

  it("returns the base alone when there are no providers", () => {
    expect(mergeOpenCodeConfig(OPENCODE_PROFILE_CONFIG, [])).toEqual({ permission: { "*": "deny" } });
  });

  it("returns null when there is nothing at all to say", () => {
    expect(mergeOpenCodeConfig({}, [])).toBeNull();
  });
});

describe("openCodeConfigEnv", () => {
  it("sets no variable when there is nothing to configure", () => {
    expect(openCodeConfigEnv({}, () => [])).toEqual({});
  });

  it("carries the base layer on its own", () => {
    const env = openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, () => []);
    expect(JSON.parse(env[OPENCODE_CONFIG_ENV] ?? "")).toEqual({ permission: { "*": "deny" } });
  });

  it("round-trips through JSON with no null or undefined key", () => {
    const env = openCodeConfigEnv({}, () => [provider()]);
    const parsed = JSON.parse(env[OPENCODE_CONFIG_ENV] ?? "");
    expect(parsed.provider["studio-local"].options).toEqual({ baseURL: "http://127.0.0.1:11434/v1" });
  });

  it("reads the source at every call, so a later save reaches the next spawn", () => {
    const providers: CustomProviderConfig[] = [];
    const source = () => providers;
    expect(openCodeConfigEnv({}, source)).toEqual({});
    providers.push(provider());
    expect(openCodeConfigEnv({}, source)[OPENCODE_CONFIG_ENV]).toContain("studio-local");
  });
});

describe("openCodeSignInMessage", () => {
  it("sends a plain OpenCode user to the login command", () => {
    expect(openCodeSignInMessage(0)).toContain("opencode auth login");
  });

  it("names the endpoint first when a custom provider is configured", () => {
    const message = openCodeSignInMessage(1);
    expect(message).toContain("base URL");
    expect(message).toContain("API key");
    // The command is still offered, but as the alternative rather than the instruction.
    expect(message.indexOf("base URL")).toBeLessThan(message.indexOf("opencode auth login"));
  });
});
