import type { ServerSummary } from "@openbot/contracts/ipc";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { createMemo } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { resolveCreationModel } from "../agents/agent-creation-model";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useSetup } from "../onboarding/onboarding-context";
import { remoteAdminServer } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { hostBitwardenConnectorPort } from "./bitwarden-connector-port";
import {
  type ConnectorRegistry,
  createConnectorRegistry,
  createConnectorSet,
  LOCAL_CONNECTOR_TRANSPORTS,
} from "./connector-registry";
import { githubConnectorPort, hostGitHubConnectorPort } from "./github-connector-port";
import { hostMessagingApi } from "./host-messaging-port";
import { localMessagingApi, type MessagingApi, type MessagingConnectorOptions } from "./messaging-connector";
import { hostOnePasswordConnectorPort } from "./onepassword-connector-port";
import { whatsappPort } from "./whatsapp-connector";

const context = createSimpleContext({
  name: "ConnectorsProvider",
  init: () => {
    const { activeServer, hostStatus } = useServers();
    const { publishLocalServer } = useServerSettings();
    const { agentList, agentStatus, modelOptions, serverSetupChoice, developmentCreation } = useAgents();
    const { setupState } = useSetup();
    const endpoints = useCustomProviders();
    const localAgents = useCustomAgents();
    const { collapseSidebarSection } = useSidebar();
    // The Slack, Discord, Telegram and WhatsApp Orchestrators of this computer run here, so their pickers list
    // this computer's models: none while a joined server is on screen, and then they start on a new
    // agent's default.
    const models = () => {
      const options = modelOptions();
      if (activeServer()?.kind !== "local" || options.length === 0) return undefined;
      return {
        modelOptions: options,
        agentStatus: agentStatus(),
        initial: resolveCreationModel(
          serverSetupChoice() ?? setupState(),
          options,
          agentStatus(),
          developmentCreation(),
        ),
        customProviders: endpoints.customProviders(),
        customAgents: localAgents.customAgents(),
      };
    };
    const localMessaging = localMessagingApi();
    // Slack, Discord and Telegram need this computer's server to have a name. Turning one on also
    // publishes the server (#3393), which names it when it has no name, so the user does not have to
    // do either first. A failed publish does not stop the connection: it reports its own error.
    const publishFirst = async () => {
      if (hostStatus().phase !== "online") await publishLocalServer().catch(() => undefined);
    };
    const messaging: MessagingApi = {
      ...localMessaging,
      connect: async (target) => {
        await publishFirst();
        await localMessaging.connect(target);
      },
      reconnect: async (platform, workspaceId) => {
        await publishFirst();
        await localMessaging.reconnect(platform, workspaceId);
      },
      setEnabled: async (platform, workspaceId, enabled) => {
        if (enabled) await publishFirst();
        await localMessaging.setEnabled(platform, workspaceId, enabled);
      },
    };
    const computer = createConnectorSet(
      // WhatsApp does not go through Signal, so it does not publish the server first.
      { github: githubConnectorPort, ...LOCAL_CONNECTOR_TRANSPORTS, messaging, whatsapp: whatsappPort },
      {
        agents: agentList,
        models,
        // The Integrations section starts collapsed: the orchestrator is not an agent people chat
        // with every day. The collapse belongs to the local server, the one on screen when it connects.
        onOrchestratorSection: (sectionId) => {
          if (activeServer()?.kind === "local") collapseSidebarSection(sectionId);
        },
      },
    );
    /**
     * The connectors of the joined server that `server` names, which an owner or admin manages from
     * here. Their pages open in this computer's browser; main sends the result on to the host. The
     * host's orchestrators start on its default provider and model.
     */
    const registry = (server: () => ServerSummary | undefined): ConnectorRegistry => {
      const target = createMemo(() => remoteAdminServer(server(), "connectors-v1"));
      // A separate capability: a host that serves `connectors-v1` can be older than the 1Password routes.
      const onePasswordTarget = createMemo(() => remoteAdminServer(server(), ONEPASSWORD_CONNECTOR_CAPABILITY));
      const bitwardenTarget = createMemo(() => remoteAdminServer(server(), BITWARDEN_CONNECTOR_CAPABILITY));
      const options: MessagingConnectorOptions = {
        agents: agentList,
        hostName: () => (target() ?? onePasswordTarget() ?? bitwardenTarget())?.name,
        serverId: () => target()?.id,
      };
      const github = hostGitHubConnectorPort(() => target()?.id);
      const onePassword = hostOnePasswordConnectorPort(() => onePasswordTarget()?.id);
      const bitwarden = hostBitwardenConnectorPort(() => bitwardenTarget()?.id);
      const host = createConnectorSet(
        {
          github: () => github,
          onePassword: () => onePassword,
          bitwarden: () => bitwarden,
          messaging: hostMessagingApi(() => target()?.id),
        },
        options,
      );
      return createConnectorRegistry(server, { computer, server: host });
    };
    return {
      /** The connectors of the server on screen: the Marketplace and the chat cards. */
      active: registry(activeServer),
    };
  },
});
export const ConnectorsProvider = context.provider;
export const useConnectors = context.use;
