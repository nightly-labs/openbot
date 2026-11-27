import {
  type BrowserDisplayState,
  type BrowserTab,
  type BrowserTeachStep,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_HTTP_SIGN_IN_CAPABILITY,
  BROWSER_HTTP_SIGN_IN_ROUTES,
  decodeBrowserHttpSignInSnapshot,
} from "@openbot/contracts/team-protocol/browser-http-sign-in-v1";
import {
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PAGE_STATE_ROUTES,
  decodeBrowserPageStateSnapshot,
} from "@openbot/contracts/team-protocol/browser-page-state-v1";
import {
  BROWSER_PERMISSIONS_CAPABILITY,
  BROWSER_PERMISSIONS_ROUTES,
  decodeBrowserPermissionAnswer,
  decodeBrowserPermissionsSnapshot,
} from "@openbot/contracts/team-protocol/browser-permissions-v1";
import {
  BROWSER_SIGN_IN_STORAGE_CAPABILITY,
  BROWSER_SIGN_IN_STORAGE_ROUTES,
  decodeBrowserSignInStorageResult,
} from "@openbot/contracts/team-protocol/browser-sign-in-storage-v1";
import {
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_SIGN_IN_ROUTES,
  decodeBrowserSignInResult,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import {
  BROWSER_TEACH_CAPABILITY,
  BROWSER_TEACH_ROUTES,
  decodeBrowserTeachSteps,
} from "@openbot/contracts/team-protocol/browser-teach-v1";
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
import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { BrowserHost } from "../../backend/browser-host";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BrowserPictureInPicture } from "../browser-picture-in-picture";
import { isBrowserSignedInPage } from "../browser-sign-in-page";
import type { BrowserViewClient } from "../browser-view-client";
import type { DetachedBrowserWindow } from "../detached-browser-window";
import type { LocalSignInWindows } from "../local-sign-in-window";
import {
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserPreviewFromHost,
  decodeBrowserTab,
  decodeBrowserTabs,
} from "../remote-device-decoding";
import { acceptEmpty, decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseBrowserBounds,
  parseBrowserNavigate,
  parseBrowserOpen,
  parseBrowserTeachStop,
  parseBrowserWindowAction,
  parseBrowserWindowModel,
  parseHttpSignInAnswer,
  parseLocalSignIn,
  parseLocalSignInFinish,
  parseVisibility,
} from "./browser-inputs";
import {
  authorizedHandler,
  eventHandler,
  eventPayloadHandler,
  handler,
  type IpcGroupHandlers,
  payloadHandler,
} from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { optionalPayload, stringPayload } from "./validation";

export interface BrowserIpcDependencies {
  browserPictureInPicture: Pick<BrowserPictureInPicture, "open" | "close" | "dock" | "hide">;
  detachedBrowserWindow: Pick<
    DetachedBrowserWindow,
    | "open"
    | "close"
    | "focus"
    | "dock"
    | "publishModel"
    | "model"
    | "sendAction"
    | "requireMainRenderer"
    | "requireWindowRenderer"
  >;
  browser: Pick<
    BrowserHost,
    | "open"
    | "activate"
    | "loadUrl"
    | "navigate"
    | "reload"
    | "stop"
    | "answerPermission"
    | "close"
    | "takeUserControl"
    | "releaseUserControl"
    | "startTeach"
    | "stopTeach"
    | "listTabs"
    | "getDisplayState"
    | "getControlState"
    | "capturePreview"
    | "setVisible"
    | "answerHttpSignIn"
  >;
  remoteServers: Pick<RemoteServerManager, "activeServerId" | "supportsCapability" | "request">;
  browserView: Pick<BrowserViewClient, "start" | "stop" | "sendInput">;
  localSignIn: LocalSignInWindows;
}

export function browserIpcHandlers({
  browserPictureInPicture,
  detachedBrowserWindow,
  browser,
  remoteServers,
  browserView,
  localSignIn,
}: BrowserIpcDependencies): Pick<IpcGroupHandlers, "browser" | "browserInput"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) => detachedBrowserWindow.requireMainRenderer(event.sender.id);
  const fromBrowserWindow = (event: IpcMainInvokeEvent) => detachedBrowserWindow.requireWindowRenderer(event.sender.id);
  const liveViewOwners = new WeakSet<WebContents>();
  const watchLiveViewOwner = (owner: WebContents) => {
    if (liveViewOwners.has(owner)) return;
    liveViewOwners.add(owner);
    owner.once("destroyed", () => void runCauseEffect(browserView.stop(owner.id)).catch(() => undefined));
  };
  type TabUpdate = (tab: BrowserTab) => BrowserTab;
  const keepTab: TabUpdate = (tab) => tab;
  const userControlUpdate = async (serverId: string): Promise<TabUpdate> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_USER_CONTROL_CAPABILITY)) return keepTab;
    const { tabIds } = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_USER_CONTROL_ROUTES.state, decodeBrowserUserControlSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const held = new Set(tabIds);
    return (tab) => (held.has(tab.id) ? { ...tab, userControl: true } : tab);
  };
  const pageStateUpdate = async (serverId: string): Promise<TabUpdate> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PAGE_STATE_CAPABILITY)) return keepTab;
    const snapshot = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_PAGE_STATE_ROUTES.state, decodeBrowserPageStateSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const states = new Map(snapshot.tabs.map((state) => [state.tabId, state]));
    return (tab) => {
      const state = states.get(tab.id);
      return state ? { ...tab, canGoBack: state.canGoBack, canGoForward: state.canGoForward } : tab;
    };
  };
  const permissionsUpdate = async (serverId: string): Promise<TabUpdate> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PERMISSIONS_CAPABILITY)) return keepTab;
    const snapshot = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_PERMISSIONS_ROUTES.state, decodeBrowserPermissionsSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const requests = new Map(snapshot.requests.map((request) => [request.tabId, request]));
    return (tab) => {
      const request = requests.get(tab.id);
      return request
        ? { ...tab, permissionRequest: { id: request.id, origin: request.origin, permission: request.permission } }
        : tab;
    };
  };
  const httpSignInUpdate = async (serverId: string): Promise<TabUpdate> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_HTTP_SIGN_IN_CAPABILITY)) return keepTab;
    const snapshot = await runCauseEffect(
      remoteServers.request(serverId, BROWSER_HTTP_SIGN_IN_ROUTES.state, decodeBrowserHttpSignInSnapshot, {
        method: "POST",
        body: {},
      }),
    );
    const prompts = new Map(snapshot.tabs.map((prompt) => [prompt.tabId, prompt]));
    return (tab) => {
      const prompt = prompts.get(tab.id);
      return prompt
        ? { ...tab, httpSignIn: { origin: prompt.origin, ...(prompt.refused ? { refused: true } : {}) } }
        : tab;
    };
  };
  const withTabState = async (serverId: string, tabs: BrowserTab[]): Promise<BrowserTab[]> => {
    const updates = await Promise.all([
      userControlUpdate(serverId),
      pageStateUpdate(serverId),
      permissionsUpdate(serverId),
      httpSignInUpdate(serverId),
    ]);
    return tabs.map((tab) => updates.reduce((updated, update) => update(updated), tab));
  };
  const userControlRequest = async (serverId: string, route: string, tabId: string): Promise<void> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_USER_CONTROL_CAPABILITY))
      throw new Error(sourceText("error.backend.browserUserControlUnsupported"));
    await runCauseEffect(
      remoteServers.request(serverId, route, decodeBrowserUserControlSnapshot, { method: "POST", body: { tabId } }),
    );
  };
  const openSignedInPageOnServer = async (target: { serverId: string; tabId: string; host: string }) => {
    const page = localSignIn.page();
    if (!page || !isBrowserSignedInPage(page, target.host)) return;
    if (!remoteServers.supportsCapability(target.serverId, TEAM_BROWSER_NAVIGATION_CAPABILITY)) return;
    const tabs = await runCauseEffect(
      remoteServers.request(target.serverId, TEAM_API_ROUTES.browser.tabs, decodeBrowserTabs),
    );
    const tab = tabs.find((entry) => entry.id === target.tabId);
    if (!tab || isBrowserSignedInPage(tab.url, target.host)) return;
    await runCauseEffect(
      remoteServers.request(target.serverId, TEAM_API_ROUTES.browser.load, decodeVoid, {
        method: "POST",
        body: { tabId: target.tabId, url: page },
      }),
    );
  };
  const teachRequest = async <Result>(
    serverId: string,
    route: string,
    decode: (value: unknown) => Result,
    body: { tabId: string; save?: boolean },
  ): Promise<Result> => {
    if (!remoteServers.supportsCapability(serverId, BROWSER_TEACH_CAPABILITY))
      throw new Error(sourceText("error.backend.browserTeachUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decode, { method: "POST", body }));
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
      answerPermission: payloadHandler(decodeBrowserPermissionAnswer, (answer) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.answerPermission(answer)),
          remote: async (serverId) => {
            if (!remoteServers.supportsCapability(serverId, BROWSER_PERMISSIONS_CAPABILITY))
              throw new Error(sourceText("error.backend.browserPermissionsUnsupported"));
            await runCauseEffect(
              remoteServers.request(serverId, BROWSER_PERMISSIONS_ROUTES.answer, decodeBrowserPermissionsSnapshot, {
                method: "POST",
                body: answer,
              }),
            );
          },
        }),
      ),
      answerHttpSignIn: payloadHandler(parseHttpSignInAnswer, (answer) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.answerHttpSignIn(answer)),
          remote: async (serverId) => {
            if (!remoteServers.supportsCapability(serverId, BROWSER_HTTP_SIGN_IN_CAPABILITY))
              throw new Error(sourceText("error.backend.browserHttpSignInUnsupported"));
            await runCauseEffect(
              remoteServers.request(serverId, BROWSER_HTTP_SIGN_IN_ROUTES.answer, decodeBrowserHttpSignInSnapshot, {
                method: "POST",
                body: answer,
              }),
            );
          },
        }),
      ),
      openLocalSignIn: payloadHandler(parseLocalSignIn, ({ tabId, url }) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => {
            throw new Error(sourceText("error.backend.browserSignInUnsupported"));
          },
          remote: (serverId) => {
            if (!remoteServers.supportsCapability(serverId, BROWSER_SIGN_IN_CAPABILITY))
              throw new Error(sourceText("error.backend.browserSignInUnsupported"));
            return runCauseEffect(localSignIn.open({ serverId, tabId }, url)).then(() => ({ signedIn: false }));
          },
        }),
      ),
      finishLocalSignIn: payloadHandler(parseLocalSignInFinish, async ({ send }) => {
        const target = localSignIn.target();
        if (!send || !target) {
          await runCauseEffect(localSignIn.discard());
          return null;
        }
        const cookies = await runCauseEffect(localSignIn.collect());
        const withStorage = remoteServers.supportsCapability(target.serverId, BROWSER_SIGN_IN_STORAGE_CAPABILITY);
        const storage = withStorage ? await runCauseEffect(localSignIn.collectStorage()) : null;
        if (cookies.length === 0 && !storage?.entries.length) return { cookies: 0, signedIn: false };
        const set = withStorage
          ? await runCauseEffect(
              remoteServers.request(
                target.serverId,
                BROWSER_SIGN_IN_STORAGE_ROUTES.import,
                decodeBrowserSignInStorageResult,
                { method: "POST", body: { tabId: target.tabId, cookies, storage } },
              ),
            ).then((result) => result.cookies + result.storage)
          : await runCauseEffect(
              remoteServers.request(target.serverId, BROWSER_SIGN_IN_ROUTES.import, decodeBrowserSignInResult, {
                method: "POST",
                body: { tabId: target.tabId, cookies },
              }),
            ).then((result) => result.cookies);
        if (set === 0) return { cookies: 0, signedIn: false };
        await openSignedInPageOnServer(target);
        await runCauseEffect(localSignIn.discard());
        return { cookies: set, signedIn: true };
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
      startTeach: payloadHandler(stringPayload("tabId"), (tabId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => runCauseEffect(browser.startTeach(tabId, { kind: "local" })),
          remote: (serverId) => teachRequest(serverId, BROWSER_TEACH_ROUTES.start, acceptEmpty, { tabId }),
        }),
      ),
      stopTeach: payloadHandler(parseBrowserTeachStop, (input) =>
        routeToServer<BrowserTeachStep[]>(remoteServers.activeServerId, {
          local: () => browser.stopTeach(input.tabId, { kind: "local" }, input.save),
          remote: (serverId) => teachRequest(serverId, BROWSER_TEACH_ROUTES.stop, decodeBrowserTeachSteps, input),
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
      setVisible: payloadHandler(parseVisibility, async (parsed) => {
        if (remoteServers.activeServerId === LOCAL_SERVER_ID) await runCauseEffect(browser.setVisible(parsed));
      }),
      startLiveView: eventPayloadHandler(stringPayload("tabId"), (event, tabId) => {
        watchLiveViewOwner(event.sender);
        return runCauseEffect(browserView.start(tabId, event.sender.id));
      }),
      stopLiveView: eventHandler((event) => runCauseEffect(browserView.stop(event.sender.id))),
      openPictureInPicture: payloadHandler(optionalPayload(parseBrowserBounds), (bounds) => {
        detachedBrowserWindow.close();
        return routeToServer(remoteServers.activeServerId, {
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
        });
      }),
      closePictureInPicture: handler(() => browserPictureInPicture.close()),
      dockPictureInPicture: handler(() => browserPictureInPicture.dock()),
      hidePictureInPicture: handler(() => browserPictureInPicture.hide()),
      openWindow: payloadHandler(optionalPayload(parseBrowserBounds), (bounds) => {
        browserPictureInPicture.close();
        return runCauseEffect(detachedBrowserWindow.open(bounds));
      }),
      closeWindow: handler(() => detachedBrowserWindow.close()),
      focusWindow: handler(() => detachedBrowserWindow.focus()),
      dockWindow: eventHandler((event) => detachedBrowserWindow.dock(event.sender.id)),
      publishWindowModel: authorizedHandler(fromMainRenderer, parseBrowserWindowModel, (_event, model) =>
        detachedBrowserWindow.publishModel(model),
      ),
      getWindowModel: eventHandler((event) => detachedBrowserWindow.model(event.sender.id)),
      sendWindowAction: authorizedHandler(fromBrowserWindow, parseBrowserWindowAction, (_event, action) =>
        detachedBrowserWindow.sendAction(action),
      ),
    },
    browserInput: {
      sendLiveViewInput: payloadHandler(decodeBrowserViewInputValue, async (input) => browserView.sendInput(input)),
    },
  };
}
