import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { ServerMenu } from "@openbot/ui/features/servers/ServerMenu";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { PageRail, type PageRailPage } from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { WorkflowsPage } from "../../lazy-views";
import { usePlatform } from "../../platform";
import { useChannels } from "../channels/channels-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { serverHasStorage } from "../files/storage-usage";
import { useServerActions } from "../servers/server-actions";
import {
  activeServerHasProviderSettings,
  serverCanAdminister,
  serverSupportsCapability,
} from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUpdates } from "../updates/updates-context";
import { useWhatsNew } from "../updates/whats-new-context";
import { usePlanLimitRows } from "../usage/plan-limit-rows";
import { useUsage } from "../usage/usage-context";
import { createWorkflowMediaCredits } from "../workflows/workflow-media-credits";
import { desktopMediaCredits } from "../workflows/workflows-port";
import { RailHelpMenu } from "./RailHelpMenu";
import { useWindowPage } from "./window-page-context";

/**
 * The page rail of the desktop window. Agents, Routines, Workflows, Schedule, Usage, Library,
 * Providers, CRM, Marketplace and Settings change the page in the card. The menu of the open server is below Settings,
 * so it shows on each page.
 */
export function WorkspacePageRail(props: { hidden: boolean }) {
  const text = useText();
  const windowPage = useWindowPage();
  const { openAppSettings, setSkillsMarketplaceOpen, setPendingPluginSlug, setPendingPluginConnect } = useSettings();
  const usage = useUsage();
  const updates = useUpdates();
  const layout = useLayout();
  const channels = useChannels();
  const whatsNew = useWhatsNew();
  const { activeServer } = useServers();
  const platform = usePlatform();
  const serverActions = useServerActions();
  const { openServerSettings, serverSettingsTarget, serverSettingsShownSection } = useServerSettings();
  /** macOS draws the window buttons in the top row of the rail. Windows and Linux show the logo there. */
  const logo = () => {
    const info = platform.appInfo();
    return info && info.platform !== "darwin" ? { variant: info.variant } : undefined;
  };
  /** Agents and Routines show the same page; they set the list of the sidebar. */
  function showSidebarView(view: SidebarView) {
    windowPage.showAgents();
    // An open channel would stay in the middle with no row in the list.
    if (view === "routines") channels.close();
    layout.setSidebarView(view);
  }
  const usageRows = usePlanLimitRows();
  /** The Sunra and Higgsfield credits of the server that the Canvas page shows. Other pages do not read them. */
  const mediaCredits = createWorkflowMediaCredits(
    () => (windowPage.page() === "workflows" ? usage.state.serverId : null),
    desktopMediaCredits,
  );
  const { customAgentUsage } = useCustomAgents();
  /** The custom agents run on this computer, so a joined server does not show their usage. */
  const localAgentUsage = () => (activeServer()?.kind === "local" ? customAgentUsage() : []);
  /** The compact sidebar has no footer, so the update island does not show. The Settings button then marks the update. */
  const updateNotice = () => {
    const phase = updates.status().phase;
    if (!layout.leftPanelCompact() || !isUpdateActivePhase(phase)) return undefined;
    return text.t(phase === "ready" || phase === "installing" ? "account.update.ready" : "account.update.available");
  };
  // An older joined server has no task routes.
  const tasksAvailable = () => {
    const server = activeServer();
    return !server || server.kind === "local" || serverSupportsCapability(server, AGENT_TASKS_CAPABILITY);
  };
  /** Server Settings > Providers of this computer, or of a joined server that this account administers. */
  const openProviders = () => {
    const server = activeServer();
    if (!server || !activeServerHasProviderSettings(server)) return undefined;
    return (button: HTMLElement) => openServerSettings(server.id, button, "providers");
  };
  /**
   * Only an owner or admin reads the CRM, an older joined server has no CRM routes, and the CRM shows
   * only while Server Settings > Experimental turns it on.
   */
  const crmShown = () => serverCanAdminister(activeServer(), CRM_CAPABILITY) && usage.crmEnabled() === true;
  /** The CRM button of the page rail. A named function, not a ternary prop. */
  function crmRailAction(): ((button: HTMLElement) => void) | undefined {
    return crmShown() ? windowPage.openCrm : undefined;
  }
  /** The Connectors item of the CRM button's right-click menu, where the CRM button shows. */
  function crmConnectorsAction(): ((button: HTMLElement) => void) | undefined {
    if (!crmShown()) return undefined;
    return (button) => windowPage.openCrm(button, true);
  }
  const current = (): PageRailPage | null => {
    const page = windowPage.page();
    if (page === "agents") return layout.sidebarView();
    if (page === "server-settings") {
      const providers =
        serverSettingsShownSection() === "providers" && serverSettingsTarget()?.id === activeServer()?.id;
      return providers ? "providers" : null;
    }
    return page === "pricing" ? null : page;
  };
  return (
    <PageRail
      hidden={props.hidden}
      current={current()}
      pinned={layout.railPinned()}
      onPinChange={layout.setRailPinned}
      usageRows={usageRows()}
      customAgentUsage={localAgentUsage()}
      mediaCredits={mediaCredits()}
      onMediaCredits={(provider) => {
        windowPage.leavePricing();
        setPendingPluginConnect(false);
        setPendingPluginSlug(provider);
        setSkillsMarketplaceOpen(true);
      }}
      onAgents={() => showSidebarView("agents")}
      onRoutines={() => showSidebarView("routines")}
      // A joined server without workflows shows its notice on the page.
      onWorkflows={() => windowPage.openWorkflows(null)}
      onPreloadWorkflows={() => void WorkflowsPage.preload()}
      onSchedule={windowPage.openSchedule}
      onTasks={tasksAvailable() ? windowPage.openTasks : undefined}
      onUsage={windowPage.openUsage}
      // An older joined server has no storage routes, so it has no Library.
      onLibrary={serverHasStorage(activeServer()) ? windowPage.openLibrary : undefined}
      onProviders={openProviders()}
      onCrm={crmRailAction()}
      onCrmConnectors={crmConnectorsAction()}
      onMarketplace={() => {
        windowPage.leavePricing();
        setSkillsMarketplaceOpen(true);
      }}
      onSettings={(button) => (updateNotice() ? openAppSettings(button, "updates") : windowPage.openSettings(button))}
      settingsNotice={updateNotice()}
      logo={logo()}
      server={
        <Show when={platform.appInfo()}>
          <ServerMenu
            rail
            serverName={activeServer()?.name ?? text.t("sidebar.topbar.localServer")}
            servers={serverActions.orderedServers()}
            view={layout.serverView()}
            onViewChange={layout.setServerView}
            onSelect={serverActions.select}
            onAdd={serverActions.add}
            onCreateLocal={serverActions.addMenuCreateLocal()}
            onInstallServer={serverActions.addMenuInstallServer()}
            addCreatesServer={serverActions.addCreatesServer()}
            hiddenLocal={serverActions.hiddenLocal()}
            {...serverActions.callbacks}
          />
        </Show>
      }
      help={
        <RailHelpMenu
          version={whatsNew.state.version}
          onOpenWhatsNew={whatsNew.reopen}
          onOpenLink={(destination) => void appPort().openExternal(destination)}
        />
      }
    />
  );
}
