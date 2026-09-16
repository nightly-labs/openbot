import { googleAuthBlockedMessage, isGoogleBlockUrl } from "./browser-google-auth";

describe("isGoogleBlockUrl", () => {
  it("names the rejected login page", () => {
    expect(isGoogleBlockUrl("https://accounts.google.com/signin/rejected?hl=en")).toBe(true);
  });

  it("names the OAuth block error", () => {
    expect(isGoogleBlockUrl("https://accounts.google.com/o/oauth2/auth?error=disallowed_useragent&hl=en")).toBe(true);
  });

  it("ignores normal login and other sites", () => {
    expect(isGoogleBlockUrl("https://accounts.google.com/ServiceLogin?hl=en")).toBe(false);
    expect(isGoogleBlockUrl("https://www.google.com/")).toBe(false);
    expect(isGoogleBlockUrl("https://example.test/signin/rejected")).toBe(false);
    expect(isGoogleBlockUrl("about:blank")).toBe(false);
  });
});

describe("googleAuthBlockedMessage", () => {
  it("returns guidance on the blocked page", () => {
    expect(googleAuthBlockedMessage("https://accounts.google.com/signin/rejected?hl=en")).toContain(
      "Google blocked this login step.",
    );
  });

  it("returns nothing on normal pages", () => {
    expect(googleAuthBlockedMessage("https://accounts.google.com/ServiceLogin")).toBeNull();
    expect(googleAuthBlockedMessage(undefined)).toBeNull();
  });
});
