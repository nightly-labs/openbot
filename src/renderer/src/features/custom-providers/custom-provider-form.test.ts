import { describe, expect, it } from "vitest";
import {
  type CustomProviderDraft,
  customProviderValue,
  emptyCustomProviderDraft,
  hasCustomProviderError,
  validateCustomProvider,
} from "./custom-provider-form";

function draft(overrides: Partial<CustomProviderDraft> = {}): CustomProviderDraft {
  return {
    providerId: "my-provider",
    displayName: "My Provider",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    models: [{ id: "qwen3-coder", name: "Qwen3 Coder" }],
    headers: [{ name: "", value: "" }],
    ...overrides,
  };
}

describe("validateCustomProvider", () => {
  it("accepts a local endpoint with no API key", () => {
    expect(hasCustomProviderError(validateCustomProvider(draft()))).toBe(false);
  });

  it("refuses a provider ID that is not a usable OpenCode config key", () => {
    expect(validateCustomProvider(draft({ providerId: "My Provider" })).providerId).toBeTruthy();
    expect(validateCustomProvider(draft({ providerId: "-leading" })).providerId).toBeTruthy();
    expect(validateCustomProvider(draft({ providerId: "" })).providerId).toBeTruthy();
    expect(validateCustomProvider(draft({ providerId: "my_provider2" })).providerId).toBeUndefined();
  });

  it("refuses a provider ID that shadows a built-in provider", () => {
    expect(validateCustomProvider(draft({ providerId: "opencode" })).providerId).toContain("opencode");
    expect(validateCustomProvider(draft({ providerId: "claude" })).providerId).toBeTruthy();
  });

  it("requires an http or https base URL and allows a plain local one", () => {
    expect(validateCustomProvider(draft({ baseUrl: "" })).baseUrl).toBeTruthy();
    expect(validateCustomProvider(draft({ baseUrl: "127.0.0.1:11434" })).baseUrl).toBeTruthy();
    expect(validateCustomProvider(draft({ baseUrl: "file:///models" })).baseUrl).toBeTruthy();
    expect(validateCustomProvider(draft({ baseUrl: "http://localhost:1234/v1" })).baseUrl).toBeUndefined();
    expect(validateCustomProvider(draft({ baseUrl: "https://api.example.com/v1" })).baseUrl).toBeUndefined();
  });

  // Only the key and the headers are encrypted, so a credential in the URL would be stored and shown
  // as plain text.
  it("refuses a base URL that carries a username or a password", () => {
    expect(validateCustomProvider(draft({ baseUrl: "https://user:password@api.example.com/v1" })).baseUrl).toBe(
      "Put the credential in a header, not in the URL.",
    );
    expect(validateCustomProvider(draft({ baseUrl: "https://user@api.example.com/v1" })).baseUrl).toBe(
      "Put the credential in a header, not in the URL.",
    );
  });

  it("requires at least one model and rejects a duplicate model ID", () => {
    expect(validateCustomProvider(draft({ models: [{ id: "", name: "" }] })).models).toBeTruthy();
    const duplicate = validateCustomProvider(
      draft({
        models: [
          { id: "qwen", name: "Qwen" },
          { id: "qwen", name: "Qwen again" },
        ],
      }),
    );
    expect(duplicate.modelRows[0]).toBeUndefined();
    expect(duplicate.modelRows[1]).toContain("qwen");
  });

  // A model id that survives this form but fails `isAgentModel` empties the whole picker rather than
  // hiding one row, because both list decoders fail closed on the array.
  it("rejects a model ID that the agent-model contract would refuse once prefixed", () => {
    const spaced = validateCustomProvider(draft({ models: [{ id: "qwen 3", name: "Qwen" }] }));
    expect(spaced.modelRows[0]).toBeTruthy();
    const quoted = validateCustomProvider(draft({ models: [{ id: 'qwen"3', name: "Qwen" }] }));
    expect(quoted.modelRows[0]).toBeTruthy();
    const long = validateCustomProvider(draft({ models: [{ id: "q".repeat(200), name: "Qwen" }] }));
    expect(long.modelRows[0]).toBeTruthy();
    const allowed = validateCustomProvider(draft({ models: [{ id: "qwen3-coder:30b", name: "Qwen" }] }));
    expect(allowed.modelRows[0]).toBeUndefined();
  });

  it("ignores a blank repeatable row but reports a half-filled one", () => {
    const blank = validateCustomProvider(draft({ headers: [{ name: "", value: "" }] }));
    expect(blank.headerRows[0]).toBeUndefined();
    expect(validateCustomProvider(draft({ models: [{ id: "", name: "" }] })).modelRows[0]).toBeUndefined();
    expect(validateCustomProvider(draft({ models: [{ id: "", name: "Named but no ID" }] })).modelRows[0]).toBeTruthy();
    expect(validateCustomProvider(draft({ headers: [{ name: "X-Tenant", value: "" }] })).headerRows[0]).toBeTruthy();
    expect(validateCustomProvider(draft({ headers: [{ name: "X Tenant", value: "a" }] })).headerRows[0]).toBeTruthy();
    expect(
      validateCustomProvider(draft({ headers: [{ name: "X-Tenant", value: "a" }] })).headerRows[0],
    ).toBeUndefined();
  });

  it("rejects the same header twice however it is cased", () => {
    const errors = validateCustomProvider(
      draft({
        headers: [
          { name: "X-Tenant", value: "one" },
          { name: "x-tenant", value: "two" },
        ],
      }),
    );
    expect(errors.headerRows[1]).toBeTruthy();
  });

  it("reports a blank form without crashing on its placeholder rows", () => {
    const errors = validateCustomProvider(emptyCustomProviderDraft());
    expect(hasCustomProviderError(errors)).toBe(true);
    expect(errors.providerId).toBeTruthy();
    expect(errors.displayName).toBeTruthy();
    expect(errors.baseUrl).toBeTruthy();
    expect(errors.models).toBeTruthy();
    expect(errors.modelRows).toEqual([undefined]);
    expect(errors.headerRows).toEqual([undefined]);
  });
});

describe("customProviderValue", () => {
  it("trims the fields, drops the blank rows and reports a missing key as null", () => {
    expect(
      customProviderValue(
        draft({
          providerId: "  my-provider  ",
          displayName: "  My Provider  ",
          baseUrl: "  http://127.0.0.1:11434/v1  ",
          apiKey: "   ",
          models: [
            { id: " qwen ", name: " Qwen " },
            { id: "", name: "" },
          ],
          headers: [
            { name: " X-Tenant ", value: " studio " },
            { name: "", value: "" },
          ],
        }),
      ),
    ).toEqual({
      // The wire field names, not the form's: this object is the `save` payload.
      id: "my-provider",
      name: "My Provider",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: null,
      models: [{ id: "qwen", name: "Qwen" }],
      headers: [{ name: "X-Tenant", value: "studio" }],
    });
  });

  it("falls back to the model ID when no display name is given", () => {
    expect(customProviderValue(draft({ models: [{ id: "qwen", name: "" }] })).models).toEqual([
      { id: "qwen", name: "qwen" },
    ]);
  });

  it("keeps a key the user did type", () => {
    expect(customProviderValue(draft({ apiKey: " not-a-real-key " })).apiKey).toBe("not-a-real-key");
  });
});
