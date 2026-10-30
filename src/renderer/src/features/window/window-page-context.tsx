import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUsage } from "../usage/usage-context";

/** The pages of the window rail. Each one fills the card below the top row. */
export type WindowPage =
  | "agents"
  | "tasks"
  | "schedule"
  | "workflows"
  | "usage"
  | "marketplace"
  | "settings"
  | "server-settings";

/**
 * How a page sits in the window. The tasks page shows in the middle pane, as the agents do. The agent
 * list beside it is hidden until the user shows it. A settings page starts below the top row. The title of a schedule, workflows, usage or
 * Marketplace page goes in the top row after the server menu.
 */
export type WindowPageKind = "agents" | "settings" | "titled";

export function windowPageKind(page: WindowPage): WindowPageKind {
  if (page === "settings" || page === "server-settings") return "settings";
  return page === "agents" || page === "tasks" ? "agents" : "titled";
}

/** The settings pages: the settings of the user, or the settings of one server. */
export type SettingsKind = "personal" | "server";

/**
 * The page of the desktop window, from the state that already opens each page: the settings flags,
 * the Marketplace flag and the host pane of `usage-context`. Every opener keeps its call, and this provider joins them.
 *
 * The user settings and the server settings are two pages. An opener of one closes the other. When
 * the user selects another server, the server settings page follows it.
 *
 * It sits above `ServerScopeBoundary`: the boundary rebuilds everything below it on a server switch,
 * so only a provider above it can see the switch.
 */
const context = createSimpleContext({
  name: "WindowPageProvider",
  init: () => {
    const settings = useSettings();
    const serverSettings = useServerSettings();
    const usage = useUsage();
    const { activeServerId } = useServers();
    /** The elements of the settings page that the settings panel shows in. The page sets them. */
    const [settingsMounts, setSettingsMounts] = createSignal<{ nav: HTMLElement; content: HTMLElement } | undefined>();

    const page = createMemo<WindowPage>(() => {
      if (serverSettings.serverSettingsOpen()) return "server-settings";
      if (settings.appSettingsOpen()) return "settings";
      if (settings.skillsMarketplaceOpen()) return "marketplace";
      return usage.state.serverId ? usage.state.view : "agents";
    });

    /** Whether the agent list shows beside the Tasks page. Each time the page opens, the list is hidden. */
    const [tasksAgentsOpen, setTasksAgentsOpen] = createSignal(false);
    createEffect(page, (next) => {
      if (next !== "tasks") setTasksAgentsOpen(false);
    });

    // Opening the user settings closes the server settings, the Marketplace and the host pane.
    createEffect(settings.appSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    // Opening the server settings closes the user settings, the Marketplace and the host pane.
    createEffect(serverSettings.serverSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
    });

    // An open host pane closes the settings pages and the Marketplace, so the rail shows one page.
    createEffect(
      () => usage.state.serverId,
      (serverId) => {
        if (!serverId) return;
        if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
        if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
        if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      },
    );

    // Opening the Marketplace closes the settings pages and the host pane.
    createEffect(settings.skillsMarketplaceOpen, (open) => {
      if (!open) return;
      usage.dismissUsage();
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    // The server settings page follows the server that the user selects.
    createEffect(activeServerId, (serverId, previous) => {
      if (previous === undefined || serverId === previous || !serverId) return;
      // An effect calls this, and the opener reads the state of the server settings.
      if (untrack(serverSettings.serverSettingsOpen)) untrack(() => serverSettings.openServerSettings(serverId, null));
    });

    /** Where the panel of a settings page shows, or nothing while that page is not on screen. */
    function settingsPlacement(kind: SettingsKind): SettingsPagePlacement | undefined {
      const mounts = settingsMounts();
      if (!mounts || page() !== (kind === "personal" ? "settings" : "server-settings")) return undefined;
      return mounts;
    }

    return {
      page,
      /** Whether a page other than the agents covers the conversation. A message there is not seen. */
      conversationCovered: () => page() !== "agents",
      tasksAgentsOpen: () => page() === "tasks" && tasksAgentsOpen(),
      setTasksAgentsOpen: (open: boolean) => setTasksAgentsOpen(open),
      setSettingsMounts,
      settingsPlacement,
      /** Shows the agents and closes the other pages. */
      showAgents() {
        settings.setAppSettingsOpen(false);
        serverSettings.setServerSettingsOpen(false);
        settings.setSkillsMarketplaceOpen(false);
        usage.dismissUsage();
      },
      openTasks(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openTasks(serverId, source);
      },
      openSchedule(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openSchedule(serverId, source);
      },
      openWorkflows(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openWorkflows(serverId, source);
      },
      openUsage(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openUsage(serverId, source);
      },
      openSettings(source: HTMLElement | null) {
        settings.openAppSettings(source);
      },
    };
  },
});

export const WindowPageProvider = context.provider;
export const useWindowPage = context.use;
