import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY,
  TEAM_BROWSER_VIEW_CURSOR_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import {
  decodeMobileBrowserTab,
  decodeMobileBrowserTabs,
  withBrowserTab,
  withoutBrowserTab,
} from "@/features/browser/model/browser-tabs";
import { BROWSER_VIEW_PAGE_SIZE } from "@/features/browser/model/browser-view-bridge";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import type { WorkspaceRequest } from "@/features/workspace/context/host-request-actions";
import type { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import { type ServerCapabilities, supportsBrowserView } from "@/features/workspace/model/server-capabilities";
import { ignoreResponse } from "@/features/workspace/model/workspace-records";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

/** The live view and the tab controls of a host's browser, through the released `browser-control` routes. */
export function createBrowserActions({
  request,
  liveState,
  client,
  capabilities,
}: {
  request: WorkspaceRequest;
  liveState: LiveWorkspaceStore;
  /** The connected peer of a server, or undefined while it is not connected. */
  client: (serverId: string) => RemoteTeamTransportRef | undefined;
  capabilities: ServerCapabilities;
}): Pick<MobileWorkspaceContextValue, "browserViewSupport" | "openBrowserView" | "controlBrowserTab"> {
  return {
    browserViewSupport: (serverId) => {
      const advertised = capabilities.get(serverId) ?? [];
      const view = supportsBrowserView(advertised);
      return {
        view,
        clipboard: view && advertised.includes(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY),
        contextMenu: view && advertised.includes(TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY),
        viewport: view && advertised.includes(TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY),
        navigation: view && advertised.includes(TEAM_BROWSER_NAVIGATION_CAPABILITY),
      };
    },
    openBrowserView: (serverId, tabId, listener) => {
      const peer = client(serverId);
      const advertised = capabilities.get(serverId) ?? [];
      if (!peer || !supportsBrowserView(advertised)) return null;
      return peer.openBrowserView(
        {
          tabId,
          namesFrames: advertised.includes(TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY),
          cursor: advertised.includes(TEAM_BROWSER_VIEW_CURSOR_CAPABILITY),
          clipboard: advertised.includes(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY),
          contextMenu: advertised.includes(TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY),
          viewport: advertised.includes(TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY) ? BROWSER_VIEW_PAGE_SIZE : null,
        },
        listener,
      );
    },
    controlBrowserTab: async (serverId, action) => {
      // The host also sends `browser-changed` for an open or a close. The phone does not wait for
      // it: the tab list changes at once, and is read again in case the event does not arrive.
      const readTabs = () =>
        void request("GET", TEAM_API_ROUTES.browser.tabs, decodeMobileBrowserTabs, undefined, serverId)
          .then((tabs) =>
            liveState.update("browserTabs", (current) => ({
              ...current,
              [serverId]: { tabs, activeTabId: current[serverId]?.activeTabId ?? null },
            })),
          )
          .catch(() => undefined);
      if (action.type === "open") {
        // The desktop opens a new tab for the agent in the same way. `focus` stays false: the
        // phone does not move the host's own browser to the tab.
        const opened = await request(
          "POST",
          TEAM_API_ROUTES.browser.open,
          decodeMobileBrowserTab,
          { url: action.url, ownerThreadId: action.ownerThreadId, ownerAgentId: action.ownerAgentId, focus: false },
          serverId,
        );
        liveState.update("browserTabs", (current) => ({
          ...current,
          [serverId]: withBrowserTab(current[serverId], opened),
        }));
        readTabs();
        return opened;
      }
      if (action.type === "navigate") {
        const body = { tabId: action.tabId, direction: action.direction };
        await request("POST", TEAM_API_ROUTES.browser.navigate, ignoreResponse, body, serverId);
      } else if (action.type === "load") {
        // Behind `browser-navigation`: the screen opens a new tab on a host without it.
        const body = { tabId: action.tabId, url: action.url };
        await request("POST", TEAM_API_ROUTES.browser.load, ignoreResponse, body, serverId);
      } else if (action.type === "reload") {
        await request("POST", TEAM_API_ROUTES.browser.reload, ignoreResponse, { tabId: action.tabId }, serverId);
      } else {
        await request("POST", TEAM_API_ROUTES.browser.close, ignoreResponse, { tabId: action.tabId }, serverId);
        liveState.update("browserTabs", (current) => ({
          ...current,
          [serverId]: withoutBrowserTab(current[serverId], action.tabId),
        }));
        readTabs();
      }
      return null;
    },
  };
}
