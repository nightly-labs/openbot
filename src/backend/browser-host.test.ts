import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BrowserFormState } from "@openbot/contracts/ipc";
import { BrowserWindow, type WebContents, webContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserHost } from "./browser-host";
import type { TakeoverPageCommand } from "./browser-takeover-page";

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
    close() {}
    setAudioMuted() {}
    setWindowOpenHandler() {}
    async executeJavaScript() {
      return null;
    }
    navigationHistory = { clear() {}, canGoBack: () => false, canGoForward: () => false };
  }
  return {
    app: { getPreferredSystemLanguages: () => ["en-US"] },
    BrowserWindow: class {
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

const formEngine = vi.hoisted(() => ({
  run: vi.fn<(command: TakeoverPageCommand, check: () => void) => Promise<BrowserFormState>>(),
  wait: vi.fn<() => Promise<void>>(),
}));

vi.mock("./browser-cdp", () => ({
  BrowserCdpEngine: class {
    constructor(private readonly contents: WebContents) {}
    destroy() {}
    invalidateReferences() {}
    takeoverForm = formEngine.run;
    waitFor = formEngine.wait;
    async setEnvironment() {}
    async navigate(url: string) {
      await this.contents.loadURL(url);
    }
  },
}));

let directory: string;
let host: BrowserHost;
let statePath: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-browser-limit-"));
  statePath = join(directory, "browser-tabs.json");
  host = new BrowserHost(new BrowserWindow(), directory, statePath);
});
afterEach(async () => {
  await host.destroy();
  await rm(directory, { recursive: true, force: true });
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

describe("local takeover forms", () => {
  it("returns a valid submission to the agent even when the page needs another step and rejects reused revisions", async () => {
    formEngine.run.mockImplementation(async (command, check) => {
      check();
      return {
        revision: command.kind === "read" ? command.revision : command.input.revision,
        origin: "https://example.com",
        forms: [],
        status: "manual",
      };
    });
    formEngine.wait.mockResolvedValue();
    const tab = await host.open("https://example.com", "thread", "agent");
    await host.beginTakeover(tab.id);
    const state = await host.readTakeoverForm(tab.id, () => undefined);
    const input = {
      requestId: "request",
      agentId: "agent",
      threadId: "thread",
      tabId: tab.id,
      revision: state.revision,
      formId: "form-0",
      actionId: "field-0",
      values: [],
    };
    expect((await host.submitTakeoverForm(input, () => undefined)).status).toBe("complete");
    await expect(host.submitTakeoverForm(input, () => undefined)).rejects.toThrow("The browser form changed");
    host.endTakeover(tab.id);
    await expect(host.readTakeoverForm(tab.id, () => undefined)).rejects.toThrow("no longer active");
  });

  it("keeps validation errors active and stops an expired request before dispatch", async () => {
    formEngine.run.mockImplementation(async (command, check) => {
      check();
      return {
        revision: command.kind === "read" ? command.revision : command.input.revision,
        origin: "https://example.com",
        forms: [],
        status: command.kind === "submit" ? "invalid" : "ready",
      };
    });
    formEngine.wait.mockResolvedValue();
    const tab = await host.open("https://example.com", "thread", "agent");
    await host.beginTakeover(tab.id);
    const state = await host.readTakeoverForm(tab.id, () => undefined);
    const input = {
      requestId: "request",
      agentId: "agent",
      threadId: "thread",
      tabId: tab.id,
      revision: state.revision,
      formId: "form-0",
      actionId: "field-0",
      values: [],
    };
    expect((await host.submitTakeoverForm(input, () => undefined)).status).toBe("invalid");
    await expect(
      host.readTakeoverForm(tab.id, () => {
        throw new Error("Expired");
      }),
    ).rejects.toThrow("Expired");
  });
});
