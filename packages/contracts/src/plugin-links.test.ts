import { describe, expect, it } from "vitest";
import { createInviteUrl } from "./invite-links";
import { createOpenBotPluginUrl, createPluginShareUrl, isPluginUrl, parsePluginUrl } from "./plugin-links";

const invitePayload = {
  apiUrl: "https://studio-mac-k7m4q2pz-host.openbot.run/",
  serverId: "00000000-0000-4000-8000-000000000000",
  fingerprint: "a".repeat(43),
  token: "b".repeat(43),
};

describe("OpenBot plugin links", () => {
  it("builds both forms from a slug", () => {
    expect(createPluginShareUrl("aave")).toBe("https://openbot.run/plugins/aave");
    expect(createOpenBotPluginUrl("aave")).toBe("openbot://plugins/aave");
  });

  it("reads back the slug it wrote, in either form", () => {
    expect(parsePluginUrl(createPluginShareUrl("linear-triage"))).toBe("linear-triage");
    expect(parsePluginUrl(createOpenBotPluginUrl("linear-triage"))).toBe("linear-triage");
  });

  it("refuses to build a link for a slug it would not read back", () => {
    expect(() => createPluginShareUrl("Aave")).toThrow();
    expect(() => createOpenBotPluginUrl("catalog.json")).toThrow();
  });

  it.each([
    ["a foreign origin", "https://evil.example/plugins/aave"],
    ["a host that only ends in the real one", "https://openbot.run.example.com/plugins/aave"],
    ["the lookalike host the app once used", "https://openbot.app/plugins/aave"],
    ["http", "http://openbot.run/plugins/aave"],
    ["another path", "https://openbot.run/other/aave"],
    ["no slug", "https://openbot.run/plugins/"],
    ["a second path segment", "https://openbot.run/plugins/aave/install"],
    ["a trailing slash", "https://openbot.run/plugins/aave/"],
    ["a query", "https://openbot.run/plugins/aave?install=1"],
    ["a hash", "https://openbot.run/plugins/aave#install"],
    ["a port", "https://openbot.run:444/plugins/aave"],
    ["a user name", "https://user@openbot.run/plugins/aave"],
    ["an upper-case slug", "https://openbot.run/plugins/Aave"],
    ["a slug with a dot", "https://openbot.run/plugins/catalog.json"],
    ["an over-long slug", `https://openbot.run/plugins/${"a".repeat(64)}`],
    ["another custom-scheme host", "openbot://plugin/aave"],
    ["a custom-scheme link with a query", "openbot://plugins/aave?install=1"],
    ["a custom-scheme link with no slug", "openbot://plugins"],
    ["nonsense", "not a url"],
  ])("refuses %s", (_reason, value) => {
    expect(() => parsePluginUrl(value)).toThrow();
    expect(isPluginUrl(value)).toBe(false);
  });

  /* The router asks the invite parser first, but the plugin parser must not claim an invite even on
     its own. `join` is the invite's host and `/join` is its path. */
  it("refuses an invitation link", () => {
    expect(isPluginUrl(createInviteUrl(invitePayload))).toBe(false);
    expect(isPluginUrl("openbot://join")).toBe(false);
  });
});
