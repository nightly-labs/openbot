import { createInviteUrl, createOpenBotInviteUrl } from "@openbot/contracts/invite-links";
import { createMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { describe, expect, it } from "vitest";
import {
  forgetIncomingLink,
  parseIncomingLink,
  pendingInvitationId,
  readIncomingLink,
  redirectIncomingLink,
} from "./incoming-links";

const payload = {
  apiUrl: "https://api.openbot.run",
  serverId: "11111111-1111-4111-8111-111111111111",
  fingerprint: "f".repeat(43),
  token: "t".repeat(32),
};

function requestId(path: string): string {
  return new URL(path, "https://openbot.run").searchParams.get("request") ?? "";
}

describe("incoming mobile links", () => {
  it.each([createInviteUrl(payload), createOpenBotInviteUrl(payload)])(
    "keeps invitation secrets out of the route",
    (url) => {
      const path = redirectIncomingLink(url);
      expect(path).toMatch(/^\/incoming-link\?request=\d+$/u);
      expect(path).not.toContain(payload.token);
      const id = requestId(path);
      expect(readIncomingLink(id)).toEqual({ kind: "invite", url });
      expect(pendingInvitationId()).toBe(id);
      forgetIncomingLink(id);
      expect(readIncomingLink(id)).toEqual({ kind: "invalid" });
    },
  );

  it("retains an invitation while a Mobile Connect link starts sign-in", () => {
    const id = requestId(redirectIncomingLink(createInviteUrl(payload)));
    const url = createMobileConnectUrl({
      apiUrl: payload.apiUrl,
      ticket: "c".repeat(32),
      host: { hostId: payload.serverId, fingerprint: payload.fingerprint },
    });
    const pairingId = requestId(redirectIncomingLink(url));
    expect(readIncomingLink(pairingId)).toEqual({ kind: "pairing", url });
    forgetIncomingLink(pairingId);
    expect(pendingInvitationId()).toBe(id);
    forgetIncomingLink(id);
  });

  it("opens only a validated plugin page", () => {
    expect(parseIncomingLink("openbot://plugins/my-plugin")).toEqual({
      kind: "plugin",
      url: "https://openbot.run/plugins/my-plugin",
    });
    expect(parseIncomingLink("https://openbot.run/plugins/my-plugin")).toEqual({
      kind: "plugin",
      url: "https://openbot.run/plugins/my-plugin",
    });
  });

  it.each([
    "openbot://join?invite=bad",
    "https://openbot.run.evil.test/join",
    "openbot://plugins/my-plugin?install=1",
    "openbot://mcp-auth?code=secret&state=secret",
    "not a URL",
    `openbot://user:pass@mobile-connect?api=https://api.openbot.run&ticket=${"c".repeat(32)}`,
  ])("rejects unsupported and invalid links without retaining their secrets", (url) => {
    expect(parseIncomingLink(url)).toEqual({ kind: "invalid" });
  });

  it("handles a relative invitation but keeps ordinary internal routes", () => {
    const url = createInviteUrl(payload);
    const path = redirectIncomingLink(url.replace("https://openbot.run", ""));
    expect(readIncomingLink(requestId(path))).toEqual({ kind: "invite", url });
    forgetIncomingLink(requestId(path));
    expect(redirectIncomingLink("/connected")).toBe("/connected");
    expect(redirectIncomingLink("exp://localhost:8081/--/connected")).toBe("exp://localhost:8081/--/connected");
  });

  it("coalesces repeated delivery without copying the bearer token into navigation", () => {
    const first = redirectIncomingLink(createInviteUrl(payload));
    expect(redirectIncomingLink(createInviteUrl(payload))).toBe(first);
    forgetIncomingLink(requestId(first));
    expect(redirectIncomingLink("openbot://")).toBe("/");
  });

  it("bounds retained links and rejects evicted requests", () => {
    const first = requestId(redirectIncomingLink(createInviteUrl(payload)));
    const ids = Array.from({ length: 8 }, (_, index) =>
      requestId(redirectIncomingLink(createInviteUrl({ ...payload, token: String(index).repeat(32) }))),
    );
    expect(readIncomingLink(first)).toEqual({ kind: "invalid" });
    for (const id of ids) forgetIncomingLink(id);
  });
});
