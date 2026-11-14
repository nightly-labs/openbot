import { useText } from "@openbot/ui/text";
import { Loading, Match, Show, Switch } from "solid-js";
import { AgentUsagePanel, LibraryPanel, WorkflowsPage } from "../../lazy-views";
import { SkillsMarketplace } from "../../WorkspaceOverlays";
import { SchedulePanel } from "../schedule/SchedulePanel";
import { useServers } from "../servers/servers-context";
import { UsageMachine } from "../usage/UsageMachine";
import { useUsage } from "../usage/usage-context";
import { SettingsPage } from "./SettingsPage";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/**
 * The page of the desktop window that covers the conversation: a settings page, usage, schedule,
 * workflows, the Library, the Marketplace or the pricing page. The tasks page shows in the middle pane, in `WorkspaceShell`.
 */
export function WindowPageView() {
  const { t } = useText();
  const windowPage = useWindowPage();
  const usage = useUsage();
  const { servers } = useServers();
  const settingsKind = (): SettingsKind | null => {
    const page = windowPage.page();
    if (page === "settings") return "personal";
    return page === "server-settings" ? "server" : null;
  };
  const hostName = (serverId: string) =>
    servers().find((server) => server.id === serverId)?.name ?? t("app.page.serverFallback");
  return (
    <Show
      when={windowPage.page() !== "pricing"}
      // The add-server flow shows its pricing page here (`AddServerOverlay`).
      fallback={<div class="window-page-portal" ref={windowPage.setPricingMount} />}
    >
      <Show
        when={settingsKind() ? null : usage.state.serverId}
        fallback={
          <Show when={settingsKind()} keyed fallback={<SkillsMarketplace />}>
            {(kind) => <SettingsPage kind={kind} />}
          </Show>
        }
      >
        {(serverId) => (
          <Switch
            fallback={
              <Loading>
                <AgentUsagePanel
                  serverId={serverId()}
                  hostName={hostName(serverId())}
                  agentId={usage.state.agentId}
                  onBack={usage.closeUsage}
                  machine={<UsageMachine serverId={serverId()} />}
                />
              </Loading>
            }
          >
            <Match when={usage.state.view === "schedule"}>
              <SchedulePanel serverId={serverId()} hostName={hostName(serverId())} onBack={usage.closeUsage} />
            </Match>
            <Match when={usage.state.view === "workflows"}>
              <Loading>
                <WorkflowsPage serverId={serverId()} />
              </Loading>
            </Match>
            <Match when={usage.state.view === "library"}>
              <Loading>
                <LibraryPanel serverId={serverId()} />
              </Loading>
            </Match>
          </Switch>
        )}
      </Show>
    </Show>
  );
}
