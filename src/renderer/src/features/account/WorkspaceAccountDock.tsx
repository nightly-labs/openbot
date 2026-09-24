import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { StaticAccountDock } from "@openbot/ui/features/account/StaticAccountDock";
import { createEffect, createMemo, Loading } from "solid-js";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { AccountDock } from "../../lazy-views";
import { usePlatform } from "../../platform";
import { useAgents } from "../agents/agents-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUpdates } from "../updates/updates-context";
import { useAuth } from "./account-context";

/**
 * The signed-in account, its usage and the update state, at the bottom of the
 * left column. `StaticAccountDock` is the fallback rather than a spinner because
 * this sits at a fixed place in the frame: a placeholder of a different height
 * would move the sidebar above it while the chunk loads.
 */
export function WorkspaceAccountDock(props: { account: () => CentralAuthUser }) {
  const platform = usePlatform();
  const layout = useLayout();
  const auth = useAuth();
  const setup = useSetup();
  const updates = useUpdates();
  const { activeAgent, agentStatus } = useAgents();
  const { activeServerId } = useServers();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const usageReady = createMemo(() => {
    const status = agentStatus();
    return (
      status.phase === "ready" ||
      Boolean(status.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting"))
    );
  });
  const usageTargetKey = createMemo(() => {
    const serverId = activeServerId();
    if (!serverId) return null;
    const connected = (agentStatus().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${serverId}:${connected}`;
  });

  createEffect(
    () => usageTargetKey(),
    (targetKey) => auth.selectAccountUsageTarget(targetKey),
  );

  return (
    <Loading
      fallback={
        <StaticAccountDock
          account={props.account()}
          compact={layout.leftPanelCompact()}
          hybrid={platform.appInfo()?.platform === "darwin" && !layout.leftPanelCompact()}
          withServerRail={platform.serverRailVisible()}
        />
      }
    >
      <AccountDock
        account={props.account()}
        appInfo={platform.appInfo()}
        agentStatus={agentStatus()}
        accountUsage={auth.accountUsage()}
        usageProvider={activeAgent()?.provider ?? null}
        usageTargetKey={usageTargetKey()}
        usageRefreshRevision={auth.accountUsageRefreshRevision()}
        usageReady={usageReady()}
        updateStatus={updates.status()}
        compact={layout.leftPanelCompact()}
        withServerRail={platform.serverRailVisible()}
        onRefreshUsage={() => {
          const targetKey = usageTargetKey();
          return targetKey ? auth.refreshAccountUsage(targetKey) : Promise.resolve({ limits: [] });
        }}
        onUpdateAction={updates.runAction}
        onLogout={platform.landingPreview ? undefined : auth.logoutCentralAccount}
        onOpenExternal={(destination) => appPort().openExternal(destination)}
        onOpenPermissions={() => setup.setPermissionsOpen(true)}
        onOpenSettings={openAppSettings}
        onOpenSkills={() => setSkillsMarketplaceOpen(true)}
      />
    </Loading>
  );
}
