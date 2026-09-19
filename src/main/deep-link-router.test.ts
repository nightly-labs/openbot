import { createInviteUrl } from "@openbot/contracts/invite-links";
import { createOpenBotPluginUrl, createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { describe, expect, it } from "vitest";
import { findDeepLink, parseDeepLink } from "./deep-link-router";

const invitePayload = {
  apiUrl: "https://studio-mac-k7m4q2pz-host.openbot.run/",
  serverId: "00000000-0000-4000-8000-000000000000",
  fingerprint: "a".repeat(43),
  token: "b".repeat(43),
};
const inviteUrl = createInviteUrl(invitePayload);

describe("the deep link router", () => {
  it("still reads an invitation as an invitation", () => {
    expect(parseDeepLink(inviteUrl)).toEqual({ kind: "invite", url: inviteUrl });
  });

  it("reads a plugin link in both of its forms", () => {
    expect(parseDeepLink(createOpenBotPluginUrl("aave"))).toEqual({ kind: "plugin", slug: "aave" });
    expect(parseDeepLink(createPluginShareUrl("aave"))).toEqual({ kind: "plugin", slug: "aave" });
  });

  it.each([
    ["an unknown openbot:// host", "openbot://something-else/aave"],
    ["a bare scheme", "openbot://"],
    ["an ordinary web page", "https://openbot.run/news"],
    ["a command-line argument", "--enable-logging"],
    ["an empty string", ""],
  ])("gives nothing for %s", (_reason, value) => {
    expect(parseDeepLink(value)).toBeNull();
  });

  /* The invite parser owns `join`, so a plugin-shaped path can never reach the plugin kind with an
     invitation's token in it. */
  it("never reads an invitation as a plugin", () => {
    expect(parseDeepLink(inviteUrl)?.kind).toBe("invite");
    expect(parseDeepLink("openbot://join")).toBeNull();
  });

  it("refuses a local development invitation unless that is allowed", () => {
    const localInvite = createInviteUrl(
      { ...invitePayload, apiUrl: "http://localhost:43123/" },
      { allowLocalDevelopmentApiUrl: true },
    );
    expect(parseDeepLink(localInvite)).toBeNull();
    expect(parseDeepLink(localInvite, { allowLocalDevelopmentApiUrl: true })).toEqual({
      kind: "invite",
      url: localInvite,
    });
  });

  describe("findDeepLink", () => {
    it("finds the first link among ordinary arguments", () => {
      expect(findDeepLink(["/path/to/OpenBot", "--enable-logging", createOpenBotPluginUrl("canva")])).toEqual({
        kind: "plugin",
        slug: "canva",
      });
    });

    it("gives nothing when no argument is a link", () => {
      expect(findDeepLink(["/path/to/OpenBot", "--enable-logging"])).toBeNull();
    });
  });
});
