// @vitest-environment node

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { describe, expect, it, vi } from "vitest";
import type { BrowserIpcDependencies } from "./browser-handlers";

type TrustedInvoke = (event: { senderFrame: { url: string } }, payload: unknown) => unknown;

// The real binder is used, so each endpoint is reached the way a renderer reaches it. `ipcMain` has
// no injectable seam outside an Electron process, so this stand-in records what the registrar bound.
const bound = new Map<string, TrustedInvoke>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: TrustedInvoke) => bound.set(channel, listener) },
}));

const { browserIpcHandlers } = await import("./browser-handlers");

const APP_FRAME = { senderFrame: { url: "openbot-app://app/index.html" } };
const REMOTE = "studio-mac";
const TAB = {
  id: "tab-1",
  title: "Example",
  url: "https://example.com",
  loading: false,
  ownerThreadId: null,
  ownerAgentId: null,
};

interface RemoteCall {
  path: string;
  body: unknown;
}

type BrowserDouble = BrowserIpcDependencies["browser"];

// Every endpoint this group binds reaches one host method, and a test that names none of them still
// binds them all. An unnamed method fails loudly rather than quietly answering `undefined`.
function unreached(name: string): () => never {
  return () => {
    throw new Error(`The browser double has no ${name}.`);
  };
}

function bind(options: {
  activeServerId: string;
  capabilities?: readonly string[];
  browser?: Partial<BrowserDouble>;
  answer?: (path: string) => unknown;
}) {
  const calls: RemoteCall[] = [];
  const liveView: { started: string[]; input: unknown[] } = { started: [], input: [] };
  const dependencies: BrowserIpcDependencies = {
    browserPictureInPicture: {
      open: unreached("pictureInPictureOpen"),
      close: unreached("pictureInPictureClose"),
      dock: unreached("pictureInPictureDock"),
      hide: unreached("pictureInPictureHide"),
    },
    browser: {
      open: unreached("open"),
      activate: unreached("activate"),
      loadUrl: unreached("loadUrl"),
      navigate: unreached("navigate"),
      reload: unreached("reload"),
      close: unreached("close"),
      listTabs: unreached("listTabs"),
      getDisplayState: unreached("getDisplayState"),
      getControlState: unreached("getControlState"),
      capturePreview: unreached("capturePreview"),
      setVisible: unreached("setVisible"),
      ...options.browser,
    },
    browserView: {
      start: async (tabId) => {
        liveView.started.push(tabId);
      },
      stop: unreached("stopLiveView"),
      sendInput: (input) => {
        liveView.input.push(input);
      },
    },
    remoteServers: {
      activeServerId: options.activeServerId,
      supportsCapability: (_serverId, capability) => (options.capabilities ?? []).includes(capability),
      request: async (_serverId, path, decoder, init) => {
        calls.push({ path, body: init?.body });
        return decoder(options.answer?.(path));
      },
    },
  };
  bound.clear();
  const { browser: endpoints } = browserIpcHandlers(dependencies);
  for (const [name, register] of Object.entries(endpoints)) register(name);
  return { calls, liveView };
}

describe("the browser on a remote host", () => {
  it("keeps the panel's placement off the host's screen", async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    const setVisible = vi.fn(async () => undefined);
    const { calls } = bind({ activeServerId: REMOTE, browser: { setVisible } });

    await bound.get("setVisible")?.(APP_FRAME, {
      visible: true,
      target: "main",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });

    // The bounds are this window's rectangle and the host's browser is a native view on the host's
    // own screen, so a forwarded placement mounts a page over whoever is sitting at that computer.
    expect(calls).toEqual([]);
    expect(setVisible).not.toHaveBeenCalled();
  });

  it("moves the tab the user is looking at when the host can", async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    const { calls } = bind({
      activeServerId: REMOTE,
      capabilities: [TEAM_BROWSER_NAVIGATION_CAPABILITY],
      answer: () => undefined,
    });

    await bound.get("navigate")?.(APP_FRAME, { tabId: TAB.id, url: "https://example.com/next" });

    expect(calls).toEqual([
      { path: TEAM_API_ROUTES.browser.load, body: { tabId: TAB.id, url: "https://example.com/next" } },
    ]);
  });

  it("refuses an address in an existing tab on a host without the capability", async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    const { calls } = bind({ activeServerId: REMOTE, answer: () => undefined });

    // The renderer opens a new tab for the address when this fails, which is what an older host has
    // always done. `ipcMain.handle` turns the raised error into a rejected invoke for the renderer.
    expect(() => bound.get("navigate")?.(APP_FRAME, { tabId: TAB.id, url: "https://example.com/next" })).toThrow(
      /address-bar navigation/u,
    );
    expect(calls).toEqual([]);
  });

  it("reads which tab is in front when the host can say", async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    const { calls } = bind({
      activeServerId: REMOTE,
      capabilities: [TEAM_BROWSER_NAVIGATION_CAPABILITY],
      answer: () => ({ tabs: [TAB, { ...TAB, id: "tab-2" }], activeTabId: "tab-2" }),
    });

    await expect(bound.get("getDisplayState")?.(APP_FRAME, undefined)).resolves.toEqual({
      tabs: [TAB, { ...TAB, id: "tab-2" }],
      activeTabId: "tab-2",
    });
    expect(calls.map((call) => call.path)).toEqual([TEAM_API_ROUTES.browser.display]);
  });

  it("falls back to the tab list on a host without the capability", async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    const { calls } = bind({ activeServerId: REMOTE, answer: () => [TAB, { ...TAB, id: "tab-2" }] });

    await expect(bound.get("getDisplayState")?.(APP_FRAME, undefined)).resolves.toEqual({
      tabs: [TAB, { ...TAB, id: "tab-2" }],
      activeTabId: TAB.id,
    });
    expect(calls.map((call) => call.path)).toEqual([TEAM_API_ROUTES.browser.tabs]);
  });

  it("refuses a live view click that points outside the frame", async () => {
    const { liveView } = bind({ activeServerId: REMOTE, capabilities: ["browser-view"] });
    const send = bound.get("sendLiveViewInput");
    const click = { type: "pointer", action: "down", x: 0.5, y: 0.25, button: "left" };
    await send?.(APP_FRAME, click);
    // A fraction is the whole agreement about where the click lands. The host bounds it too, but a
    // renderer that sends a page coordinate by mistake must not reach the host's viewport at all.
    expect(() => send?.(APP_FRAME, { ...click, y: 480 })).toThrow("Invalid browser view input.");
    expect(liveView.input).toEqual([{ ...click, clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 }]);
  });
});
