// Access, auto-approve and skills of one agent, and adding an agent from the marketplace or a
// shared template. On a joined server they belong to the host, so the request goes there, and the
// host answers only an owner or admin.

import {
  type AddedAgent,
  type AgentAdminSettings,
  decodeAgentAdminSettings,
  decodeHostAddedAgent,
  decodeInstalledSkills,
  type InstalledSkill,
  parseUpdateAgentAdminSettingsInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_INSTALL_CAPABILITY, AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentTemplateService } from "../agent-template-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallAgentTemplate } from "./agent-template-handlers";
import {
  parseInstallMarketplaceAgent,
  parseInstallSkill,
  parseSetEnabledSkill,
  parseUninstallSkill,
} from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";
import { requireString } from "./validation";

interface AgentAdminRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

interface AgentAdminIpcDependencies {
  settings: AgentAdminSettingsService;
  skills: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled">;
  marketplaceAgents: Pick<AgentMarketplaceService, "install">;
  agentTemplates: Pick<AgentTemplateService, "install">;
  remoteServers: AgentAdminRemoteServers;
}

function decodeRemoteInstalledSkill(value: unknown): InstalledSkill {
  const [skill] = decodeInstalledSkills([value]);
  if (!skill) throw new Error("Invalid installed skill.");
  return skill;
}

// The skills-admin-v1 codec has already checked that the body is an empty record.
const acceptEmpty = (): undefined => undefined;

export function agentAdminIpcHandlers({
  settings,
  skills,
  marketplaceAgents,
  agentTemplates,
  remoteServers,
}: AgentAdminIpcDependencies): Pick<IpcGroupHandlers, "agentAdmin"> {
  function remote(serverId: string, path: string, body: unknown): Promise<AgentAdminSettings> {
    if (!remoteServers.supportsCapability(serverId, AGENT_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.settingsLocalOnly"));
    return remoteServers.request(serverId, path, decodeAgentAdminSettings, { method: "POST", body });
  }

  function remoteSkills<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, SKILLS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.skillsLocalOnly"));
    return remoteServers.request(serverId, path, decoder, { method: "POST", body });
  }

  function remoteAdd(serverId: string, path: string, body: unknown): Promise<AddedAgent> {
    if (!remoteServers.supportsCapability(serverId, AGENT_INSTALL_CAPABILITY))
      throw new Error(sourceText("error.agent.addLocalOnly"));
    return remoteServers.request(serverId, path, decodeHostAddedAgent, { method: "POST", body });
  }

  return {
    agentAdmin: {
      getAgentAdminSettings: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => settings.read(agentId),
        remote: (agentId, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.settings, { agentId }),
      }),
      updateAgentAdminSettings: scopedHandler(parseUpdateAgentAdminSettingsInput, {
        local: (input) => settings.update(input),
        remote: (input, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.update, input),
      }),
      listAgentSkills: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => skills.listInstalled(agentId),
        remote: (agentId, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.list, { agentId }, decodeInstalledSkills),
      }),
      installAgentSkill: scopedHandler(parseInstallSkill, {
        local: (input) => skills.install(input),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.install, input, decodeRemoteInstalledSkill),
      }),
      uninstallAgentSkill: scopedHandler(parseUninstallSkill, {
        local: (input) => skills.uninstall(input),
        remote: (input, serverId) => remoteSkills(serverId, SKILLS_ADMIN_ROUTES.uninstall, input, acceptEmpty),
      }),
      setAgentSkillEnabled: scopedHandler(parseSetEnabledSkill, {
        local: (input) => skills.setEnabled(input),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.setEnabled, input, decodeRemoteInstalledSkill),
      }),
      addMarketplaceAgent: scopedHandler(parseInstallMarketplaceAgent, {
        local: async (input) => addedAgent(await marketplaceAgents.install(input)),
        remote: ({ agentId, ...input }, serverId) => {
          // agent-install-v1 only adds a new agent. Dropping the id would add a copy instead of updating.
          if (agentId !== undefined) throw new Error(sourceText("error.agent.joinedServerUpdate"));
          return remoteAdd(serverId, AGENT_INSTALL_ROUTES.marketplace, input);
        },
      }),
      addTemplateAgent: scopedHandler(parseInstallAgentTemplate, {
        local: async (input) => addedAgent(await agentTemplates.install(input)),
        remote: (input, serverId) => remoteAdd(serverId, AGENT_INSTALL_ROUTES.template, input),
      }),
    },
  };
}

function addedAgent({ agent }: { agent: { id: string; name: string } }): AddedAgent {
  return { id: agent.id, name: agent.name };
}
