import { describe, expect, it } from "vitest";
import {
  decodeWhatsAppGroupsReply,
  decodeWhatsAppLinkStateReply,
  decodeWhatsAppOverviewReply,
} from "./messaging-decoding";

const connection = {
  workspaceId: "48600100200",
  platform: "whatsapp",
  enabled: true,
  state: "connected",
  workspaceName: "Ana (+•••••••0200)",
  botUserId: "48600100200",
  missingScopes: [],
  retryAt: null,
  credentials: "saved",
  orchestratorAgentId: null,
};
const account = {
  workspaceId: "48600100200",
  ownNumber: false,
  allowedSenders: [
    { id: "48600100300", kind: "contact", name: "Ben" },
    { id: "120363000000000000@g.us", kind: "group", name: "Team" },
  ],
  pendingRequests: [{ code: "ABC234", senderId: "48600100400", name: "Cara", expiresAt: "2026-10-30T12:00:00.000Z" }],
};
const overview = { connections: [connection], accounts: [account] };
const linkState = { status: "waiting", qr: "2@abc,def", code: null, workspaceId: null, error: null };

describe("WhatsApp replies from main", () => {
  it("accepts an overview, a link state and a group list", () => {
    expect(decodeWhatsAppOverviewReply(overview)).toEqual(overview);
    expect(decodeWhatsAppLinkStateReply(linkState)).toEqual(linkState);
    expect(decodeWhatsAppLinkStateReply({ ...linkState, qr: null, code: "ABCD1234" })).toMatchObject({
      code: "ABCD1234",
    });
    const groups = { groups: [{ id: "120363000000000000@g.us", name: "Team" }] };
    expect(decodeWhatsAppGroupsReply(groups)).toEqual(groups);
  });

  it.each([
    { ...overview, accounts: undefined },
    { ...overview, connections: [{ ...connection, platform: "signal" }] },
    { ...overview, accounts: [{ ...account, ownNumber: "yes" }] },
    { ...overview, accounts: [{ ...account, allowedSenders: [{ id: "+48 600", kind: "contact", name: "Ben" }] }] },
    { ...overview, accounts: [{ ...account, allowedSenders: [{ id: "48600100300", kind: "group", name: "Ben" }] }] },
    { ...overview, accounts: [{ ...account, allowedSenders: [{ id: "48600100300", kind: "channel", name: "Ben" }] }] },
    { ...overview, accounts: [{ ...account, pendingRequests: [{ ...account.pendingRequests[0], code: "abc" }] }] },
    {
      ...overview,
      accounts: [{ ...account, pendingRequests: Array.from({ length: 4 }, () => account.pendingRequests[0]) }],
    },
    null,
  ])("rejects a malformed overview %#", (value) => {
    expect(() => decodeWhatsAppOverviewReply(value)).toThrow();
  });

  it.each([
    { ...linkState, status: "done" },
    { ...linkState, qr: "x".repeat(1_025) },
    { ...linkState, code: "abcd1234" },
    { ...linkState, error: "lost" },
    { ...linkState, workspaceId: "" },
    "waiting",
  ])("rejects a malformed link state %#", (value) => {
    expect(() => decodeWhatsAppLinkStateReply(value)).toThrow();
  });

  it.each([
    { groups: [{ id: "48600100300@s.whatsapp.net", name: "Ben" }] },
    { groups: [{ id: "120363000000000000@g.us", name: "x".repeat(257) }] },
    { groups: Array.from({ length: 501 }, () => ({ id: "120363000000000000@g.us", name: "Team" })) },
    {},
  ])("rejects a malformed group list %#", (value) => {
    expect(() => decodeWhatsAppGroupsReply(value)).toThrow();
  });
});
