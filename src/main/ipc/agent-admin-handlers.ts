import type { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// Access, auto-approve and skills of one agent, and adding an agent from the marketplace or a
// shared template. On a joined server they belong to the host, so the request goes there, and the
// host answers only an owner or admin.

import {
  type AddedAgent,
  type AgentAdminSettings,
  type AgentFastModeSettings,
  agentFastModeSettings,
  agentSpeed,
  type BrowserComputerSharing,
  decodeAgentAdminSettings,
  decodeAgentBackupModelSettings,
  decodeAgentBrowserProfile,
  decodeAgentDefaultsOverview,
  decodeAgentPlanCardSettings,
  decodeAgentSpeedSettings,
  decodeAgentTaskLimitSettings,
  decodeBrowserComputerSharing,
  decodeBrowserProfileList,
  decodeBrowserProfileSummary,
  decodeBrowserProxyList,
  decodeBrowserProxySummary,
  decodeHostAddedAgent,
  decodeHostAgentTemplatePreview,
  decodeHostAgentTemplatePublication,
  decodeHostBrowserTabProfiles,
  decodeInstalledSkills,
  type InstalledSkill,
  parseBrowserProfileId,
  parseBrowserProfileName,
  parseClearBrowserDataInput,
  parseDeleteBrowserProxyInput,
  parseSaveBrowserProxyInput,
  parseSetAgentDefaultChoiceInput,
  parseSetBrowserProfileProxyInput,
  parseUpdateAgentAdminSettingsInput,
  parseUpdateAgentBackupModelsInput,
  parseUpdateAgentBrowserProfileInput,
  parseUpdateAgentDefaultsInput,
  parseUpdateAgentFastModeInput,
  parseUpdateAgentHostSettingsInput,
  parseUpdateAgentNewChatInput,
  parseUpdateAgentPlanCardInput,
  parseUpdateAgentTaskLimitInput,
  parseUpdateBrowserProfileInput,
  type UpdateAgentFastModeInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_DEFAULTS_CAPABILITY, AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_INSTALL_CAPABILITY, AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_NEW_CHAT_CAPABILITY, AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import {
  AGENT_PUBLISH_CAPABILITY,
  AGENT_PUBLISH_IMAGE_BYTES,
  AGENT_PUBLISH_ROUTES,
} from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_UPDATE_CAPABILITY, AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import {
  BROWSER_PROFILES_CAPABILITY,
  BROWSER_PROFILES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-profiles-v1";
import {
  BROWSER_PROXIES_CAPABILITY,
  BROWSER_PROXIES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-proxies-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { GITHUB_SKILLS_CAPABILITY, GITHUB_SKILLS_ROUTES } from "@openbot/contracts/team-protocol/github-skills-v1";
import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentDefaultsSettingsService } from "../agent-defaults-settings";
import type { AgentHostSettingsService } from "../agent-host-settings";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentTemplateService } from "../agent-template-service";
import type { BrowserProfileService } from "../browser-profile-service";
import {
  decodeAgentHostSettingsFromHost,
  decodeGithubSkillSourceFromHost,
  decodeRemoteAgentFastModeSettings,
  decodeRemoteAgentNewChatSettings,
} from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallAgentTemplate, parsePublishAgentTemplate } from "./agent-template-handlers";
import {
  parseInstallMarketplaceAgent,
  parseInstallSkill,
  parseSetEnabledSkill,
  parseUninstallSkill,
} from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { requireString } from "./validation";

interface AgentAdminRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  browserComputerSharing(serverId: string): BrowserComputerSharing | null;
  setBrowserComputerSharing(serverId: string, sharing: boolean): Effect.Effect<void, RemoteWorkflowError>;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface AgentAdminIpcDependencies {
  settings: AgentAdminSettingsService;
  hostSettings: AgentHostSettingsService;
  defaultsSettings: AgentDefaultsSettingsService;
  browserProfiles: BrowserProfileService;
  skills: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled" | "readGithub">;
  marketplaceAgents: Pick<AgentMarketplaceService, "install">;
  agentTemplates: Pick<AgentTemplateService, "install" | "preview" | "publish" | "unpublish">;
  remoteServers: AgentAdminRemoteServers;
}

function decodeRemoteInstalledSkill(value: unknown): InstalledSkill {
  const [skill] = decodeInstalledSkills([value]);
  if (!skill) throw new Error("Invalid installed skill.");
  return skill;
}

export function agentAdminIpcHandlers({
  settings,
  hostSettings,
  defaultsSettings,
  browserProfiles,
  skills,
  marketplaceAgents,
  agentTemplates,
  remoteServers,
}: AgentAdminIpcDependencies): Pick<IpcGroupHandlers, "agentAdmin"> {
  function remote(serverId: string, path: string, body: unknown): Promise<AgentAdminSettings> {
    if (!remoteServers.supportsCapability(serverId, AGENT_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.settingsLocalOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentAdminSettings, { method: "POST", body }));
  }

  function remoteSkills<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, SKILLS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.skillsLocalOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  function remoteAdd(serverId: string, path: string, body: unknown): Promise<AddedAgent> {
    if (!remoteServers.supportsCapability(serverId, AGENT_INSTALL_CAPABILITY))
      throw new Error(sourceText("error.agent.addLocalOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeHostAddedAgent, { method: "POST", body }));
  }

  function remoteUpdate(serverId: string, body: unknown): Promise<AddedAgent> {
    if (!remoteServers.supportsCapability(serverId, AGENT_UPDATE_CAPABILITY))
      throw new Error(sourceText("error.agent.joinedServerUpdate"));
    return runCauseEffect(
      remoteServers.request(serverId, AGENT_UPDATE_ROUTES.marketplace, decodeHostAddedAgent, {
        method: "POST",
        body,
      }),
    );
  }

  return {
    agentAdmin: {
      getAgentHostSettings: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.read(agentId),
        remote: (agentId, serverId) => remoteHostSettings(serverId, AGENT_HOST_SETTINGS_ROUTES.settings, { agentId }),
      }),
      updateAgentHostSettings: scopedHandler(parseUpdateAgentHostSettingsInput, {
        local: (input) => runCauseEffect(hostSettings.update(input)),
        remote: (input, serverId) => remoteHostSettings(serverId, AGENT_HOST_SETTINGS_ROUTES.update, input),
      }),
      getAgentBackupModels: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readBackupModels(agentId),
        remote: (agentId, serverId) => remoteBackupModels(serverId, AGENT_BACKUP_MODELS_ROUTES.settings, { agentId }),
      }),
      updateAgentBackupModels: scopedHandler(parseUpdateAgentBackupModelsInput, {
        local: (input) => runCauseEffect(hostSettings.updateBackupModels(input)),
        remote: (input, serverId) => remoteBackupModels(serverId, AGENT_BACKUP_MODELS_ROUTES.update, input),
      }),
      getAgentTaskLimit: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readTaskLimit(agentId),
        remote: (agentId, serverId) => remoteTaskLimit(serverId, AGENT_TASK_LIMIT_ROUTES.settings, { agentId }),
      }),
      updateAgentTaskLimit: scopedHandler(parseUpdateAgentTaskLimitInput, {
        local: (input) => runCauseEffect(hostSettings.updateTaskLimit(input)),
        remote: (input, serverId) => remoteTaskLimit(serverId, AGENT_TASK_LIMIT_ROUTES.update, input),
      }),
      getAgentNewChat: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readNewChat(agentId),
        remote: (agentId, serverId) => remoteNewChat(serverId, AGENT_NEW_CHAT_ROUTES.settings, { agentId }),
      }),
      updateAgentNewChat: scopedHandler(parseUpdateAgentNewChatInput, {
        local: (input) => runCauseEffect(hostSettings.updateNewChat(input)),
        remote: (input, serverId) => remoteNewChat(serverId, AGENT_NEW_CHAT_ROUTES.update, input),
      }),
      getAgentPlanCard: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readPlanCard(agentId),
        remote: (agentId, serverId) => remotePlanCard(serverId, AGENT_PLAN_CARD_ROUTES.settings, { agentId }),
      }),
      updateAgentPlanCard: scopedHandler(parseUpdateAgentPlanCardInput, {
        local: (input) => runCauseEffect(hostSettings.updatePlanCard(input)),
        remote: (input, serverId) => remotePlanCard(serverId, AGENT_PLAN_CARD_ROUTES.update, input),
      }),
      getAgentFastMode: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readFastMode(agentId),
        remote: (agentId, serverId) => remoteFastMode(serverId, { agentId }),
      }),
      updateAgentFastMode: scopedHandler(parseUpdateAgentFastModeInput, {
        local: (input) => runCauseEffect(hostSettings.updateFastMode(input)),
        remote: (input, serverId) => remoteFastMode(serverId, { agentId: input.agentId }, input),
      }),
      listBrowserProfiles: scopedQueryHandler({
        local: () => browserProfiles.list(),
        remote: (serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.list, {}, decodeBrowserProfileList),
      }),
      createBrowserProfile: scopedHandler(parseBrowserProfileName, {
        local: (name) => runCauseEffect(browserProfiles.create(name)),
        remote: (name, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.create, { name }, decodeBrowserProfileSummary),
      }),
      updateBrowserProfile: scopedHandler(parseUpdateBrowserProfileInput, {
        local: (input) => runCauseEffect(browserProfiles.update(input)),
        remote: (input, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.update, input, decodeBrowserProfileSummary),
      }),
      clearBrowserData: scopedHandler(parseClearBrowserDataInput, {
        local: (input) => runCauseEffect(browserProfiles.clear(input)),
        remote: (input, serverId) => remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.clear, input, acceptEmpty),
      }),
      deleteBrowserProfile: scopedHandler(parseBrowserProfileId, {
        local: (profileId) => runCauseEffect(browserProfiles.delete(profileId)),
        remote: (profileId, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.delete, { profileId }, acceptEmpty),
      }),
      getAgentBrowserProfile: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => browserProfiles.readAgent(agentId),
        remote: (agentId, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.agent, { agentId }, decodeAgentBrowserProfile),
      }),
      updateAgentBrowserProfile: scopedHandler(parseUpdateAgentBrowserProfileInput, {
        local: (input) => runCauseEffect(browserProfiles.updateAgent(input)),
        remote: (input, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.updateAgent, input, decodeAgentBrowserProfile),
      }),
      getAgentDefaultsOverview: scopedQueryHandler({
        local: () => defaultsSettings.read(),
        remote: (serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.settings, {}),
      }),
      updateAgentDefaultsOverview: scopedHandler(parseUpdateAgentDefaultsInput, {
        local: (input) => runCauseEffect(defaultsSettings.update(input)),
        remote: (input, serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.update, input),
      }),
      setAgentDefaultChoice: scopedHandler(parseSetAgentDefaultChoiceInput, {
        local: (input) => runCauseEffect(defaultsSettings.setChoice(input)),
        remote: (input, serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.choice, input),
      }),
      listBrowserProxies: scopedQueryHandler({
        local: () => browserProfiles.listProxies(),
        // Null: the host has no proxy routes, so the settings show no proxy choice.
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, BROWSER_PROXIES_CAPABILITY)
            ? remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.list, {}, decodeBrowserProxyList)
            : null,
      }),
      saveBrowserProxy: scopedHandler(parseSaveBrowserProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.saveProxy(input)),
        remote: (input, serverId) =>
          remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.save, input, decodeBrowserProxySummary),
      }),
      deleteBrowserProxy: scopedHandler(parseDeleteBrowserProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.deleteProxy(input)),
        remote: (input, serverId) => remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.delete, input, acceptEmpty),
      }),
      setBrowserProfileProxy: scopedHandler(parseSetBrowserProfileProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.setProfileProxy(input)),
        remote: (input, serverId) => remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.profile, input, acceptEmpty),
      }),
      // This computer's own server has no computer proxy of this computer: its pages already use it.
      getBrowserComputerSharing: scopedQueryHandler({
        local: () => null,
        remote: (serverId) => remoteServers.browserComputerSharing(serverId),
      }),
      setBrowserComputerSharing: scopedHandler(decodeBrowserComputerSharing, {
        local: () => {
          throw new Error(sourceText("error.team.agentSettingsUnsupported"));
        },
        remote: ({ sharing }, serverId) => runCauseEffect(remoteServers.setBrowserComputerSharing(serverId, sharing)),
      }),
      listBrowserTabProfiles: scopedQueryHandler({
        local: () => browserProfiles.tabProfiles(),
        // A host without the capability shows no label: its tabs are all in its one shared session.
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, BROWSER_PROFILES_CAPABILITY)
            ? remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.tabs, {}, decodeHostBrowserTabProfiles)
            : [],
      }),
      getAgentAdminSettings: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => settings.read(agentId),
        remote: (agentId, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.settings, { agentId }),
      }),
      updateAgentAdminSettings: scopedHandler(parseUpdateAgentAdminSettingsInput, {
        local: (input) => runCauseEffect(settings.update(input)),
        remote: (input, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.update, input),
      }),
      listAgentSkills: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => runCauseEffect(skills.listInstalled(agentId)),
        remote: (agentId, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.list, { agentId }, decodeInstalledSkills),
      }),
      installAgentSkill: scopedHandler(parseInstallSkill, {
        local: (input) => runCauseEffect(skills.install(input)),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.install, input, decodeRemoteInstalledSkill),
      }),
      uninstallAgentSkill: scopedHandler(parseUninstallSkill, {
        local: (input) => runCauseEffect(skills.uninstall(input)),
        remote: (input, serverId) => remoteSkills(serverId, SKILLS_ADMIN_ROUTES.uninstall, input, acceptEmpty),
      }),
      setAgentSkillEnabled: scopedHandler(parseSetEnabledSkill, {
        local: (input) => runCauseEffect(skills.setEnabled(input)),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.setEnabled, input, decodeRemoteInstalledSkill),
      }),
      readGithubSkills: scopedHandler((value) => requireString(value, "link", 2048), {
        local: (link) => runCauseEffect(skills.readGithub(link)),
        remote: (link, serverId) => {
          if (!remoteServers.supportsCapability(serverId, GITHUB_SKILLS_CAPABILITY))
            throw new Error(sourceText("error.skill.githubHostTooOld"));
          return runCauseEffect(
            remoteServers.request(serverId, GITHUB_SKILLS_ROUTES.read, decodeGithubSkillSourceFromHost, {
              method: "POST",
              body: { link },
            }),
          );
        },
      }),
      addMarketplaceAgent: scopedHandler(parseInstallMarketplaceAgent, {
        local: async (input) => addedAgent(await runCauseEffect(marketplaceAgents.install(input))),
        // agent-install-v1 only adds a new agent, so an update goes to its own route: dropping the id
        // would add a copy instead of updating.
        remote: (input, serverId) =>
          input.agentId === undefined
            ? remoteAdd(serverId, AGENT_INSTALL_ROUTES.marketplace, input)
            : remoteUpdate(serverId, input),
      }),
      addTemplateAgent: scopedHandler(parseInstallAgentTemplate, {
        local: async (input) => addedAgent(await runCauseEffect(agentTemplates.install(input))),
        remote: (input, serverId) => remoteAdd(serverId, AGENT_INSTALL_ROUTES.template, input),
      }),
      previewAgentTemplate: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => runCauseEffect(agentTemplates.preview(agentId)),
        remote: (agentId, serverId) =>
          remotePublish(serverId, AGENT_PUBLISH_ROUTES.preview, { agentId }, decodeHostAgentTemplatePreview),
      }),
      publishAgentTemplate: scopedHandler(parsePublishAgentTemplate, {
        local: (input) => runCauseEffect(agentTemplates.publish(input)),
        // The host publishes with its own account. A card too large for the wire is left out, as the
        // web client does.
        remote: ({ agentId, card }, serverId) =>
          remotePublish(
            serverId,
            AGENT_PUBLISH_ROUTES.publish,
            {
              agentId,
              card: card && card.byteLength <= AGENT_PUBLISH_IMAGE_BYTES ? Buffer.from(card).toString("base64") : null,
            },
            decodeHostAgentTemplatePublication,
          ),
      }),
      unpublishAgentTemplate: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => runCauseEffect(agentTemplates.unpublish(agentId)),
        remote: (agentId, serverId) =>
          remotePublish(serverId, AGENT_PUBLISH_ROUTES.unpublish, { agentId }, acceptEmpty),
      }),
    },
  };

  function remotePublish<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, AGENT_PUBLISH_CAPABILITY))
      throw new Error(sourceText("error.team.agentPublishUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  function remoteHostSettings(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_HOST_SETTINGS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentHostSettingsFromHost, { method: "POST", body }),
    );
  }

  function remoteBackupModels(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_BACKUP_MODELS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentBackupModelSettings, { method: "POST", body }),
    );
  }

  // A joined server has no browser profile routes yet.
  function remoteBrowserProfiles<A>(serverId: string, path: string, body: unknown, decode: ResponseDecoder<A>) {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PROFILES_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }

  function remoteBrowserProxies<A>(serverId: string, path: string, body: unknown, decode: ResponseDecoder<A>) {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PROXIES_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }

  function remoteTaskLimit(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_TASK_LIMIT_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentTaskLimitSettings, { method: "POST", body }),
    );
  }

  function remoteAgentDefaults(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_DEFAULTS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentDefaultsOverview, { method: "POST", body }));
  }

  function remotePlanCard(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_PLAN_CARD_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentPlanCardSettings, { method: "POST", body }));
  }

  function remoteNewChat(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_NEW_CHAT_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeRemoteAgentNewChatSettings, { method: "POST", body }),
    );
  }

  /**
   * Reads, or with `update` changes, the fast mode of an agent on a joined server: on `agent-speed-v1`,
   * or on `agent-fast-mode-v1` from an older host, which has no Ultrafast.
   */
  async function remoteFastMode(
    serverId: string,
    { agentId }: { agentId: string },
    update?: UpdateAgentFastModeInput,
  ): Promise<AgentFastModeSettings> {
    if (remoteServers.supportsCapability(serverId, AGENT_SPEED_CAPABILITY)) {
      const path = update ? AGENT_SPEED_ROUTES.update : AGENT_SPEED_ROUTES.settings;
      const body = update ? { agentId, speed: agentSpeed(update) } : { agentId };
      const settings = await runCauseEffect(
        remoteServers.request(serverId, path, decodeAgentSpeedSettings, { method: "POST", body }),
      );
      return agentFastModeSettings(settings);
    }
    if (!remoteServers.supportsCapability(serverId, AGENT_FAST_MODE_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    if (update?.ultrafast) throw new Error(sourceText("error.agent.settingsLocalOnly"));
    const path = update ? AGENT_FAST_MODE_ROUTES.update : AGENT_FAST_MODE_ROUTES.settings;
    const body = update ? { agentId, fastMode: update.fastMode } : { agentId };
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeRemoteAgentFastModeSettings, { method: "POST", body }),
    );
  }
}

function addedAgent({ agent }: { agent: { id: string; name: string } }): AddedAgent {
  return { id: agent.id, name: agent.name };
}
