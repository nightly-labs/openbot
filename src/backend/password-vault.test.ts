// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type VaultAutofill, websiteMatchesOrigin } from "./password-vault";

// A login filled on the wrong site hands the password to that site, so every case that must not
// match is listed.
describe("websiteMatchesOrigin", () => {
  const matches = (url: string, origin: string, autofill: VaultAutofill = "anywhere") =>
    websiteMatchesOrigin({ url, autofill }, origin);

  it.each([
    ["https://github.com", "https://github.com"],
    ["github.com", "https://github.com"],
    ["https://github.com/login", "https://gist.github.com"],
    ["https://www.github.com", "https://github.com"],
    ["https://accounts.example.co.uk", "https://example.co.uk"],
  ])("fills %s on %s", (url, origin) => {
    expect(matches(url, origin)).toBe(true);
  });

  it.each([
    ["https://github.com", "http://github.com"],
    ["https://github.com", "https://github.com.evil.example"],
    ["https://github.com", "https://evilgithub.com"],
    ["https://one.co.uk", "https://two.co.uk"],
    ["https://user.github.io", "https://other.github.io"],
    ["https://192.168.1.10", "https://192.168.1.11"],
    ["not a url", "https://github.com"],
  ])("does not fill %s on %s", (url, origin) => {
    expect(matches(url, origin)).toBe(false);
  });

  it("fills an exact-domain login only on the same host and port", () => {
    expect(matches("https://github.com", "https://github.com", "exact")).toBe(true);
    expect(matches("https://github.com", "https://gist.github.com", "exact")).toBe(false);
    expect(matches("https://github.com:8443", "https://github.com", "exact")).toBe(false);
  });

  it("never fills a login that 1Password must never fill", () => {
    expect(matches("https://github.com", "https://github.com", "never")).toBe(false);
  });
});
