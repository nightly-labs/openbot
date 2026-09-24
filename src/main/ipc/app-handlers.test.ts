// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

// electron cannot be imported outside an Electron process, and nothing in this module is called
// while it loads, so an empty stand-in is enough to reach the destination table.
vi.mock("electron", () => ({ app: {}, dialog: {}, shell: {} }));

const { EXTERNAL_DESTINATIONS } = await import("./app-handlers");
const { parseExternalDestination } = await import("./app-inputs");

describe("external destinations", () => {
  it("sends the host owner to the macOS pane that grants screen recording", () => {
    // A member who is refused a remote screen cannot grant anything: this address is what the host
    // owner opens, and a wrong one leaves the desktop dark with no way to repair it.
    expect(EXTERNAL_DESTINATIONS["mac-screen-recording"]).toBe(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    );
    expect(parseExternalDestination("mac-screen-recording")).toBe("mac-screen-recording");
  });

  it("sends the agent import guide to the Grok Bot export listing", () => {
    // The Import tab tells the user to install this agent. A wrong address installs some other agent
    // with access to their Grok Bot data.
    expect(EXTERNAL_DESTINATIONS["grok-bot-export"]).toBe("https://x.ai/bot/gI0XdhhDYPJeyQaqQBC0O");
    expect(parseExternalDestination("grok-bot-export")).toBe("grok-bot-export");
  });

  it("opens no address the renderer invents", () => {
    expect(parseExternalDestination("opencode-auth")).toBe("opencode-auth");
    expect(() => parseExternalDestination("https://opencode.ai/auth")).toThrowError("Unknown external destination.");
    expect(() => parseExternalDestination("opencode-login")).toThrowError("Unknown external destination.");
  });
});
