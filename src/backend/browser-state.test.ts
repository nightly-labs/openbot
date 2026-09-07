import { describe, expect, it } from "vitest";
import { persistentBrowserUrl, reownStoredBrowserTab, storedBrowserTab, X_LANDING_URL } from "./browser-state";

describe("persistentBrowserUrl", () => {
  it("restarts volatile X onboarding routes from the stable login entry", () => {
    expect(persistentBrowserUrl("https://x.com/i/jf/onboarding/web#/s/signup_phone/r-z4wf9")).toBe(X_LANDING_URL);
    expect(persistentBrowserUrl("https://x.com/i/jf/onboarding/web?flow=expired#/s/knowledge_check/r-old")).toBe(
      X_LANDING_URL,
    );
  });

  it("keeps ordinary browser URLs and hashes", () => {
    expect(persistentBrowserUrl("https://x.com/home")).toBe("https://x.com/home");
    expect(persistentBrowserUrl("https://example.com/app#/saved-view")).toBe("https://example.com/app#/saved-view");
  });
});

describe("storedBrowserTab", () => {
  const uuid = "6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";

  it("reads a tab a pre-rename release wrote without renaming anybody", () => {
    // The file on disk is whatever the last build wrote, and a released one spelled the owner key
    // `ownerBotId`. Rejecting it loses every tab the user had open. The id beside it is left as found:
    // whether that agent was renamed is a question only the roster can answer.
    expect(
      storedBrowserTab({
        id: "tab-1",
        url: "https://example.com/app",
        ownerThreadId: `openbot-thread-bot-${uuid}`,
        ownerBotId: `bot-${uuid}`,
      }),
    ).toEqual({
      id: "tab-1",
      url: "https://example.com/app",
      ownerThreadId: `openbot-thread-bot-${uuid}`,
      ownerAgentId: `bot-${uuid}`,
    });
    expect(
      storedBrowserTab({ id: "tab-2", url: "https://example.com/", ownerThreadId: null, ownerBotId: "chief" }),
    ).toMatchObject({ ownerAgentId: "chief" });
    expect(
      storedBrowserTab({ id: "tab-3", url: "https://example.com/", ownerThreadId: null, ownerAgentId: null }),
    ).toMatchObject({ ownerAgentId: null });
    expect(
      storedBrowserTab({ id: "tab-4", url: "file:///etc/passwd", ownerThreadId: null, ownerAgentId: null }),
    ).toBeNull();
  });

  it("upgrades a v1 tab and refuses a viewport the file cannot be trusted for", () => {
    // Nothing copies this file before an upgrade, so a v1 row -- written by every release before the
    // per-tab environment existed -- has to survive being read by the v2 build. It comes back with no
    // `environment` at all rather than a fabricated one, and `BrowserHost` applies
    // `defaultBrowserEnvironment()` to what it gets.
    const v1 = storedBrowserTab({
      id: "tab-1",
      url: "https://example.com/app",
      ownerThreadId: null,
      ownerAgentId: null,
    });
    expect(v1).not.toBeNull();
    expect(v1?.environment).toBeUndefined();

    const restored = storedBrowserTab({
      id: "tab-2",
      url: "https://example.com/app",
      ownerThreadId: null,
      ownerAgentId: null,
      environment: {
        viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
        colorScheme: "dark",
        reducedMotion: true,
      },
    });
    expect(restored?.environment).toEqual({
      viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
      colorScheme: "dark",
      reducedMotion: true,
    });

    // A hand-edited or truncated file must not reach `Emulation.setDeviceMetricsOverride`. The bound is
    // on physical pixels, so this modest CSS size trips it only once the scale factor is applied -- and
    // the tab is still returned, because losing the user's open tab is the worse outcome of the two.
    const oversized = storedBrowserTab({
      id: "tab-3",
      url: "https://example.com/app",
      ownerThreadId: null,
      ownerAgentId: null,
      environment: {
        viewport: { mode: "custom", width: 2000, height: 2000, deviceScaleFactor: 4, preset: null },
        colorScheme: "system",
        reducedMotion: false,
      },
    });
    expect(oversized).not.toBeNull();
    expect(oversized?.environment).toBeUndefined();
  });

  it("gives a tab back to the agent that owns it now, and to nobody else", () => {
    const tab = {
      id: "tab-1",
      url: "https://example.com/app",
      ownerThreadId: `openbot-thread-bot-${uuid}`,
      ownerAgentId: `bot-${uuid}`,
    };

    // Migration v13 renamed this agent inside the database and its thread id with it. Leaving the file's
    // spellings alone means `#canUseToolTab` compares a thread that no longer exists, so every tool call
    // against the tab the agent itself opened is refused.
    expect(
      reownStoredBrowserTab(tab, [{ id: `agent-${uuid}`, threadId: `openbot-thread-agent-${uuid}` }]),
    ).toMatchObject({ ownerAgentId: `agent-${uuid}`, ownerThreadId: `openbot-thread-agent-${uuid}` });

    // v13 declines when the `agent-` spelling is already taken, so both agents exist and the `bot-` one
    // still answers to its own name. Renaming by shape would hand this tab to the stranger beside it.
    expect(
      reownStoredBrowserTab(tab, [
        { id: `agent-${uuid}`, threadId: `openbot-thread-agent-${uuid}` },
        { id: `bot-${uuid}`, threadId: `openbot-thread-bot-${uuid}` },
      ]),
    ).toEqual(tab);

    // A generated agent's thread id is a bare UUID that v13 never rewrote, so it matches on its own while
    // the owner id beside it is still the old spelling. Calling that tab correct leaves `#canUseToolTab`,
    // which checks both, refusing every tool call against it.
    const threadId = `openbot-thread-${uuid}`;
    expect(
      reownStoredBrowserTab({ ...tab, ownerThreadId: threadId }, [{ id: `agent-${uuid}`, threadId }]),
    ).toMatchObject({ ownerAgentId: `agent-${uuid}`, ownerThreadId: threadId });

    // Nobody to give it to. Keeping the id it was found with orphans the tab; inventing one hands it over.
    expect(reownStoredBrowserTab(tab, [{ id: "chief", threadId: "openbot-thread-chief" }])).toEqual(tab);
  });
});
