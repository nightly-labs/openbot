import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserTab,
  BrowserWindowAction,
  BrowserWindowModel,
  BrowserWindowTabDetails,
  ServerSummary,
} from "@openbot/contracts/ipc";
import type { BrowserHistoryEntry } from "@openbot/ui/features/browser/browser-suggestions";
import { createEffect, onCleanup, snapshot } from "solid-js";
import { serverSupportsCapability } from "../servers/server-capabilities";
import type { BrowserPort } from "./browser-port";
import { browserSessionHistory, canReopenBrowserTab } from "./browser-tab-session";

interface BrowserWindowOperations {
  activate: (tabId: string) => void;
  close: (tabIds: readonly string[]) => void;
  newTab: (afterId: string | undefined) => void;
  duplicate: (tabId: string) => void;
  move: (tabId: string, index: number) => void;
  reopen: () => void;
  reload: (tabId: string) => void;
  stop: (tabId: string) => void;
  navigate: (tabId: string, direction: "back" | "forward") => void;
  openAddress: (url: string, tabId: string | undefined) => void;
}

interface BrowserWindowSource {
  serverId: () => string;
  server: () => ServerSummary | undefined;
  macShortcuts: () => boolean;
  tabs: () => BrowserTab[];
  activeTabId: () => string | undefined;
  tabDetails: (tab: BrowserTab) => BrowserWindowTabDetails;
  operations: BrowserWindowOperations;
}

function fitsWindowModel(entry: BrowserHistoryEntry): boolean {
  return entry.url.length <= INPUT_LIMITS.browserUrl && entry.title.length <= INPUT_LIMITS.browserUrl;
}

function browserWindowModel(source: BrowserWindowSource): BrowserWindowModel {
  const server = source.server();
  const tabs = source.tabs();
  const activeTabId = source.activeTabId() ?? null;
  const remoteView = server?.kind === "remote" && serverSupportsCapability(server, "browser-view");
  return {
    tabs,
    activeTabId,
    details: tabs.map(source.tabDetails),
    history: browserSessionHistory(source.serverId()).filter(fitsWindowModel),
    canReopen: canReopenBrowserTab(source.serverId()),
    canCloseTabs: true,
    liveViewTabId: remoteView ? activeTabId : null,
    liveViewClipboard: serverSupportsCapability(server, "browser-view-clipboard"),
    shortcuts: source.macShortcuts() ? "mac" : "pc",
  };
}

function runBrowserWindowAction(operations: BrowserWindowOperations, action: BrowserWindowAction) {
  switch (action.type) {
    case "activate":
      operations.activate(action.tabId);
      return;
    case "close":
      operations.close(action.tabIds);
      return;
    case "new-tab":
      operations.newTab(action.afterId);
      return;
    case "duplicate":
      operations.duplicate(action.tabId);
      return;
    case "move":
      operations.move(action.tabId, action.index);
      return;
    case "reopen":
      operations.reopen();
      return;
    case "reload":
      operations.reload(action.tabId);
      return;
    case "stop":
      operations.stop(action.tabId);
      return;
    case "navigate":
      operations.navigate(action.tabId, action.direction);
      return;
    case "open-address":
      operations.openAddress(action.url, action.tabId);
      return;
  }
}

export function relayBrowserWindow(
  browser: Pick<BrowserPort["browser"], "onWindowEvent" | "publishWindowModel">,
  source: BrowserWindowSource,
) {
  createEffect(
    () => browserWindowModel(source),
    (model) => {
      void browser.publishWindowModel(snapshot(model));
    },
  );
  onCleanup(
    browser.onWindowEvent((event) => {
      if (event.type === "action") runBrowserWindowAction(source.operations, event.action);
    }),
  );
}
