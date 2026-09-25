// The embedded browser and its picture-in-picture window.

import { type BrowserDisplayState, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { decodeBrowserViewInputValue } from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import type { BrowserHost } from "../../backend/browser-host";
import type { BrowserPictureInPicture } from "../browser-picture-in-picture";
import type { BrowserViewClient } from "../browser-view-client";
import {
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserPreviewFromHost,
  decodeBrowserTab,
  decodeBrowserTabs,
} from "../remote-device-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseBrowserBounds, parseBrowserNavigate, parseBrowserOpen, parseVisibility } from "./browser-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { optionalPayload, stringPayload } from "./validation";

/**
 * Only the members these endpoints reach. Each host is an Electron-bound class that cannot be
 * constructed outside a running app, so the narrow shapes are what a test can stand in for.
 */
export interface BrowserIpcDependencies {
  browserPictureInPicture: Pick<BrowserPictureInPicture, "open" | "close" | "dock" | "hide">;
  browser: Pick<
    BrowserHost,
    | "open"
    | "activate"
    | "loadUrl"
    | "navigate"
    | "reload"
    | "close"
    | "listTabs"
    | "getDisplayState"
    | "getControlState"
    | "capturePreview"
    | "setVisible"
  >;
  remoteServers: Pick<RemoteServerManager, "activeServerId" | "supportsCapability" | "request">;
  browserView: Pick<BrowserViewClient, "start" | "stop" | "sendInput">;
}

export function browserIpcHandlers({
  browserPictureInPicture,
  browser,
  remoteServers,
  browserView,
}: BrowserIpcDependencies): Pick<IpcGroupHandlers, "browser" | "browserInput"> {
  return {
    browser: {
      open: payloadHandler(parseBrowserOpen, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () =>
            browser.open(parsed.url, parsed.ownerThreadId ?? null, parsed.ownerAgentId ?? null, parsed.focus),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.open, decodeBrowserTab, {
              method: "POST",
              body: parsed,
            }),
        }),
      ),
      activate: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.activate(tabId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.activate, decodeVoid, {
              method: "POST",
              body: { tabId },
            }),
        }),
      ),
      navigate: payloadHandler(parseBrowserNavigate, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () =>
            "url" in parsed
              ? browser.loadUrl(parsed.tabId, parsed.url)
              : browser.navigate(parsed.tabId, parsed.direction),
          remote: (serverId) => {
            if (!("url" in parsed)) {
              return remoteServers.request(serverId, TEAM_API_ROUTES.browser.navigate, decodeVoid, {
                method: "POST",
                body: parsed,
              });
            }
            // An older host has no route that moves an existing tab to an address. The renderer
            // opens a new tab for it instead, so this stays the error that tells it to.
            if (!remoteServers.supportsCapability(serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
              throw new Error("This remote host does not support address-bar navigation in an existing tab.");
            }
            return remoteServers.request(serverId, TEAM_API_ROUTES.browser.load, decodeVoid, {
              method: "POST",
              body: parsed,
            });
          },
        }),
      ),
      reload: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.reload(tabId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.reload, decodeVoid, {
              method: "POST",
              body: { tabId },
            }),
        }),
      ),
      close: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.close(tabId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.close, decodeVoid, {
              method: "POST",
              body: { tabId },
            }),
        }),
      ),
      listTabs: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.listTabs(),
          remote: (serverId) => remoteServers.request(serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs),
        }),
      ),
      getDisplayState: handler(() =>
        routeToServer<BrowserDisplayState>(remoteServers.activeServerId, {
          local: () => browser.getDisplayState(),
          remote: async (serverId) => {
            // Without the capability the host can only list tabs, and nothing on that list says
            // which one is in front. The first tab is the guess this route exists to replace.
            if (!remoteServers.supportsCapability(serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
              const tabs = await remoteServers.request(serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs);
              return { tabs, activeTabId: tabs[0]?.id ?? null };
            }
            return remoteServers.request(serverId, TEAM_API_ROUTES.browser.display, decodeBrowserDisplayState);
          },
        }),
      ),
      getControlState: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.getControlState(),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.control, decodeBrowserControlState),
        }),
      ),
      capturePreview: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.capturePreview(tabId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.browser.preview, decodeBrowserPreviewFromHost, {
              method: "POST",
              body: { tabId },
            }),
        }),
      ),
      // Visibility is a local placement, not a remote operation, so a host's tab is left alone. The
      // bounds are this window's CSS rectangle, and the host's browser is a native view on the
      // host's own screen: forwarding them mounted a page over whoever is sitting at that computer,
      // at coordinates that mean nothing there, and still showed the remote user nothing.
      // `/v1/browser/visible` stays served for the clients that already send it.
      setVisible: payloadHandler(parseVisibility, async (parsed) => {
        if (remoteServers.activeServerId === LOCAL_SERVER_ID) browser.setVisible(parsed);
      }),
      // A local tab is a native view on this screen already; only a host's tab needs its pixels sent.
      startLiveView: payloadHandler(stringPayload("tabId"), (tabId) => browserView.start(tabId)),
      stopLiveView: handler(() => browserView.stop()),
      openPictureInPicture: payloadHandler(optionalPayload(parseBrowserBounds), (bounds) =>
        browserPictureInPicture.open(bounds),
      ),
      closePictureInPicture: handler(() => browserPictureInPicture.close()),
      dockPictureInPicture: handler(() => browserPictureInPicture.dock()),
      hidePictureInPicture: handler(() => browserPictureInPicture.hide()),
    },
    browserInput: {
      // The protocol's own decoder is the boundary check: what the renderer sends is dispatched on a
      // host that never sees this process, so it passes the same reading the host applies to any
      // other member's input, and reaches the socket without a second one.
      sendLiveViewInput: payloadHandler(decodeBrowserViewInputValue, async (input) => browserView.sendInput(input)),
    },
  };
}
