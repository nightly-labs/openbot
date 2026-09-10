// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

// electron cannot be imported outside an Electron process, and nothing in this module is called
// while it loads, so an empty stand-in is enough to reach the destination table.
vi.mock("electron", () => ({ app: {}, dialog: {}, shell: {} }));

const { EXTERNAL_DESTINATIONS } = await import("./app-handlers");
const { parseExternalDestination } = await import("./app-inputs");

describe("external destinations", () => {
  it("sends the OpenCode key request to the OpenCode sign-in page", () => {
    // The dialog says the key is optional and the free models need no account. A wrong address here
    // asks the user for a paid credential on a page OpenBot did not choose.
    expect(EXTERNAL_DESTINATIONS["opencode-auth"]).toBe("https://opencode.ai/auth");
    expect(EXTERNAL_DESTINATIONS["opencode-install"]).toBe("https://opencode.ai/docs/");
  });

  it("opens no address the renderer invents", () => {
    expect(parseExternalDestination("opencode-auth")).toBe("opencode-auth");
    expect(() => parseExternalDestination("https://opencode.ai/auth")).toThrowError("Unknown external destination.");
    expect(() => parseExternalDestination("opencode-login")).toThrowError("Unknown external destination.");
  });
});
