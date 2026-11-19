import type { ServerSummary } from "@openbot/contracts/ipc";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PASSWORD_MANAGERS_CAPABILITY } from "@openbot/contracts/team-protocol/password-managers-v1";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
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
import { hostPasswordManagerPort } from "./password-manager-port";
import { hostWhatsAppPort, whatsappPort } from "./whatsapp-connector";

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
      { github: githubConnectorPort, ...LOCAL_CONNECTOR_TRANSPORTS, messaging, whatsapp: whatsappPort },
      {
        agents: agentList,
        models,
        onOrchestratorSection: (sectionId) => {
          if (activeServer()?.kind === "local") collapseSidebarSection(sectionId);
        },
      },
    );
    const registry = (server: () => ServerSummary | undefined): ConnectorRegistry => {
      const target = createMemo(() => remoteAdminServer(server(), "connectors-v1"));
      const onePasswordTarget = createMemo(() => remoteAdminServer(server(), ONEPASSWORD_CONNECTOR_CAPABILITY));
      const bitwardenTarget = createMemo(() => remoteAdminServer(server(), BITWARDEN_CONNECTOR_CAPABILITY));
      const whatsappTarget = createMemo(() => remoteAdminServer(server(), WHATSAPP_CONNECTOR_CAPABILITY));
      const passwordManagersTarget = createMemo(() => remoteAdminServer(server(), PASSWORD_MANAGERS_CAPABILITY));
      const options: MessagingConnectorOptions = {
        agents: agentList,
        hostName: () =>
          (target() ?? onePasswordTarget() ?? bitwardenTarget() ?? whatsappTarget() ?? passwordManagersTarget())?.name,
        serverId: () => target()?.id,
      };
      const github = hostGitHubConnectorPort(() => target()?.id);
      const onePassword = hostOnePasswordConnectorPort(() => onePasswordTarget()?.id);
      const bitwarden = hostBitwardenConnectorPort(() => bitwardenTarget()?.id);
      const whatsapp = hostWhatsAppPort(() => whatsappTarget()?.id);
      const passwordManagers = hostPasswordManagerPort(() => passwordManagersTarget()?.id);
      const host = createConnectorSet(
        {
          github: () => github,
          onePassword: () => onePassword,
          bitwarden: () => bitwarden,
          passwordManagers: () => passwordManagers,
          messaging: hostMessagingApi(() => target()?.id),
          whatsapp: () => whatsapp,
        },
        options,
      );
      return createConnectorRegistry(server, { computer, server: host });
    };
    return {
      active: registry(activeServer),
    };
  },
});
export const ConnectorsProvider = context.provider;
export const useConnectors = context.use;
