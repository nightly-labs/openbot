import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Loading, Match, onSettled, Show, Switch } from "solid-js";
import { AgentUsagePanel, WorkflowsPage } from "../../lazy-views";
import { SkillsMarketplace } from "../../WorkspaceOverlays";
import { SchedulePanel } from "../schedule/SchedulePanel";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { listenForPageEscape } from "./page-escape";
import { SettingsPage } from "./SettingsPage";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/**
 * The page of the desktop window that covers the conversation: a settings page, usage, schedule,
 * workflows or the Marketplace. The tasks page shows in the middle pane, in `WorkspaceShell`.
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
            <PageEscape onEscape={usage.closeUsage}>
              <Loading>
                <AgentUsagePanel
                  serverId={serverId()}
                  hostName={hostName(serverId())}
                  agentId={usage.state.agentId}
                  onBack={usage.closeUsage}
                />
              </Loading>
            </PageEscape>
          }
        >
          <Match when={usage.state.view === "schedule"}>
            <PageEscape onEscape={usage.closeUsage}>
              <SchedulePanel serverId={serverId()} hostName={hostName(serverId())} onBack={usage.closeUsage} />
            </PageEscape>
          </Match>
          <Match when={usage.state.view === "workflows"}>
            <Loading>
              <WorkflowsPage serverId={serverId()} />
            </Loading>
          </Match>
        </Switch>
      )}
    </Show>
  );
}

/**
 * Escape closes the usage or the schedule page, as it closes a settings page. Not the workflows page:
 * its editor handles Escape.
 */
function PageEscape(props: { onEscape: () => void; children: JSX.Element }) {
  let root!: HTMLDivElement;
  onSettled(() => listenForPageEscape(root, () => props.onEscape()));
  return (
    <div class="window-page-escape" ref={root}>
      {props.children}
    </div>
  );
}
