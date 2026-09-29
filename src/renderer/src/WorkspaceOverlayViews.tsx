import type { AddedAgent, AgentSummary, McpServerConfig, ServerSummary } from "@openbot/contracts/ipc";
import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import type { ComponentProps } from "@solidjs/web";
import { createMemo, Loading, omit, Show } from "solid-js";
import type { AgentTemplateInstallCalls } from "./features/agent-templates/agent-templates-port";
import { ChannelCreateDialog } from "./features/channels/ChannelCreateDialog";
import { useChannels } from "./features/channels/channels-context";
import { useConversationController } from "./features/conversation/conversation-controller-context";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { canManageStorage, serverHasStorage } from "./features/files/storage-usage";
import type { ServerSettingsModalProps } from "./features/servers/ServerSettingsModal";
import type { ServerUpdateOptions } from "./features/servers/ServerUpdatePanel";
import { remoteAdminServer, serverCanAdminister } from "./features/servers/server-capabilities";
import type { MarketplaceCalls } from "./features/settings/marketplace-calls";
import { MARKETPLACE_PLUGINS } from "./features/settings/marketplace-plugin-catalog";
import {
  AgentTemplateInstall,
  GlobalSearch,
  JoinServerDialog,
  ServerSettingsModal,
  SkillsMarketplaceModal,
} from "./lazy-views";

/**
 * The overlays that the desktop shell and the web client both raise over the workspace, as views that
 * take props. `WorkspaceOverlays` fills them from the desktop contexts; the web client fills them from
 * its host connection. What an overlay decides from its server - which host installs, which sections
 * show - is decided here once, so the two clients cannot drift apart.
 *
 * They read only the contexts that both clients provide: the conversation controller and channels.
 */

/** Joining a team server from an invite link. */
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

/**
 * Skills and marketplace agents, which install into an Agent's workspace on the host. The picker
 * lists the agents of this computer, or of a joined server this account administers; a member
 * browses and installs nothing. A marketplace agent is added to that joined server when its host
 * serves `agent-install-v1`, otherwise to this computer. An agent of a joined server is updated from
 * its listing only when its host serves `agent-update-v1`.
 */
export function MarketplaceOverlay(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerSummary | undefined;
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  activeAgentId: string;
  /** Whether the client could take another line into a composer, before the controller is asked. */
  composerAvailable: boolean;
  /** Opens an agent's conversation before an example is added to its draft. */
  onOpenAgent: (agentId: string) => void;
  onAgentInstalled: (agent: AddedAgent, serverId?: string) => void | Promise<void>;
  /** The listing a plugin link named. Closing the marketplace forgets it too. */
  pluginSlug?: string | null | undefined;
  onPluginSlugConsumed: () => void;
  /** What the dialog calls. Absent: this computer's bridge. */
  calls?: MarketplaceCalls | undefined;
}) {
  const controller = useConversationController();
  const manage = createMemo(() => serverCanAdminister(props.server, "skills-admin-v1"));
  /* What both example controls need: a managed agent whose composer is free to take another line. */
  const composerFree = createMemo(
    () =>
      manage() &&
      props.composerAvailable &&
      !controller.submitting() &&
      !controller.selectionSending() &&
      controller.voicePhase() === "idle" &&
      !controller.editingDeliveryId(),
  );
  /** Adds a marketplace example to an agent's draft, then shows that agent's conversation. */
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
        <SkillsMarketplaceModal
          open={true}
          calls={props.calls}
          agents={manage() ? props.agents : []}
          activeAgentId={manage() ? props.activeAgentId : ""}
          hostServerId={remoteAdminServer(props.server, "skills-admin-v1")?.id}
          agentServerId={remoteAdminServer(props.server, "agent-install-v1")?.id}
          agentUpdateServerId={remoteAdminServer(props.server, "agent-update-v1")?.id}
          onOpenChange={(open) => {
            /* The slug is consumed by opening, so closing forgets it: reopening the marketplace by
               hand lands on the catalog rather than on the listing a link once named. */
            if (!open) props.onPluginSlugConsumed();
            props.onOpenChange(open);
          }}
          onTrySkill={
            composerFree()
              ? (agentId, skill) => appendExample(agentId, (target) => controller.appendSkillExample(target, skill))
              : undefined
          }
          onAgentInstalled={props.onAgentInstalled}
          plugins={MARKETPLACE_PLUGINS}
          initialPluginSlug={props.pluginSlug ?? undefined}
          onInitialPluginSlugConsumed={props.onPluginSlugConsumed}
          /* A plugin's app is an MCP server, which the host holds. A joined server takes one over
             `mcp-servers-v1` from an admin, as the agents list does; a member browses the listings
             and installs nothing. */
          pluginServerId={
            manage() && serverCanAdminister(props.server, MCP_SERVERS_CAPABILITY) ? props.server?.id : undefined
          }
          pluginHostName={manage() ? remoteAdminServer(props.server, MCP_SERVERS_CAPABILITY)?.name : undefined}
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

/**
 * A shared agent from an agent link. It is added where a marketplace agent is: on the selected joined
 * server when this account administers it, otherwise on this computer.
 */
export function SharedAgentInstallOverlay(props: {
  templateId: string | null | undefined;
  server: ServerSummary | undefined;
  /** Absent: this computer's bridge. */
  calls?: AgentTemplateInstallCalls | undefined;
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
            onClose={props.onClose}
            onInstalled={props.onInstalled}
          />
        </Loading>
      )}
    </Show>
  );
}

/**
 * Settings for one server. The MCP and Storage sections are gated on the server here: a remote host
 * answers 403 to a `member` and 400 without the capability, so neither ever sees the MCP section,
 * and a host without `storage-v1` has no Storage section at all.
 */
export function ServerSettingsOverlay(
  props: Omit<ServerSettingsModalProps, "mcpServers" | "storage" | "hostUpdate"> & {
    mcpServers: McpServerConfig[];
    storage: Omit<ServerStorageOptions, "canManage">;
    hostUpdate: ServerUpdateOptions;
  },
) {
  const modal = omit(props, "mcpServers", "storage", "hostUpdate");
  return (
    <Loading>
      <ServerSettingsModal
        {...modal}
        mcpServers={serverCanAdminister(props.server, MCP_SERVERS_CAPABILITY) ? props.mcpServers : undefined}
        storage={
          serverHasStorage(props.server) ? { ...props.storage, canManage: canManageStorage(props.server) } : undefined
        }
        hostUpdate={remoteAdminServer(props.server, HOST_UPDATE_CAPABILITY) ? props.hostUpdate : undefined}
      />
    </Loading>
  );
}

/** Search across every conversation on the active server. */
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

/** A new channel. Channels is the one domain both clients provide as a context. */
export function ChannelCreateOverlay() {
  const channels = useChannels();
  return (
    <Show when={channels.state.editing === "create"}>
      <ChannelCreateDialog />
    </Show>
  );
}
