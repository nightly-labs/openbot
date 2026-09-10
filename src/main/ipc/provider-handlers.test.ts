// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

// electron cannot be imported outside an Electron process, and the decoder under test runs before
// anything reaches `shell`, so an empty stand-in is enough.
vi.mock("electron", () => ({ shell: {} }));

const { parseProviderApiKeyInput } = await import("./provider-handlers");

/*
 * The only place a renderer-supplied secret enters the main process. Everything this decoder accepts
 * is handed to the operating system's cipher and written to disk, so each rule is a limit on what
 * OpenBot agrees to keep.
 */
describe("parseProviderApiKeyInput", () => {
  it("takes a key for a provider OpenBot knows", () => {
    expect(parseProviderApiKeyInput({ provider: "opencode", key: "  zen-key-value  " })).toEqual({
      provider: "opencode",
      // Trimmed, because a key pasted from a web page carries the newline with it and the CLI
      // rejects it: the user would read "bad key" and blame the account.
      key: "zen-key-value",
    });
  });

  it("refuses a provider it does not know", () => {
    expect(() => parseProviderApiKeyInput({ provider: "chatgpt", key: "zen-key-value" })).toThrow();
    expect(() => parseProviderApiKeyInput({ provider: 7, key: "zen-key-value" })).toThrow();
  });

  it("refuses anything that is not a key", () => {
    expect(() => parseProviderApiKeyInput(null)).toThrowError("A provider key is required.");
    expect(() => parseProviderApiKeyInput("zen-key-value")).toThrowError("A provider key is required.");
    expect(() => parseProviderApiKeyInput({ provider: "opencode" })).toThrowError("A provider key is required.");
    expect(() => parseProviderApiKeyInput({ provider: "opencode", key: 7 })).toThrowError(
      "A provider key is required.",
    );
  });

  it("refuses an empty key instead of storing one", () => {
    // An empty entry would report `configured: true` and spawn the CLI with an empty
    // `OPENCODE_API_KEY`, which lists no model at all -- worse than saving nothing.
    expect(() => parseProviderApiKeyInput({ provider: "opencode", key: "" })).toThrowError(
      "A provider key is required.",
    );
    expect(() => parseProviderApiKeyInput({ provider: "opencode", key: "   " })).toThrowError(
      "A provider key is required.",
    );
  });

  it("refuses a key too long to be one", () => {
    expect(parseProviderApiKeyInput({ provider: "opencode", key: "k".repeat(512) }).key).toHaveLength(512);
    expect(() => parseProviderApiKeyInput({ provider: "opencode", key: "k".repeat(513) })).toThrowError(
      "The provider key is too long.",
    );
  });
});
