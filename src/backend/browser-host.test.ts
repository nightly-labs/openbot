import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { BrowserWindow, type WebContents, WebContentsView, webContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserHost } from "./browser-host";

const windowOpenHandlers = vi.hoisted((): Array<(details: { url: string }) => { action: string }> => []);

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const contents: FakeContents[] = [];
  class FakeContents extends EventEmitter {
    url = "";
    getURL() {
      return this.url;
    }
    getTitle() {
      return this.url;
    }
    isLoading() {
      return false;
    }
    isDestroyed() {
      return false;
    }
    async loadURL(url: string) {
      this.url = url;
      this.emit("did-navigate", {}, url);
    }
    reload() {
      this.emit("did-start-navigation", {}, this.url, false, true);
      this.emit("did-stop-loading");
    }
    stop() {
      this.emit("did-stop-loading");
    }
    close() {}
    focus() {}
    setAudioMuted() {}
    invalidate() {}
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      windowOpenHandlers.push(handler);
    }
    async executeJavaScript() {
      return null;
    }
    focusedFrame: { executeJavaScript: () => Promise<unknown>; isDestroyed: () => boolean } | null = null;
    mainFrame = {
      async executeJavaScript() {
        return false;
      },
      isDestroyed() {
        return false;
      },
    };
    navigationHistory = { clear() {}, canGoBack: () => false, canGoForward: () => false };
  }
  return {
    app: { getPreferredSystemLanguages: () => ["en-US"] },
    BrowserWindow: class {
      webContents = { getZoomFactor: () => 1, focus() {}, sendInputEvent() {} };
      contentView = { addChildView() {}, removeChildView() {} };
      isDestroyed() {
        return false;
      }
    },
    WebContentsView: class {
      webContents = new FakeContents();
      constructor() {
        contents.push(this.webContents);
      }
      setBackgroundColor() {}
      setVisible() {}
      getVisible() {
        return false;
      }
      setBounds() {}
      setBorderRadius() {}
      getBounds() {
        return { x: 0, y: 0, width: 1200, height: 800 };
      }
    },
    webContents: { getFocusedWebContents: () => null, getAllWebContents: () => contents },
    session: {
      fromPartition: () => ({
        getUserAgent: () => "Chrome/144.0.0.0",
        setUserAgent() {},
        webRequest: { onBeforeSendHeaders() {}, onCompleted() {}, onErrorOccurred() {} },
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        on() {},
        flushStorageData() {},
        cookies: { async flushStore() {} },
      }),
    },
  };
});

vi.mock("./browser-cdp", () => ({
  BrowserCdpEngine: class {
    constructor(private readonly contents: WebContents) {}
    destroy() {}
    async setEnvironment() {}
    async navigate(url: string) {
      await this.contents.loadURL(url);
    }
  },
}));

let directory: string;
let host: BrowserHost;
let browserWindow: BrowserWindow;
let statePath: string;
beforeEach(async () => {
  windowOpenHandlers.length = 0;
  directory = await mkdtemp(join(tmpdir(), "openbot-browser-limit-"));
  statePath = join(directory, "browser-tabs.json");
  browserWindow = new BrowserWindow();
  host = new BrowserHost(browserWindow, directory, statePath);
});
afterEach(async () => {
  await host.destroy();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(["main", "picture-in-picture"] as const)("%s browser view bounds", (target) => {
  it.each([1, 1.1, 0.8])("aligns the native view with renderer bounds at zoom %s", async (zoomFactor) => {
    const pictureInPictureWindow = new BrowserWindow();
    host.setPictureInPictureWindow(pictureInPictureWindow);
    const targetWindow = target === "main" ? browserWindow : pictureInPictureWindow;
    vi.spyOn(targetWindow.webContents, "getZoomFactor").mockReturnValue(zoomFactor);
    const setBounds = vi.spyOn(WebContentsView.prototype, "setBounds");
    await host.open("https://example.com");

    await host.setVisible({ visible: true, target, bounds: { x: 40, y: 100, width: 1200, height: 600 } });

    expect(setBounds).toHaveBeenLastCalledWith({
      x: Math.floor(40 * zoomFactor),
      y: Math.floor(100 * zoomFactor),
      width: Math.ceil(1200 * zoomFactor),
      height: Math.ceil(600 * zoomFactor),
    });
  });
});

const escapeInput = { type: "keyDown", key: "Escape", control: false, meta: false, alt: false, shift: false };
const pageBounds = { x: 0, y: 0, width: 1200, height: 600 };

describe("browser Escape forwarding", () => {
  const contentsFor = (url: string): WebContents => {
    const found = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url);
    if (!found) throw new Error("Browser contents were not created.");
    return found;
  };

  it("collapses the expanded browser in the main window", async () => {
    const tab = await host.open("https://example.com/escape");
    const page = contentsFor(tab.url);
    const sendInputEvent = vi.spyOn(browserWindow.webContents, "sendInputEvent");
    await host.setVisible({ visible: true, target: "main", bounds: pageBounds });

    page.emit("before-input-event", { preventDefault: () => undefined }, escapeInput);

    await vi.waitFor(() => expect(sendInputEvent).toHaveBeenCalledWith({ type: "keyUp", keyCode: "Escape" }));
    expect(sendInputEvent).toHaveBeenCalledWith({ type: "keyDown", keyCode: "Escape" });
  });

  it("leaves Escape in Picture in Picture, which has its own window", async () => {
    const pictureInPictureWindow = new BrowserWindow();
    host.setPictureInPictureWindow(pictureInPictureWindow);
    const tab = await host.open("https://example.com/detached");
    const page = contentsFor(tab.url);
    const askedPage = vi.spyOn(page.mainFrame, "executeJavaScript");
    const sendInputEvent = vi.spyOn(browserWindow.webContents, "sendInputEvent");
    await host.setVisible({ visible: true, target: "picture-in-picture", bounds: pageBounds });

    page.emit("before-input-event", { preventDefault: () => undefined }, escapeInput);

    // The page is never asked, so there is nothing to wait for: the key stays in the detached
    // window instead of reaching the main renderer, where Escape cancels a queued message edit.
    expect(askedPage).not.toHaveBeenCalled();
    expect(sendInputEvent).not.toHaveBeenCalled();
  });

  it("keeps Escape in the page while an editable element has focus", async () => {
    const tab = await host.open("https://example.com/editable");
    const page = contentsFor(tab.url);
    const askedPage = vi.spyOn(page.mainFrame, "executeJavaScript").mockResolvedValue(true);
    const sendInputEvent = vi.spyOn(browserWindow.webContents, "sendInputEvent");
    await host.setVisible({ visible: true, target: "main", bounds: pageBounds });

    page.emit("before-input-event", { preventDefault: () => undefined }, escapeInput);

    await vi.waitFor(() => expect(askedPage).toHaveBeenCalled());
    expect(sendInputEvent).not.toHaveBeenCalled();
  });
});

describe("browser address navigation", () => {
  it("releases the tab queue after an address navigation times out", async () => {
    const tab = await host.open("https://example.com/timeout-test");
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === tab.url);
    if (!contents) throw new Error("Browser contents were not created.");
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let rejectLoading: ((error: Error) => void) | undefined;
    const loading = new Promise<void>((_resolve, reject) => {
      rejectLoading = reject;
    });
    const load = vi.spyOn(contents, "loadURL").mockImplementationOnce((url) => {
      contents.emit("did-start-navigation", {}, url, false, true);
      signalStarted?.();
      return loading;
    });
    const stop = vi.spyOn(contents, "stop").mockImplementation(() => {
      contents.emit("did-stop-loading");
      rejectLoading?.(new Error("Navigation stopped."));
    });
    vi.useFakeTimers();
    const failure = expect(host.loadUrl(tab.id, "https://example.com/slow")).rejects.toThrow("Navigation timed out.");
    await started;
    const recovery = host.loadUrl(tab.id, "https://example.com/recovered");
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    await recovery;
    expect(stop).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("https://example.com/recovered", expect.any(Object));
    expect(host.listTabs()).toEqual([expect.objectContaining({ id: tab.id, url: "https://example.com/recovered" })]);
  });

  it("loads an address in the selected tab without adding a tab or changing its owner", async () => {
    const first = await host.open("https://example.com/first", "thread-a", "agent-a");
    const second = await host.open("https://example.com/second", "thread-a", "agent-a");

    await host.loadUrl(second.id, "https://www.google.com/search?q=hello");

    expect(host.getDisplayState()).toMatchObject({
      activeTabId: second.id,
      tabs: [
        { id: first.id, url: first.url },
        {
          id: second.id,
          url: "https://www.google.com/search?q=hello",
          ownerThreadId: "thread-a",
          ownerAgentId: "agent-a",
        },
      ],
    });
    expect(host.listTabs()).toHaveLength(2);
    await expect(host.loadUrl(second.id, "file:///tmp/test")).rejects.toThrow("Only HTTP(S)");
    expect(host.listTabs()).toHaveLength(2);
  });
});

describe("browser auth popups", () => {
  it("opens an allowed popup as a focused tab with the same owner", async () => {
    const opener = await host.open("https://example.com/start", "thread-a", "agent-a");
    const handler = windowOpenHandlers.at(-1);
    if (!handler) throw new Error("Window open handler was not set.");
    const openSpy = vi.spyOn(host, "open");
    const outcome = handler({ url: "https://accounts.google.com/o/oauth2/auth?client_id=test" });
    expect(outcome).toEqual({ action: "deny" });
    expect(openSpy).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/auth?client_id=test",
      "thread-a",
      "agent-a",
      true,
    );
    await vi.waitFor(() => expect(host.listTabs()).toHaveLength(2));
    const popup = host.listTabs().find((tab) => tab.id !== opener.id);
    expect(popup).toMatchObject({
      url: "https://accounts.google.com/o/oauth2/auth?client_id=test",
      ownerThreadId: "thread-a",
      ownerAgentId: "agent-a",
    });
    expect(host.activeTabId).toBe(popup?.id);
  });

  it("ignores a popup to a disallowed URL", async () => {
    await host.open("https://example.com/start", "thread-a", "agent-a");
    const handler = windowOpenHandlers.at(-1);
    if (!handler) throw new Error("Window open handler was not set.");
    handler({ url: "file:///etc/passwd" });
    await Promise.resolve();
    expect(host.listTabs()).toHaveLength(1);
  });
});

async function fill(ownerThreadId: string | null, ownerAgentId: string | null) {
  for (let index = 0; index < INPUT_LIMITS.browserTabs; index += 1) {
    await host.open(`https://example.com/${index}`, ownerThreadId, ownerAgentId);
  }
}

describe("browser tab capacity", () => {
  it("opens Google from an empty state even when another agent fills its limit", async () => {
    const first = await host.open("https://www.google.com", "thread-a", "agent-a");
    await host.close(first.id);
    await fill("thread-b", "agent-b");
    const tab = await host.open("https://www.google.com", "thread-a", "agent-a");
    expect(tab).toMatchObject({ url: "https://www.google.com/", ownerAgentId: "agent-a" });
    expect(host.listTabs().filter((entry) => entry.ownerAgentId === "agent-a")).toEqual([tab]);
  });

  it("enforces 25 tabs per agent and frees capacity on close", async () => {
    await fill("thread-a", "agent-a");
    await expect(host.open("https://www.google.com", "new-thread-a", "agent-a")).rejects.toThrow(
      "The browser can have up to 25 open tabs.",
    );
    const tab = host.listTabs()[0];
    await host.close(tab.id);
    await host.open("https://www.google.com", "thread-a", "agent-a");
    expect(host.listTabs()).toHaveLength(25);
  });

  it("counts legacy thread-only tabs with the agent that displays them", async () => {
    await fill("thread-a", null);
    await expect(host.open("https://www.google.com", "thread-a", "agent-a")).rejects.toThrow("25 open tabs");
    await expect(host.open("https://www.google.com", "thread-b", "agent-b")).resolves.toMatchObject({
      ownerAgentId: "agent-b",
    });
  });

  it("keeps unowned tabs in a separate limited group", async () => {
    await fill(null, null);
    await expect(host.open("https://www.google.com")).rejects.toThrow("25 open tabs");
    await expect(host.open("https://www.google.com", "thread-a", "agent-a")).resolves.toMatchObject({
      ownerAgentId: "agent-a",
    });
  });

  it("counts agent-owned tabs when a restored legacy tab opens another tab", async () => {
    const tabs = Array.from({ length: 25 }, (_, index) => ({
      id: `tab-${index}`,
      url: `https://example.com/${index}`,
      ownerThreadId: "thread-a",
      ownerAgentId: index === 0 ? null : "agent-a",
    }));
    await writeFile(statePath, JSON.stringify({ version: 2, tabs, activeTabId: "tab-0" }));
    await host.restore([{ id: "agent-a", threadId: "thread-a" }]);
    // Popups inherit the legacy tab's thread ID and null agent ID.
    await expect(host.open("https://www.google.com", "thread-a", null)).rejects.toThrow("25 open tabs");
    await host.close("tab-1");
    await host.open("https://www.google.com", "thread-a", null);
    expect(host.listTabs()).toHaveLength(25);
  });

  it("restores all agents beyond 25 total tabs and retains active state", async () => {
    await fill("thread-a", "agent-a");
    await fill("thread-b", "agent-b");
    const before = host.getDisplayState();
    await host.destroy();
    host = new BrowserHost(new BrowserWindow(), directory, statePath);
    await host.restore();
    await vi.waitFor(() => expect(host.getDisplayState()).toEqual(before));
    expect(host.activeTabId).toBe(before.activeTabId);
    await expect(host.open("https://www.google.com", "thread-c", "agent-c")).resolves.toMatchObject({
      ownerAgentId: "agent-c",
    });
  });

  it("applies restored limits after resolving legacy owners", async () => {
    const uuid = "6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";
    const tabs = Array.from({ length: 26 }, (_, index) => ({
      id: `tab-${index}`,
      url: `https://example.com/${index}`,
      ownerThreadId: `openbot-thread-bot-${uuid}`,
      ownerBotId: `bot-${uuid}`,
    }));
    await writeFile(statePath, JSON.stringify({ version: 1, tabs, activeTabId: "tab-25" }));
    await host.restore([{ id: `agent-${uuid}`, threadId: `openbot-thread-agent-${uuid}` }]);
    expect(host.listTabs()).toHaveLength(25);
    expect(host.activeTabId).toBe("tab-0");
    await expect(host.open("https://www.google.com", `openbot-thread-agent-${uuid}`, `agent-${uuid}`)).rejects.toThrow(
      "25 open tabs",
    );
  });

  it.each([false, true])(
    "counts mixed restored owner fields together (thread-only first: %s)",
    async (threadOnlyFirst) => {
      const tabs = Array.from({ length: 26 }, (_, index) => ({
        id: `tab-${index}`,
        url: `https://example.com/${index}`,
        ownerThreadId: "thread-a",
        ownerAgentId: index < 13 === threadOnlyFirst ? null : "agent-a",
      }));
      await writeFile(statePath, JSON.stringify({ version: 2, tabs, activeTabId: "tab-0" }));
      await host.restore([{ id: "agent-a", threadId: "thread-a" }]);
      expect(host.listTabs()).toHaveLength(25);
      await expect(host.open("https://www.google.com", "thread-a", "agent-a")).rejects.toThrow("25 open tabs");
    },
  );

  it("keeps display events and saved URLs consistent through navigation, reload, and close", async () => {
    const changed = vi.fn();
    host.onChanged(changed);
    const tab = await host.open("https://www.google.com", "thread-a", "agent-a");
    const contents = webContents.getAllWebContents().at(-1);
    if (!contents) throw new Error("Missing tab contents");
    await contents.loadURL("https://example.com/next");
    await host.reload(tab.id);
    await host.flushPersistentStorage();
    expect(host.getDisplayState().tabs[0]).toMatchObject({ id: tab.id, url: "https://example.com/next" });
    expect(changed).toHaveBeenLastCalledWith(host.listTabs(), tab.id);
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    expect(saved.tabs[0]).toMatchObject({ id: tab.id, url: "https://example.com/next" });
    await host.close(tab.id);
    expect(host.getDisplayState()).toEqual({ tabs: [], activeTabId: null });
    expect(changed).toHaveBeenLastCalledWith([], null);
  });
});
