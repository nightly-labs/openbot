import type { AgentProviderId, CentralAuthUser } from "@openbot/contracts/ipc";
import { PICKER_PROVIDERS } from "@openbot/contracts/ipc";
import { createEffect, createMemo, Loading } from "solid-js";
import { useLayout } from "../../layout";
import { AccountDock } from "../../lazy-views";
import { usePlatform } from "../../platform";
import { useAgents } from "../agents/agents-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUpdates } from "../updates/updates-context";
import { useAuth } from "./account-context";
import { StaticAccountDock } from "./StaticAccountDock";

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
  const { activeAgent, agentList, agentStatus } = useAgents();
  const { activeServerId, activeServerSupportsCapability } = useServers();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const activeUsageTargetKey = createMemo(() => {
    const agent = activeAgent();
    if (!agent || agentStatus().phase !== "ready" || !activeServerSupportsCapability("model-scoped-usage")) return null;
    const provider = agentStatus().providers?.find((candidate) => candidate.id === agent.provider);
    if (provider && (provider.state !== "available" || provider.connectionState === "connecting")) return null;
    return JSON.stringify([activeServerId(), agent.provider, agent.model]);
  });
  const usageProviders = createMemo(() => {
    if (agentStatus().phase !== "ready") return [];
    const available = new Set(
      (agentStatus().providers ?? [])
        .filter((provider) => provider.state === "available" && provider.connectionState !== "connecting")
        .map((provider) => provider.id),
    );
    const ordered = PICKER_PROVIDERS.filter((provider) => available.has(provider));
    const activeProvider = activeAgent()?.provider;
    return activeProvider && ordered.includes(activeProvider)
      ? [activeProvider, ...ordered.filter((provider) => provider !== activeProvider)]
      : ordered;
  });
  const usageRepresentatives = createMemo(() =>
    usageProviders().flatMap((provider) => {
      const active = activeAgent();
      const candidates = agentList().filter((agent) => agent.provider === provider);
      const ordered =
        active?.provider === provider ? [active, ...candidates.filter((agent) => agent.id !== active.id)] : candidates;
      const models = new Set<string>();
      return ordered.flatMap((agent) => {
        if (models.has(agent.model)) return [];
        models.add(agent.model);
        return [{ provider, agentId: agent.id, model: agent.model }];
      });
    }),
  );
  const usageTargetKey = createMemo(() => {
    if (!activeServerSupportsCapability("model-scoped-usage") || usageProviders().length === 0) return null;
    return JSON.stringify([
      activeServerId(),
      usageProviders(),
      usageRepresentatives().map(({ provider, agentId, model }) => [provider, agentId, model]),
    ]);
  });

  createEffect(
    () => activeUsageTargetKey(),
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
        usageProviders={usageProviders()}
        usageTargetKey={usageTargetKey()}
        usageRefreshRevision={auth.accountUsageRefreshRevision()}
        updateStatus={updates.status()}
        compact={layout.leftPanelCompact()}
        withServerRail={platform.serverRailVisible()}
        onRefreshUsage={async () => {
          const providers = usageProviders();
          const representatives = usageRepresentatives();
          const active = activeAgent();
          const activeTargetKey = activeUsageTargetKey();
          const settled = await Promise.allSettled(
            representatives.map(async (representative) => ({
              provider: representative.provider,
              usage:
                active?.id === representative.agentId && activeTargetKey
                  ? await auth.refreshAccountUsage(representative.agentId, activeTargetKey)
                  : await window.openbot.agent.getUsage(representative.agentId),
            })),
          );
          const fulfilled = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
          if (settled.length > 0 && fulfilled.length === 0) {
            const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
            throw failure?.reason ?? new Error("Usage is unavailable.");
          }
          return providers.map((provider: AgentProviderId) => ({
            provider,
            usages: fulfilled.filter((result) => result.provider === provider).map((result) => result.usage),
          }));
        }}
        onUpdateAction={updates.runAction}
        onLogout={platform.landingPreview ? undefined : auth.logoutCentralAccount}
        onOpenExternal={(destination) => window.openbot.openExternal(destination)}
        onOpenPermissions={() => setup.setPermissionsOpen(true)}
        onOpenSettings={openAppSettings}
        onOpenSkills={() => setSkillsMarketplaceOpen(true)}
      />
    </Loading>
  );
}
