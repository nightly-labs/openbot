import type {
  BrowserBounds,
  BrowserControlState,
  BrowserDisplayState,
  BrowserLiveViewEvent,
  BrowserPictureInPictureEvent,
  BrowserTab,
  BrowserTabAgent,
  BrowserWindowEvent,
  BrowserWindowModel,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeBrowserBounds,
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserLiveViewEvent,
  decodeBrowserPictureInPictureEvent,
  decodeBrowserTab,
  decodeBrowserTabs,
  decodeBrowserWindowEvent,
  decodeBrowserWindowModel,
} from "./browser-decoding";

const tab = {
  id: "tab-1",
  title: "Example",
  url: "https://example.test",
  loading: false,
  ownerThreadId: null,
  ownerAgentId: "agent-1",
} satisfies BrowserTab;

const fullTab = {
  ...tab,
  environment: {
    viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
    colorScheme: "dark",
    reducedMotion: true,
  },
  recording: true,
  diagnosticErrorCount: 2,
  openerTabId: "tab-0",
  popupFailure: { id: "popup-1", message: "The popup was blocked." },
  userControl: true,
  canGoBack: true,
  canGoForward: false,
  httpSignIn: { origin: "https://files.example.com", refused: true },
} satisfies BrowserTab;

const bounds = { x: 10, y: 20, width: 480, height: 270 } satisfies BrowserBounds;

const controlState = {
  sessions: [
    {
      id: "session-1",
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tabId: null,
      action: "open",
      phase: "acting",
      startedAt: "2026-09-23T10:00:00.000Z",
    },
    {
      id: "session-2",
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-2",
      tabId: "tab-1",
      action: "click",
      detailAction: "hover",
      phase: "waiting",
      startedAt: "2026-09-23T10:00:01.000Z",
    },
  ],
} satisfies BrowserControlState;

const frame = {
  type: "frame",
  tabId: "tab-1",
  sequence: 4,
  width: 1280,
  height: 720,
  image: new Uint8Array([255, 216, 255]),
} satisfies BrowserLiveViewEvent;

const agent: BrowserTabAgent = {
  id: "agent-1",
  name: "Chief",
  avatarSeed: "chief",
  avatarHue: 215,
  avatarColor: null,
  avatarUrl: null,
};

const windowModel = {
  tabs: [tab, fullTab],
  activeTabId: "tab-1",
  details: [
    {
      tabId: "tab-1",
      control: controlState.sessions[1],
      controller: agent,
      owner: agent,
      profile: { tabId: "tab-1", name: "Work", hue: 30, proxy: "proxy.example.test:8080" },
    },
    { tabId: "tab-0" },
  ],
  history: [{ url: "https://example.test", title: "", visits: 3 }],
  canReopen: true,
  canCloseTabs: true,
  liveViewTabId: null,
  liveViewClipboard: false,
  shortcuts: "mac",
} satisfies BrowserWindowModel;

describe("browser decoders", () => {
  it.each([
    ["browser tab", decodeBrowserTab, tab],
    ["browser tab with every optional field", decodeBrowserTab, fullTab],
    ["browser tab list", decodeBrowserTabs, [tab, fullTab]],
    [
      "browser display state",
      decodeBrowserDisplayState,
      { tabs: [tab], activeTabId: "tab-1" } satisfies BrowserDisplayState,
    ],
    ["browser control state", decodeBrowserControlState, controlState],
    ["browser bounds", decodeBrowserBounds, bounds],
    ["live view frame", decodeBrowserLiveViewEvent, frame],
    [
      "stopped live view",
      decodeBrowserLiveViewEvent,
      { type: "stopped", tabId: "tab-1", reason: "The live view of this page ended." } satisfies BrowserLiveViewEvent,
    ],
    [
      "picture-in-picture move",
      decodeBrowserPictureInPictureEvent,
      { type: "bounds-changed", bounds } satisfies BrowserPictureInPictureEvent,
    ],
    [
      "picture-in-picture dock",
      decodeBrowserPictureInPictureEvent,
      { type: "dock" } satisfies BrowserPictureInPictureEvent,
    ],
    ["browser window model", decodeBrowserWindowModel, windowModel],
    ["missing browser window model", decodeBrowserWindowModel, null],
    ["browser window move", decodeBrowserWindowEvent, { type: "bounds-changed", bounds } satisfies BrowserWindowEvent],
    [
      "browser window tab close",
      decodeBrowserWindowEvent,
      { type: "action", action: { type: "close", tabIds: ["tab-1", "tab-0"] } } satisfies BrowserWindowEvent,
    ],
    [
      "browser window address",
      decodeBrowserWindowEvent,
      {
        type: "action",
        action: { type: "open-address", url: "example.test", tabId: "tab-1" },
      } satisfies BrowserWindowEvent,
    ],
  ] as const)("keeps a valid %s", (_name, decode: (value: unknown) => unknown, value) => {
    expect(decode(value)).toEqual(value);
  });

  it.each([
    ["browser tab without a loading state", decodeBrowserTab, { ...tab, loading: undefined }],
    [
      "browser tab with an unknown viewport preset",
      decodeBrowserTab,
      {
        ...fullTab,
        environment: { ...fullTab.environment, viewport: { ...fullTab.environment.viewport, preset: "tv" } },
      },
    ],
    ["browser tab with a text error count", decodeBrowserTab, { ...tab, diagnosticErrorCount: "2" }],
    ["browser tab with a text canGoBack", decodeBrowserTab, { ...tab, canGoBack: "true" }],
    ["browser tab with a numeric canGoForward", decodeBrowserTab, { ...tab, canGoForward: 1 }],
    [
      "browser tab with a site sign-in over HTTP",
      decodeBrowserTab,
      { ...tab, httpSignIn: { origin: "http://files.example.com" } },
    ],
    [
      "browser tab with a site sign-in path",
      decodeBrowserTab,
      { ...tab, httpSignIn: { origin: "https://files.example.com/login" } },
    ],
    [
      "browser tab with a false site sign-in refusal",
      decodeBrowserTab,
      { ...tab, httpSignIn: { origin: "https://files.example.com", refused: false } },
    ],
    ["browser tab list that is not an array", decodeBrowserTabs, tab],
    ["browser display state without tabs", decodeBrowserDisplayState, { activeTabId: null }],
    [
      "browser control session with an unknown action",
      decodeBrowserControlState,
      { sessions: [{ ...controlState.sessions[0], action: "fly" }] },
    ],
    ["browser bounds without a height", decodeBrowserBounds, { x: 0, y: 0, width: 1 }],
    ["live view frame with a text image", decodeBrowserLiveViewEvent, { ...frame, image: "jpeg" }],
    ["live view event of an unknown type", decodeBrowserLiveViewEvent, { type: "paused", tabId: "tab-1" }],
    ["picture-in-picture move without bounds", decodeBrowserPictureInPictureEvent, { type: "bounds-changed" }],
    ["picture-in-picture event of an unknown type", decodeBrowserPictureInPictureEvent, { type: "grow" }],
    [
      "browser window model with an unknown avatar hue",
      decodeBrowserWindowModel,
      { ...windowModel, details: [{ tabId: "tab-1", owner: { ...agent, avatarHue: 17 } }] },
    ],
    ["browser window model with unknown shortcuts", decodeBrowserWindowModel, { ...windowModel, shortcuts: "linux" }],
    ["browser window model without history", decodeBrowserWindowModel, { ...windowModel, history: undefined }],
    [
      "browser window action of an unknown type",
      decodeBrowserWindowEvent,
      { type: "action", action: { type: "print" } },
    ],
    [
      "browser window navigation in an unknown direction",
      decodeBrowserWindowEvent,
      { type: "action", action: { type: "navigate", tabId: "tab-1", direction: "up" } },
    ],
  ] as const)("rejects a %s", (_name, decode: (value: unknown) => unknown, value) => {
    expect(() => decode(value)).toThrow(/^Invalid /);
  });

  it.each([false, "true", 1, null, {}])("drops a userControl value of %j", (userControl) => {
    expect(decodeBrowserTab({ ...tab, userControl })).toEqual(tab);
  });
});
