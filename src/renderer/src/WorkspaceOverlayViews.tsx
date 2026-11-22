import type { AddedAgent, McpSignInState, ServerSummary } from "@openbot/contracts/ipc";
import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { MAC_APPS_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/mac-apps-limit-v1";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import type { MarketplaceAppsBlock } from "@openbot/ui/features/marketplace/marketplace-model";
import type { ComponentProps } from "@solidjs/web";
import { createMemo, Loading, omit, Show } from "solid-js";
import type { AgentTemplateInstallCalls } from "./features/agent-templates/agent-templates-port";
import { ChannelCreateDialog } from "./features/channels/ChannelCreateDialog";
import { useChannels } from "./features/channels/channels-context";
import type { ConnectorRegistry } from "./features/connectors/connector-registry";
import { useConversationController } from "./features/conversation/conversation-controller-context";
import { conversationPort } from "./features/conversation/conversation-port";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { canManageStorage, serverHasBackgroundProcesses, serverHasStorage } from "./features/files/storage-usage";
import type { ServerSettingsModalProps } from "./features/servers/ServerSettingsModal";
import type { ServerUpdateOptions } from "./features/servers/ServerUpdatePanel";
import {
  remoteAdminServer,
  remoteUpdateServer,
  serverCanAdminister,
  serverCanManageMcp,
  serverRoleCanAdminister,
  serverSupportsCapability,
} from "./features/servers/server-capabilities";
import type { MarketplaceCalls } from "./features/settings/marketplace-calls";
import type { MarketplaceAgentRow } from "./features/settings/marketplace-controller";
import { MARKETPLACE_PLUGINS } from "./features/settings/marketplace-plugin-catalog";
import {
  AgentTemplateInstall,
  GlobalSearch,
  JoinServerDialog,
  MarketplaceModal,
  ServerSettingsModal,
} from "./lazy-views";

export function JoinServerOverlay(props: { open: boolean } & ComponentProps<typeof JoinServerDialog>) {
  const dialog = omit(props, "open");
  return (
    <Show when={props.open}>
      <Loading>
        <JoinServerDialog {...dialog} />
      </Loading>
    </Show>
  );
}

export function MarketplaceOverlay(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerSummary | undefined;
  agents: readonly MarketplaceAgentRow[];
  activeAgentId: string;
  composerAvailable: boolean;
  onOpenAgent: (agentId: string) => void;
  onAgentInstalled: (agent: AddedAgent, serverId?: string) => void | Promise<void>;
  pluginSlug?: string | null | undefined;
  pluginConnect?: boolean | undefined;
  onPluginSlugConsumed: () => void;
  marketplaceListing?: MarketplaceListingLink | null | undefined;
  onMarketplaceListingConsumed?: (() => void) | undefined;
  connectors?: ConnectorRegistry | undefined;
  calls?: MarketplaceCalls | undefined;
  browserRuntime?: BrowserViewRuntime | undefined;
  macOS?: boolean | undefined;
  mcpToolRuntimeNote?: string | null | undefined;
  mcpSignInRequest?: string | null | undefined;
  onMcpSignInRequestHandled?: (() => void) | undefined;
  onMcpSignIns?: ((serverId: string, states: Readonly<Record<string, McpSignInState>>) => void) | undefined;
}) {
  const controller = useConversationController();
  const manage = createMemo(() => serverCanAdminister(props.server, "skills-admin-v1"));
  const pluginServerId = createMemo(() => (serverCanManageMcp(props.server) ? props.server.id : undefined));
  const pluginHostName = createMemo(() =>
    props.server?.kind === "remote" && serverCanManageMcp(props.server) ? props.server.name : undefined,
  );
  const pluginSignInRelay = createMemo(
    () => props.server?.kind === "remote" && serverSupportsCapability(props.server, "sign-in-relay-v1"),
  );
  const pluginHostView = createMemo(() =>
    props.server?.kind === "remote" &&
    serverSupportsCapability(props.server, "mcp-sign-in-v1") &&
    serverSupportsCapability(props.server, "browser-view")
      ? {
          runtime: props.browserRuntime ?? conversationPort().browser,
          clipboard: serverSupportsCapability(props.server, "browser-view-clipboard"),
        }
      : undefined,
  );
  const pluginsBlocked = createMemo((): MarketplaceAppsBlock | undefined => {
    const server = props.server;
    if (server?.kind !== "remote" || pluginServerId()) return undefined;
    if (!server.compatibility?.capabilities.length)
      return server.state === "connecting" || server.state === "online" ? { reason: "checking" } : undefined;
    const member = serverSupportsCapability(server, "mcp-servers-v1") && !serverRoleCanAdminister(server);
    return { reason: member ? "member" : "update", host: server.name };
  });
  const composerFree = createMemo(
    () =>
      manage() &&
      props.composerAvailable &&
      !controller.submitting() &&
      controller.voicePhase() === "idle" &&
      !controller.editingDeliveryId(),
  );
  const appendExample = (agentId: string, append: (target: { serverId: string; agentId: string }) => void) => {
    const server = props.server;
    if (!serverCanAdminister(server, "skills-admin-v1") || !props.agents.some((agent) => agent.id === agentId)) return;
    props.onOpenAgent(agentId);
    append({ serverId: server.id, agentId });
    props.onOpenChange(false);
  };

  return (
    <Show when={props.open}>
      <Loading>
        <MarketplaceModal
          open={true}
          calls={props.calls}
          macOS={props.macOS}
          macAppsUnavailable={
            props.server?.kind === "remote"
              ? serverSupportsCapability(props.server, MAC_APPS_LIMIT_CAPABILITY)
              : props.macOS === false
          }
          connectors={props.connectors}
          agents={manage() ? props.agents : []}
          activeAgentId={manage() ? props.activeAgentId : ""}
          hostServerId={remoteAdminServer(props.server, "skills-admin-v1")?.id}
          agentServerId={remoteAdminServer(props.server, "agent-install-v1")?.id}
          agentUpdateServerId={remoteAdminServer(props.server, "agent-update-v1")?.id}
          githubSkills={manage() && serverCanAdminister(props.server, "github-skills-v1")}
          onOpenChange={(open) => {
            if (!open) {
              props.onPluginSlugConsumed();
              props.onMarketplaceListingConsumed?.();
            }
            props.onOpenChange(open);
          }}
          onTrySkill={
            composerFree()
              ? (agentId, skill) => appendExample(agentId, (target) => controller.appendSkillExample(target, skill))
              : undefined
          }
          onCreateSkill={
            composerFree()
              ? (agentId) => appendExample(agentId, (target) => controller.startSkillCreation(target))
              : undefined
          }
          onAgentInstalled={props.onAgentInstalled}
          plugins={MARKETPLACE_PLUGINS}
          initialPluginSlug={props.pluginSlug ?? undefined}
          initialPluginConnect={props.pluginConnect}
          onInitialPluginSlugConsumed={props.onPluginSlugConsumed}
          initialListing={props.marketplaceListing ?? undefined}
          onInitialListingConsumed={props.onMarketplaceListingConsumed}
          pluginServerId={pluginServerId()}
          pluginsBlocked={pluginsBlocked()}
          pluginSignInApp={serverSupportsCapability(props.server, "mcp-sign-in-app-v1")}
          mcpToolRuntimeNote={props.mcpToolRuntimeNote}
          mcpSignInRequest={props.mcpSignInRequest}
          onMcpSignInRequestHandled={props.onMcpSignInRequestHandled}
          onMcpSignIns={props.onMcpSignIns}
          pluginHostName={pluginHostName()}
          pluginSignInRelay={pluginSignInRelay()}
          pluginHostView={pluginHostView()}
          pluginAccounts={serverSupportsCapability(props.server, "mcp-accounts-v1")}
          pluginAccess={serverCanAdminister(props.server, "mcp-access-v1")}
          onRunPluginPrompt={
            composerFree()
              ? (agentId, prompt) =>
                  appendExample(agentId, (target) => controller.appendPluginPrompt(target, prompt.text))
              : undefined
          }
        />
      </Loading>
    </Show>
  );
}

export function SharedAgentInstallOverlay(props: {
  templateId: string | null | undefined;
  server: ServerSummary | undefined;
  calls?: AgentTemplateInstallCalls | undefined;
  onOpenLink: (url: string) => void;
  onClose: () => void;
  onInstalled: (agent: AddedAgent, serverId?: string) => Promise<void>;
}) {
  return (
    <Show when={props.templateId}>
      {(templateId) => (
        <Loading>
          <AgentTemplateInstall
            templateId={templateId()}
            server={remoteAdminServer(props.server, "agent-install-v1")}
            calls={props.calls}
            onOpenLink={props.onOpenLink}
            onClose={props.onClose}
            onInstalled={props.onInstalled}
          />
        </Loading>
      )}
    </Show>
  );
}

export function ServerSettingsOverlay(
  props: Omit<ServerSettingsModalProps, "storage" | "hostUpdate"> & {
    storage: Omit<ServerStorageOptions, "canManage">;
    hostUpdate: ServerUpdateOptions;
  },
) {
  const modal = omit(props, "storage", "hostUpdate");
  return (
    <Loading>
      <ServerSettingsModal
        {...modal}
        storage={
          serverHasStorage(props.server)
            ? {
                ...props.storage,
                canManage: canManageStorage(props.server),
                backgroundProcesses: serverHasBackgroundProcesses(props.server),
              }
            : undefined
        }
        hostUpdate={
          remoteUpdateServer(props.server)
            ? { ...props.hostUpdate, canManage: serverRoleCanAdminister(props.server) }
            : undefined
        }
      />
    </Loading>
  );
}

export function GlobalSearchOverlay(props: ComponentProps<typeof GlobalSearch>) {
  const search = omit(props, "open");
  return (
    <Show when={props.open}>
      <Loading>
        <GlobalSearch open={true} {...search} />
      </Loading>
    </Show>
  );
}

export function ChannelCreateOverlay() {
  const channels = useChannels();
  return (
    <Show when={channels.state.editing === "create"}>
      <ChannelCreateDialog />
    </Show>
  );
}
