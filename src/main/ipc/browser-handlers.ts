// The embedded browser and its picture-in-picture window.

import { type BrowserDisplayState, type BrowserTab, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PAGE_STATE_ROUTES,
  decodeBrowserPageStateSnapshot,
} from "@openbot/contracts/team-protocol/browser-page-state-v1";
import {
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_SIGN_IN_ROUTES,
  decodeBrowserSignInResult,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import {
  BROWSER_USER_CONTROL_CAPABILITY,
  BROWSER_USER_CONTROL_ROUTES,
  decodeBrowserUserControlSnapshot,
} from "@openbot/contracts/team-protocol/browser-user-control-v1";
import {
  decodeBrowserViewInputValue,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import type { WebContents } from "electron";
import type { BrowserHost } from "../../backend/browser-host";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BrowserPictureInPicture } from "../browser-picture-in-picture";
import { isBrowserSignedInPage } from "../browser-sign-in-page";
import type { BrowserViewClient } from "../browser-view-client";
import type { LocalSignInWindows } from "../local-sign-in-window";
import {
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserPreviewFromHost,
  decodeBrowserTab,
  decodeBrowserTabs,
} from "../remote-device-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseBrowserBounds,
  parseBrowserNavigate,
  parseBrowserOpen,
  parseLocalSignIn,
  parseLocalSignInFinish,
  parseVisibility,
} from "./browser-inputs";
import { eventHandler, eventPayloadHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
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
    | "stop"
    | "close"
    | "takeUserControl"
    | "releaseUserControl"
    | "listTabs"
    | "getDisplayState"
    | "getControlState"
    | "capturePreview"
    | "setVisible"
  >;
  remoteServers: Pick<RemoteServerManager, "activeServerId" | "supportsCapability" | "request">;
  browserView: Pick<BrowserViewClient, "start" | "stop" | "sendInput">;
  localSignIn: LocalSignInWindows;
}

export function browserIpcHandlers({
  browserPictureInPicture,
  browser,
  remoteServers,
  browserView,
  localSignIn,
}: BrowserIpcDependencies): Pick<IpcGroupHandlers, "browser" | "browserInput"> {
  // A window that closes cannot stop its live view any more, so the view stops when the window goes.
  const liveViewOwners = new WeakSet<WebContents>();
  const watchLiveViewOwner = (owner: WebContents) => {
    if (liveViewOwners.has(owner)) return;
    liveViewOwners.add(owner);
    owner.once("destroyed", () => void runCauseEffect(browserView.stop(owner.id)).catch(() => undefined));
  };
  // The frozen tab list has no field for a person's control or the history state, so a host that
  // can tell answers on its own routes, and its list marks the tabs here.
  const withUserControl = async (serverId: string, tabs: BrowserTab[]): Promise<BrowserTab[]> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_USER_CONTROL_CAPABILITY)) return tabs;
    const { tabIds } = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_USER_CONTROL_ROUTES.state, decodeBrowserUserControlSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const held = new Set(tabIds);
    return tabs.map((tab) => (held.has(tab.id) ? { ...tab, userControl: true } : tab));
  };
  const withPageState = async (serverId: string, tabs: BrowserTab[]): Promise<BrowserTab[]> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PAGE_STATE_CAPABILITY)) return tabs;
    const snapshot = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_PAGE_STATE_ROUTES.state, decodeBrowserPageStateSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const states = new Map(snapshot.tabs.map((state) => [state.tabId, state]));
    return tabs.map((tab) => {
      const state = states.get(tab.id);
      return state ? { ...tab, canGoBack: state.canGoBack, canGoForward: state.canGoForward } : tab;
    });
  };
  const withTabState = async (serverId: string, tabs: BrowserTab[]): Promise<BrowserTab[]> =>
    withPageState(serverId, await withUserControl(serverId, tabs));
  const userControlRequest = async (serverId: string, route: string, tabId: string): Promise<void> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_USER_CONTROL_CAPABILITY))
      throw new Error(sourceText("error.backend.browserUserControlUnsupported"));
    await runCauseEffect(
      remoteServers.request(serverId, route, decodeBrowserUserControlSnapshot, { method: "POST", body: { tabId } }),
    );
  };
  return {
    browser: {
      open: payloadHandler(parseBrowserOpen, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () =>
            runCauseEffect(
              browser.open(parsed.url, parsed.ownerThreadId ?? null, parsed.ownerAgentId ?? null, parsed.focus),
            ),
          remote: (serverId) =>
            runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.open, decodeBrowserTab, {
                method: "POST",
                body: parsed,
              }),
            ),
        }),
      ),
      activate: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.activate(tabId)),
          remote: (serverId) =>
            runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.activate, decodeVoid, {
                method: "POST",
                body: { tabId },
              }),
            ),
        }),
      ),
      navigate: payloadHandler(parseBrowserNavigate, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () =>
            "url" in parsed
              ? runCauseEffect(browser.loadUrl(parsed.tabId, parsed.url))
              : runCauseEffect(browser.navigate(parsed.tabId, parsed.direction)),
          remote: (serverId) => {
            if (!("url" in parsed)) {
              return runCauseEffect(
                remoteServers.request(serverId, TEAM_API_ROUTES.browser.navigate, decodeVoid, {
                  method: "POST",
                  body: parsed,
                }),
              );
            }
            // An older host has no route that moves an existing tab to an address. The renderer
            // opens a new tab for it instead, so this stays the error that tells it to.
            if (!remoteServers.supportsCapability(serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
              throw new Error(sourceText("error.backend.browserNavigateUnsupported"));
            }
            return runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.load, decodeVoid, {
                method: "POST",
                body: parsed,
              }),
            );
          },
        }),
      ),
      reload: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.reload(tabId)),
          remote: (serverId) =>
            runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.reload, decodeVoid, {
                method: "POST",
                body: { tabId },
              }),
            ),
        }),
      ),
      close: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.close(tabId)),
          remote: (serverId) =>
            runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.close, decodeVoid, {
                method: "POST",
                body: { tabId },
              }),
            ),
        }),
      ),
      stop: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.stop(tabId)),
          remote: async (serverId) => {
            if (!remoteServers.supportsCapability(serverId, BROWSER_PAGE_STATE_CAPABILITY))
              throw new Error(sourceText("error.backend.browserStopUnsupported"));
            await runCauseEffect(
              remoteServers.request(serverId, BROWSER_PAGE_STATE_ROUTES.stop, decodeBrowserPageStateSnapshot, {
                method: "POST",
                body: { tabId },
              }),
            );
          },
        }),
      ),
      // A sign-in on this computer for a tab of the active remote server. The local browser needs none.
      openLocalSignIn: payloadHandler(parseLocalSignIn, ({ tabId, url }) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => {
            throw new Error(sourceText("error.backend.browserSignInUnsupported"));
          },
          remote: (serverId) => {
            if (!remoteServers.supportsCapability(serverId, BROWSER_SIGN_IN_CAPABILITY))
              throw new Error(sourceText("error.backend.browserSignInUnsupported"));
            return runCauseEffect(localSignIn.open({ serverId, tabId }, url)).then((end) => ({
              signedIn: end === "signed-in",
            }));
          },
        }),
      ),
      // A failed send keeps the sign-in, so Done can try again. No sign-in found also keeps it, so the
      // person can finish it in the window. A checked send also keeps it while the server tab shows a
      // sign-in step; the host answers after the tab loaded again, so the tab list shows the result.
      // Some sites show their sign-in page again after the reload, so the tab first opens the page
      // that the window shows after the sign-in.
      finishLocalSignIn: payloadHandler(parseLocalSignInFinish, async ({ send, check }) => {
        const target = localSignIn.target();
        if (!send || !target) {
          await runCauseEffect(localSignIn.discard());
          return null;
        }
        const cookies = await runCauseEffect(localSignIn.collect());
        if (cookies.length === 0) return { cookies: 0, signedIn: false };
        const result = await runCauseEffect(
          remoteServers.request(target.serverId, BROWSER_SIGN_IN_ROUTES.import, decodeBrowserSignInResult, {
            method: "POST",
            body: { tabId: target.tabId, cookies },
          }),
        );
        if (result.cookies === 0) return { cookies: 0, signedIn: false };
        if (check) {
          const signedIn = async () => {
            const tabs = await runCauseEffect(
              remoteServers.request(target.serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs),
            );
            const tab = tabs.find((entry) => entry.id === target.tabId);
            return tab !== undefined && isBrowserSignedInPage(tab.url, target.host);
          };
          let done = await signedIn();
          const page = localSignIn.page();
          if (
            !done &&
            page &&
            isBrowserSignedInPage(page, target.host) &&
            remoteServers.supportsCapability(target.serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)
          ) {
            await runCauseEffect(
              remoteServers.request(target.serverId, TEAM_API_ROUTES.browser.load, decodeVoid, {
                method: "POST",
                body: { tabId: target.tabId, url: page },
              }),
            );
            done = await signedIn();
          }
          if (!done) return { cookies: result.cookies, signedIn: false };
        }
        await runCauseEffect(localSignIn.discard());
        return { cookies: result.cookies, signedIn: true };
      }),
      takeControl: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.takeUserControl(tabId, { kind: "local" })),
          remote: (serverId) => userControlRequest(serverId, BROWSER_USER_CONTROL_ROUTES.take, tabId),
        }),
      ),
      releaseControl: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.releaseUserControl(tabId),
          remote: (serverId) => userControlRequest(serverId, BROWSER_USER_CONTROL_ROUTES.release, tabId),
        }),
      ),
      listTabs: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.listTabs(),
          remote: async (serverId) =>
            withTabState(
              serverId,
              await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs)),
            ),
        }),
      ),
      getDisplayState: handler(() =>
        routeToServer<BrowserDisplayState>(remoteServers.activeServerId, {
          local: () => browser.getDisplayState(),
          remote: async (serverId) => {
            // Without the capability the host can only list tabs, and nothing on that list says
            // which one is in front. The first tab is the guess this route exists to replace.
            if (!remoteServers.supportsCapability(serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
              const tabs = await runCauseEffect(
                remoteServers.request(serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs),
              );
              return { tabs: await withTabState(serverId, tabs), activeTabId: tabs[0]?.id ?? null };
            }
            const display = await runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.display, decodeBrowserDisplayState),
            );
            return { ...display, tabs: await withTabState(serverId, display.tabs) };
          },
        }),
      ),
      getControlState: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => browser.getControlState(),
          remote: (serverId) =>
            runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.browser.control, decodeBrowserControlState)),
        }),
      ),
      capturePreview: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.capturePreview(tabId)),
          remote: (serverId) =>
            runCauseEffect(
              remoteServers.request(serverId, TEAM_API_ROUTES.browser.preview, decodeBrowserPreviewFromHost, {
                method: "POST",
                body: { tabId },
              }),
            ),
        }),
      ),
      // Visibility is a local placement, not a remote operation, so a host's tab is left alone. The
      // bounds are this window's CSS rectangle, and the host's browser is a native view on the
      // host's own screen: forwarding them mounted a page over whoever is sitting at that computer,
      // at coordinates that mean nothing there, and still showed the remote user nothing.
      // `/v1/browser/visible` stays served for the clients that already send it.
      setVisible: payloadHandler(parseVisibility, async (parsed) => {
        if (remoteServers.activeServerId === LOCAL_SERVER_ID) await runCauseEffect(browser.setVisible(parsed));
      }),
      // A local tab is a native view on this screen already; only a host's tab needs its pixels sent.
      // The window that asks owns the view: the main window and Picture in Picture can both show one.
      startLiveView: eventPayloadHandler(stringPayload("tabId"), (event, tabId) => {
        watchLiveViewOwner(event.sender);
        return runCauseEffect(browserView.start(tabId, event.sender.id));
      }),
      stopLiveView: eventHandler((event) => runCauseEffect(browserView.stop(event.sender.id))),
      // A host's tab is not a native view on this screen, so the window draws it from the live view.
      openPictureInPicture: payloadHandler(optionalPayload(parseBrowserBounds), (bounds) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browserPictureInPicture.open(bounds)),
          remote: (serverId) =>
            runCauseEffect(
              browserPictureInPicture.open(
                bounds,
                remoteServers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CAPABILITY)
                  ? { clipboard: remoteServers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY) }
                  : undefined,
              ),
            ),
        }),
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
