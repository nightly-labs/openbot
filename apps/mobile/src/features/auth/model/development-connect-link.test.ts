import { createMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { afterEach, describe, expect, it } from "vitest";

import {
  acceptDevelopmentConnectLink,
  isSameMobileConnectTarget,
  readDevelopmentConnectLink,
  takeMobileConnectLink,
} from "./development-connect-link";

const host = { hostId: "host-1", fingerprint: "A".repeat(43) };
const ticket = "t".repeat(43);
const lanLink = createMobileConnectUrl({ apiUrl: "http://192.168.1.20:3100", ticket, host });

describe("development Mobile Connect links", () => {
  afterEach(() => {
    takeMobileConnectLink();
  });

  it("accepts a local-network link only in a development build", () => {
    expect(readDevelopmentConnectLink(lanLink, true)).toBe(lanLink);
    expect(readDevelopmentConnectLink(lanLink, false)).toBeNull();
  });

  it("rejects a link that sends the ticket to a public account service", () => {
    const publicLink = createMobileConnectUrl({ apiUrl: "https://api.openbot.run", ticket, host });
    expect(readDevelopmentConnectLink(publicLink, true)).toBeNull();
    expect(acceptDevelopmentConnectLink(publicLink, true)).toBe(false);
    expect(takeMobileConnectLink()).toBeNull();
  });

  it("queues only accepted links and leaves the rest to the confirmed incoming-link flow", () => {
    expect(acceptDevelopmentConnectLink(lanLink, false)).toBe(false);
    expect(takeMobileConnectLink()).toBeNull();
    expect(acceptDevelopmentConnectLink(lanLink, true)).toBe(true);
    expect(takeMobileConnectLink()).toBe(lanLink);
    expect(takeMobileConnectLink()).toBeNull();
    expect(acceptDevelopmentConnectLink("openbot://agents/1", true)).toBe(false);
  });

  it("matches a stored session of the same account service and desktop", () => {
    const session = { apiUrl: "http://192.168.1.20:3100", host };
    expect(isSameMobileConnectTarget(session, lanLink)).toBe(true);
    expect(isSameMobileConnectTarget({ ...session, apiUrl: "http://192.168.1.20:3200" }, lanLink)).toBe(false);
  });
});
