import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { ServerMenu } from "@openbot/ui/features/servers/ServerMenu";
import { PageRail, type PageRailPage } from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { WorkflowsPage } from "../../lazy-views";
import { usePlatform } from "../../platform";
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

export function WorkspacePageRail(props: { hidden: boolean }) {
  const text = useText();
  const windowPage = useWindowPage();
  const { openAppSettings, setSkillsMarketplaceOpen, setPendingPluginSlug, setPendingPluginConnect } = useSettings();
  const usage = useUsage();
  const updates = useUpdates();
  const layout = useLayout();
  const whatsNew = useWhatsNew();
  const { activeServer } = useServers();
  const platform = usePlatform();
  const serverActions = useServerActions();
  const { openServerSettings, serverSettingsTarget, serverSettingsShownSection } = useServerSettings();
  const logo = () => {
    const info = platform.appInfo();
    return info && info.platform !== "darwin" ? { variant: info.variant } : undefined;
  };
  const usageRows = usePlanLimitRows();
  const mediaCredits = createWorkflowMediaCredits(
    () => (windowPage.page() === "workflows" ? usage.state.serverId : null),
    desktopMediaCredits,
  );
  const { customAgentUsage } = useCustomAgents();
  const localAgentUsage = () => (activeServer()?.kind === "local" ? customAgentUsage() : []);
  const updateNotice = () => {
    const phase = updates.status().phase;
    if (!layout.leftPanelCompact() || !isUpdateActivePhase(phase)) return undefined;
    return text.t(phase === "ready" || phase === "installing" ? "account.update.ready" : "account.update.available");
  };
  const tasksAvailable = () => {
    const server = activeServer();
    return !server || server.kind === "local" || serverSupportsCapability(server, AGENT_TASKS_CAPABILITY);
  };
  const openProviders = () => {
    const server = activeServer();
    if (!server || !activeServerHasProviderSettings(server)) return undefined;
    return (button: HTMLElement) => openServerSettings(server.id, button, "providers");
  };
  const crmShown = () => serverCanAdminister(activeServer(), CRM_CAPABILITY) && usage.crmEnabled() === true;
  function crmRailAction(): ((button: HTMLElement) => void) | undefined {
    return crmShown() ? windowPage.openCrm : undefined;
  }
  function creditsRailAction(): (() => void) | undefined {
    return windowPage.creditsAvailable() ? () => windowPage.openCredits(null) : undefined;
  }
  function crmConnectorsAction(): ((button: HTMLElement) => void) | undefined {
    if (!crmShown()) return undefined;
    return (button) => windowPage.openCrm(button, true);
  }
  const current = (): PageRailPage | null => {
    const page = windowPage.page();
    if (page === "agents") return "agents";
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
      onAgents={() => windowPage.showAgents()}
      onWorkflows={() => windowPage.openWorkflows(null)}
      onPreloadWorkflows={() => void WorkflowsPage.preload()}
      onSchedule={windowPage.openSchedule}
      onTasks={tasksAvailable() ? windowPage.openTasks : undefined}
      onUsage={windowPage.openUsage}
      onLibrary={serverHasStorage(activeServer()) ? windowPage.openLibrary : undefined}
      onProviders={openProviders()}
      onCrm={crmRailAction()}
      onCrmConnectors={crmConnectorsAction()}
      onCredits={creditsRailAction()}
      creditBalance={windowPage.creditsMenu().state?.balance}
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
            credits={windowPage.creditsMenu()}
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
