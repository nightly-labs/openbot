import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { getByRole } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import {
  isLikelyAutomation,
  LandingAnalytics,
  landingAttribution,
  landingReferrer,
  OPENPANEL_API_URL,
  shouldEnableLandingAnalytics,
} from "../src/lib/analytics";
import { OPENBOT_LINKS } from "../src/lib/landing-links";

describe("landing analytics", () => {
  it("enables only the production landing hostname", () => {
    expect(shouldEnableLandingAnalytics("openbot.run", true)).toBe(true);
    expect(shouldEnableLandingAnalytics("localhost", true)).toBe(false);
    expect(shouldEnableLandingAnalytics("openbot.run", false)).toBe(false);
  });

  it("tracks only allowlisted links and download metadata", () => {
    document.body.innerHTML = `
      <header class="landing-header"><a id="contact" href="${OPENBOT_LINKS.contact}">Contact</a></header>
      <section class="landing-download"><a id="mac" href="/download/macos">Download</a></section>
      <a id="private" href="https://private.example/secret">Private</a>
    `;
    const client = {
      setGlobalProperties: vi.fn(),
      track: vi.fn(),
      trackScreenView: vi.fn(),
    };
    const createClient = vi.fn((_options: unknown) => client);
    const analytics = new LandingAnalytics(createClient, true);
    const cleanup = analytics.start(document, "openbot.run");

    clickWithoutNavigation("#contact");
    clickWithoutNavigation("#mac");
    clickWithoutNavigation("#private");
    cleanup();

    expect(createClient).toHaveBeenCalledWith({
      apiUrl: OPENPANEL_API_URL,
      clientId: expect.any(String),
      trackScreenViews: false,
      trackOutgoingLinks: false,
      trackAttributes: false,
      sessionReplay: { enabled: false },
    });
    expect(createClient.mock.calls[0]?.[0]).not.toHaveProperty("clientSecret");
    expect(client.setGlobalProperties).toHaveBeenCalledWith({
      __referrer: "",
      surface: "landing",
      environment: "production",
      event_schema_version: 7,
    });
    expect(client.trackScreenView).toHaveBeenCalledOnce();
    expect(client.trackScreenView).toHaveBeenCalledWith("/");
    expect(client.track).toHaveBeenNthCalledWith(1, "landing_viewed", {});
    expect(client.track).toHaveBeenNthCalledWith(2, "landing_link_clicked", {
      destination: "contact",
      placement: "header",
    });
    expect(client.track).toHaveBeenNthCalledWith(3, "landing_download_clicked", {
      platform: "macos",
      placement: "download_section",
    });
    expect(client.track).toHaveBeenCalledTimes(3);
  });

  it("does not create a client outside production", () => {
    const createClient = vi.fn();
    const analytics = new LandingAnalytics(createClient, false);
    analytics.start(document, "openbot.run");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("tracks the invitation page anonymously and removes its click listener", () => {
    document.body.innerHTML = `
      <a id="open" href="openbot://join?invite=private">Open app</a>
      <a id="download" href="/download/macos">Download</a>
    `;
    const client = { setGlobalProperties: vi.fn(), track: vi.fn(), trackScreenView: vi.fn() };
    const analytics = new LandingAnalytics(() => client, true);
    const cleanup = analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "macos" });

    document.querySelector<HTMLElement>("#open")?.click();
    document.querySelector<HTMLElement>("#download")?.click();
    cleanup();
    document.querySelector<HTMLElement>("#open")?.click();

    expect(client.track).toHaveBeenNthCalledWith(1, "join_page_action", { action: "view", valid_invite: true });
    expect(client.track).toHaveBeenNthCalledWith(2, "join_page_action", { action: "open_app" });
    expect(client.track).toHaveBeenNthCalledWith(3, "join_page_action", {
      action: "download",
      platform: "macos",
    });
    expect(client.track).toHaveBeenCalledTimes(3);
    expect(client.trackScreenView).toHaveBeenCalledOnce();
    expect(client.trackScreenView).toHaveBeenCalledWith("/join");
    expect(JSON.stringify(client.track.mock.calls)).not.toContain("profileId");
    expect(JSON.stringify(client.track.mock.calls)).not.toContain("private");
  });

  it("replaces an existing document listener instead of double tracking clicks", () => {
    document.body.innerHTML = '<a id="open" href="openbot://join">Open app</a>';
    const client = { setGlobalProperties: vi.fn(), track: vi.fn(), trackScreenView: vi.fn() };
    const analytics = new LandingAnalytics(() => client, true);
    analytics.startJoin(document, "openbot.run", { validInvite: false, platform: "windows" });
    const cleanup = analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "windows" });

    document.querySelector<HTMLElement>("#open")?.click();
    cleanup();

    expect(client.track.mock.calls.filter(([name]) => name === "join_page_action")).toEqual([
      ["join_page_action", { action: "view", valid_invite: false }],
      ["join_page_action", { action: "view", valid_invite: true }],
      ["join_page_action", { action: "open_app" }],
    ]);
    expect(client.trackScreenView).toHaveBeenCalledOnce();

    cleanup();
    const remountCleanup = analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "windows" });
    expect(client.trackScreenView).toHaveBeenCalledTimes(2);
    expect(client.trackScreenView).toHaveBeenLastCalledWith("/join");
    remountCleanup();
  });

  it("sends a safe anonymous screen view again after the invitation route remounts", async () => {
    window.history.replaceState({}, "", "/join?invite=private-token#secret");
    const requests: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const analytics = new LandingAnalytics(undefined, true);
      const cleanup = analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "macos" });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      cleanup();
      const remountCleanup = analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "macos" });
      remountCleanup();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
      const screenViewRequests = requests.filter(
        (candidate) =>
          isDynamicRecord(candidate) && isDynamicRecord(candidate.payload) && candidate.payload.name === "screen_view",
      );
      expect(screenViewRequests).toHaveLength(2);
      const screenViewRequest = screenViewRequests[0];
      const payload =
        isDynamicRecord(screenViewRequest) && isDynamicRecord(screenViewRequest.payload)
          ? screenViewRequest.payload
          : null;
      expect(payload).toMatchObject({ properties: expect.objectContaining({ __path: "/join" }) });
      expect(payload).not.toHaveProperty("profileId");
      expect(JSON.stringify(requests)).not.toContain("private-token");
      expect(JSON.stringify(requests)).not.toContain("#secret");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("derives only coarse acquisition sources and ignores automation", () => {
    window.history.replaceState({}, "", "/?utm_source=github");
    expect(landingAttribution(document, "openbot.run")).toMatchObject({
      acquisition_source: "github",
      source_platform: "github",
    });
    expect(isLikelyAutomation({ userAgent: "HeadlessChrome", webdriver: false })).toBe(true);
    expect(isLikelyAutomation({ userAgent: "Mozilla/5.0", webdriver: false })).toBe(false);
  });

  it.each([
    ["https://l.instagram.com/private?token=secret#hidden", "https://l.instagram.com/"],
    ["https://user:password@t.co:8443/private?token=secret#hidden", "https://t.co/"],
    ["http://www.twitter.com/post/123", "https://www.twitter.com/"],
    ["https://openbot.run/join?invite=secret", ""],
    ["https://docs.openbot.run/private", ""],
    ["https://openbot.run.example.org/path", "https://openbot.run.example.org/"],
    ["", ""],
    ["invalid", ""],
    ["file:///private/secret", ""],
    ["javascript:alert(1)", ""],
  ])("keeps only an external web domain from %s", (referrer, expected) => {
    expect(landingReferrer(referrer, "openbot.run")).toBe(expected);
  });

  it.each([
    ["instagram", "https://github.com/", "instagram", "social"],
    [" X ", "https://google.com/", "twitter", "social"],
    ["", "https://t.co/post", "twitter", "social"],
    ["", "https://l.instagram.com/", "instagram", "social"],
    ["", "https://www.reddit.com/", "reddit", "social"],
    ["", "https://github.com/", "github", "github"],
    ["", "https://www.google.com/", "google", "search"],
    ["secret-campaign", "https://www.reddit.com/", "reddit", "social"],
    ["secret-campaign", "", "unknown", "other"],
    ["", "", "unknown", "direct"],
    ["", "https://openbot.run/", "unknown", "direct"],
    ["", "https://twitter.com.evil.example/", "unknown", "other"],
    ["", "https://example.com/twitter?utm_source=instagram", "unknown", "other"],
  ])("classifies tag %s and referrer %s without sending raw campaign data", (tag, referrer, platform, category) => {
    window.history.replaceState({}, "", `/?utm_source=${encodeURIComponent(tag)}`);
    const referrerMock = vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
    try {
      expect(landingAttribution(document, "openbot.run")).toEqual({
        source_platform: platform,
        acquisition_source: category,
        __referrer: landingReferrer(referrer, "openbot.run"),
      });
    } finally {
      referrerMock.mockRestore();
    }
  });

  it.each(["landing", "join"])("sends domain-only attribution on the %s page", async (page) => {
    const referrer = vi
      .spyOn(document, "referrer", "get")
      .mockReturnValue("https://l.instagram.com/private?token=referrer-secret#hidden");
    const requests: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
    let cleanup = () => {};
    try {
      const analytics = new LandingAnalytics(undefined, true);
      cleanup =
        page === "join"
          ? analytics.startJoin(document, "openbot.run", { validInvite: true, platform: "macos" })
          : analytics.start(document, "openbot.run");
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      document.body.innerHTML =
        '<section class="landing-download"><a href="/download/macos">Download macOS</a></section>';
      const download = getByRole(document.body, "link", { name: "Download macOS" });
      download.addEventListener("click", (event) => event.preventDefault(), { once: true });
      download.click();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(requests[2]).toMatchObject({
        payload: {
          name: page === "join" ? "join_page_action" : "landing_download_clicked",
          properties: {
            platform: "macos",
            ...(page === "join" ? { action: "download" } : { placement: "download_section" }),
          },
        },
      });
      for (const request of requests) {
        expect(request).toMatchObject({
          payload: {
            properties: {
              __referrer: "https://l.instagram.com/",
              acquisition_source: "social",
              source_platform: "instagram",
            },
          },
        });
      }
      expect(JSON.stringify(requests)).not.toContain("private");
      expect(JSON.stringify(requests)).not.toContain("referrer-secret");
      expect(JSON.stringify(requests)).not.toContain("hidden");
    } finally {
      cleanup();
      referrer.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("does not let initialization failures escape", () => {
    const analytics = new LandingAnalytics(() => {
      throw new Error("unavailable");
    }, true);

    expect(() => analytics.start(document, "openbot.run")).not.toThrow();
  });
});

function clickWithoutNavigation(selector: string): void {
  const link = document.querySelector<HTMLAnchorElement>(selector);
  if (!link) throw new Error(`Missing test link: ${selector}`);
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  link.click();
}
