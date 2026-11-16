import {
  HOST_MEMBER_UPDATE_CAPABILITY,
  memberUpdateRoute,
} from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_CAPABILITY, HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { Effect, Result } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The server name, logo, timezone, agent memory limit, memory review, prompt cache time, model list
// and app update of one server's host. On a joined server the request goes to the host. Identity,
// timezone, memory limit, memory review, prompt cache time, model list, settings, cancellation, and
// forced restarts require an owner or admin.
// Ordinary members can check and request an idle update through host-member-update-v1.

import {
  type AgentAccessChange,
  type AgentAccessSnapshot,
  type AgentProviderRef,
  decodeAgentAccessSnapshot,
  decodeHostAgentMemoryLimit,
  decodeHostBrowsingMemory,
  decodeHostMemoryReview,
  decodeHostPersonality,
  decodeHostSkillLearning,
  decodeHostTimezoneSettings,
  decodeHostTurnLimits,
  decodeHostUpdateStatus,
  decodeMachineAlertSettings,
  decodePromptCacheTtlSetting,
  decodeProviderModelVisibility,
  decodeServerAuditLog,
  type HostPersonality,
  type HostTurnLimitsInput,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  hostAgentMemoryLimit,
  hostBrowsingMemory,
  hostMemoryReview,
  hostSkillLearning,
  isClaudeCompactWindowTokens,
  isPromptCacheTtl,
  isSkillLearningMode,
  LEGACY_RESPONSE_STYLE,
  LOCAL_SERVER_ID,
  type MachineAlertSettings,
  type PromptCacheTtl,
  type ProviderModelVisibilityChange,
  parseAgentAccessChange,
  parseHostTurnLimitsInput,
  parseProviderModelVisibilityChange,
  parseProviderModelVisibilityProvider,
  type ServerAuditLog,
  type ServerAuditName,
  type ServerSummary,
  UPDATE_RESTART_MODES,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { AGENT_ACCESS_CAPABILITY, AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import {
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_MEMORY_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import {
  BROWSING_MEMORY_CAPABILITY,
  BROWSING_MEMORY_ROUTES,
} from "@openbot/contracts/team-protocol/browsing-memory-v1";
import {
  CLAUDE_COMPACT_WINDOW_CAPABILITY,
  CLAUDE_COMPACT_WINDOW_ROUTES,
  decodeClaudeCompactWindowResponse,
} from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import {
  CLAUDE_USER_SETUP_CAPABILITY,
  CLAUDE_USER_SETUP_ROUTES,
  decodeClaudeUserSetupResponse,
} from "@openbot/contracts/team-protocol/claude-user-setup-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import {
  HOST_APPEARANCE_CAPABILITY,
  HOST_APPEARANCE_ROUTES,
  type ServerAppearance,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import {
  HOST_KEY_ROTATION_CAPABILITY,
  HOST_KEY_ROTATION_ROUTES,
} from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import {
  HOST_PERSONALITY_CAPABILITY,
  HOST_PERSONALITY_ROUTES,
} from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RESTART_CAPABILITY, HOST_RESTART_ROUTES } from "@openbot/contracts/team-protocol/host-restart-v1";
import { HOST_TIMEZONE_CAPABILITY, HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import {
  HOST_TURN_LIMITS_CAPABILITY,
  HOST_TURN_LIMITS_ROUTES,
} from "@openbot/contracts/team-protocol/host-turn-limits-v1";
import { HOST_UPDATE_CAPABILITY, HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MEMORY_REVIEW_CAPABILITY, MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import {
  MODEL_VISIBILITY_CAPABILITY,
  MODEL_VISIBILITY_ROUTES,
} from "@openbot/contracts/team-protocol/model-visibility-v1";
import {
  PROMPT_CACHE_TTL_CAPABILITY,
  PROMPT_CACHE_TTL_ROUTES,
} from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { SERVER_AUDIT_CAPABILITY, SERVER_AUDIT_ROUTES } from "@openbot/contracts/team-protocol/server-audit-v1";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type AgentAccessStore, agentAccessSnapshot } from "../agent-access-store";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { BrowsingMemoryPreferenceStore } from "../browsing-memory-preference-store";
import type { ClaudeCompactWindowControl } from "../claude-compact-window-preference-store";
import type { ClaudeUserSetupControl } from "../claude-user-setup-preference-store";
import type { HostService } from "../host-service";
import type { HostTurnLimitsPreferenceStore } from "../host-turn-limits-preference-store";
import type { MachineAlertMonitor } from "../machine-alerts";
import type { MemoryReviewPreferenceStore } from "../memory-review-preference-store";
import type { ModelVisibility } from "../model-visibility";
import type { PromptCacheTtlPreferenceStore } from "../prompt-cache-ttl-preference-store";
import { acceptEmpty, decodeHostReleaseStatusFromHost, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { ServerAuditStore } from "../server-audit-store";
import { parseServerPersonality, type ServerPersonalityPreferenceStore } from "../server-personality-preference-store";
import { parseServerTimezone, type ServerTimezonePreferenceStore } from "../server-timezone-preference-store";
import type { SkillLearningPreferenceStore } from "../skill-learning-preference-store";
import { parseAgentMemoryLimitPreference, parseHostUpdateSettings, parseMemoryReviewPreference } from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { parseHostIdentity } from "./server-inputs";
import { withLocalHostSummary } from "./team-handlers";

interface HostAdminRemoteServers {
  list(): ServerSummary[];
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
  refreshIdentity(serverId: string): Effect.Effect<ServerSummary, RemoteWorkflowError>;
  applyAppearance(
    serverId: string,
    appearance: ServerAppearance | null,
  ): Effect.Effect<ServerSummary, RemoteWorkflowError>;
}

interface HostAdminIpcDependencies {
  host: Pick<HostService, "updateIdentity" | "rotateIdentityKey">;
  remoteServers: HostAdminRemoteServers;
  serverTimezone: Pick<ServerTimezonePreferenceStore, "get" | "set">;
  hostTurnLimits: Pick<HostTurnLimitsPreferenceStore, "get" | "set">;
  serverPersonality: Pick<ServerPersonalityPreferenceStore, "get" | "set">;
  agentMemoryLimit: AgentMemoryLimitSetting;
  memoryReview: MemoryReviewPreferenceStore;
  skillLearning: SkillLearningPreferenceStore;
  browsingMemory: BrowsingMemoryPreferenceStore;
  machineAlerts: Pick<MachineAlertMonitor, "alerts" | "setAlerts" | "canBeResponsible">;
  promptCacheTtl: Pick<PromptCacheTtlPreferenceStore, "get" | "set">;
  claudeUserSetup: ClaudeUserSetupControl;
  claudeCompactWindow: ClaudeCompactWindowControl;
  modelVisibility: Pick<ModelVisibility, "settings" | "set">;
  agentAccess: Pick<AgentAccessStore, "levels" | "set">;
  serverAudit: Pick<ServerAuditStore, "read">;
  /** The server ID of this computer's host, when it has one. Roles are stored by it. */
  localServerId: () => string | undefined;
  localAgentIds: () => string[];
  /** The owner member of this computer's host, who makes each local change, for the audit log. */
  localOwner: () => ServerAuditName | null;
}

// The user of this computer owns its server, so the roles give them every agent.
export const LOCAL_OWNER = { id: "local-owner", role: "owner" } as const;

/** The body of a `host-update-v1` route: `start` carries the mode, `settings` the switches. */
type HostUpdateBody = Record<string, never> | { restart: UpdateRestartMode } | HostUpdateSettingsChange;

export function hostAdminIpcHandlers({
  host,
  remoteServers,
  serverTimezone,
  hostTurnLimits,
  serverPersonality,
  agentMemoryLimit,
  memoryReview,
  skillLearning,
  browsingMemory,
  machineAlerts,
  promptCacheTtl,
  claudeUserSetup,
  claudeCompactWindow,
  modelVisibility,
  agentAccess,
  serverAudit,
  localServerId,
  localAgentIds,
  localOwner,
}: HostAdminIpcDependencies): Pick<IpcGroupHandlers, "hostAdmin"> {
  function remoteUpdate(serverId: string, route: string, body: HostUpdateBody): Promise<HostUpdateStatus> {
    const role = remoteServers.list().find((server) => server.id === serverId)?.role;
    const memberRoute = role === "member" && memberUpdateRoute(route);
    if (memberRoute && remoteServers.supportsCapability(serverId, HOST_MEMBER_UPDATE_CAPABILITY)) {
      return runCauseEffect(
        remoteServers.request(serverId, memberRoute, decodeHostUpdateStatus, { method: "POST", body: {} }),
      );
    }
    if (!remoteServers.supportsCapability(serverId, HOST_UPDATE_CAPABILITY))
      throw new Error(sourceText("error.team.hostUpdateUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostUpdateStatus, { method: "POST", body }));
  }
  function remoteTimezone(serverId: string, route: string, body: { timezone?: string | null }) {
    if (!remoteServers.supportsCapability(serverId, HOST_TIMEZONE_CAPABILITY))
      throw new Error(sourceText("error.team.hostTimezoneUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostTimezoneSettings, { method: "POST", body }));
  }
  function remoteTurnLimits(serverId: string, route: string, body: Record<string, never> | HostTurnLimitsInput) {
    if (!remoteServers.supportsCapability(serverId, HOST_TURN_LIMITS_CAPABILITY))
      throw new Error(sourceText("error.team.hostTurnLimitsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostTurnLimits, { method: "POST", body }));
  }
  function remotePersonality(serverId: string, route: string, body: Record<string, never> | HostPersonality) {
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostPersonality, { method: "POST", body }));
  }
  function remoteMemoryLimit(serverId: string, route: string, body: { limit?: number }) {
    if (!remoteServers.supportsCapability(serverId, AGENT_MEMORY_LIMIT_CAPABILITY))
      throw new Error(sourceText("error.team.agentMemoryLimitUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostAgentMemoryLimit, { method: "POST", body }));
  }
  function remoteMemoryReview(serverId: string, route: string, body: { interval?: number }) {
    if (!remoteServers.supportsCapability(serverId, MEMORY_REVIEW_CAPABILITY))
      throw new Error(sourceText("error.team.memoryReviewUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostMemoryReview, { method: "POST", body }));
  }
  function remoteSkillLearning(serverId: string, route: string, body: { mode?: string }) {
    if (!remoteServers.supportsCapability(serverId, SKILL_LEARNING_CAPABILITY))
      throw new Error(sourceText("error.team.skillLearningUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostSkillLearning, { method: "POST", body }));
  }
  function remoteBrowsingMemory(serverId: string, route: string, body: { enabled?: boolean }) {
    if (!remoteServers.supportsCapability(serverId, BROWSING_MEMORY_CAPABILITY))
      throw new Error(sourceText("error.team.browsingMemoryUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostBrowsingMemory, { method: "POST", body }));
  }
  function remoteMachineAlerts(serverId: string, route: string, body: MachineAlertSettings | Record<string, never>) {
    if (!remoteServers.supportsCapability(serverId, MACHINE_RESOURCES_CAPABILITY))
      throw new Error(sourceText("error.team.machineResourcesUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeMachineAlertSettings, { method: "POST", body }));
  }
  function remotePromptCacheTtl(serverId: string, route: string, body: { ttl?: PromptCacheTtl }) {
    if (!remoteServers.supportsCapability(serverId, PROMPT_CACHE_TTL_CAPABILITY))
      throw new Error(sourceText("error.team.promptCacheTtlUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, route, decodePromptCacheTtlSetting, { method: "POST", body }),
    );
  }
  function remoteClaudeUserSetup(serverId: string, route: string, body: { enabled?: boolean }) {
    if (!remoteServers.supportsCapability(serverId, CLAUDE_USER_SETUP_CAPABILITY))
      throw new Error(sourceText("error.team.claudeUserSetupUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, route, decodeClaudeUserSetupResponse, { method: "POST", body }),
    );
  }
  function remoteClaudeCompactWindow(serverId: string, route: string, body: { tokens?: number | null }) {
    if (!remoteServers.supportsCapability(serverId, CLAUDE_COMPACT_WINDOW_CAPABILITY))
      throw new Error(sourceText("error.team.claudeCompactWindowUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, route, decodeClaudeCompactWindowResponse, { method: "POST", body }),
    );
  }
  function remoteModelVisibility(
    serverId: string,
    route: string,
    body: { provider: AgentProviderRef } | ProviderModelVisibilityChange,
  ) {
    if (!remoteServers.supportsCapability(serverId, MODEL_VISIBILITY_CAPABILITY))
      throw new Error(sourceText("error.team.modelVisibilityUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, route, decodeProviderModelVisibility, { method: "POST", body }),
    );
  }
  function localAccessServerId(): string {
    const serverId = localServerId();
    if (!serverId) throw new Error(sourceText("error.team.agentAccessUnsupported"));
    return serverId;
  }
  function remoteAccess(
    serverId: string,
    route: string,
    body: AgentAccessChange | Record<string, never>,
  ): Promise<AgentAccessSnapshot> {
    if (!remoteServers.supportsCapability(serverId, AGENT_ACCESS_CAPABILITY))
      throw new Error(sourceText("error.team.agentAccessUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeAgentAccessSnapshot, { method: "POST", body }));
  }
  // This computer updates from Settings. The renderer shows the tab for a joined server only.
  const localUpdate = (): never => {
    throw new Error(sourceText("error.team.hostUpdateUnsupported"));
  };
  return {
    hostAdmin: {
      updateIdentity: scopedHandler(parseHostIdentity, {
        local: async (input) => {
          const status = await runCauseEffect(host.updateIdentity(input));
          const summary = withLocalHostSummary(remoteServers.list(), status).find(
            (server) => server.id === LOCAL_SERVER_ID,
          );
          if (!summary) throw new Error(sourceText("error.host.noServer"));
          return summary;
        },
        remote: async (input, serverId) => {
          const { appearance, ...identity } = input;
          const changesIdentity = identity.serverName !== undefined || identity.logo !== undefined;
          // Both gates first, so a change that the host cannot take in full sends nothing.
          if (changesIdentity && !remoteServers.supportsCapability(serverId, HOST_ADMIN_CAPABILITY))
            throw new Error(sourceText("error.host.identityLocalOnly"));
          if (appearance !== undefined && !remoteServers.supportsCapability(serverId, HOST_APPEARANCE_CAPABILITY))
            throw new Error(sourceText("error.team.hostIdentityUnsupported"));
          if (changesIdentity) {
            await runCauseEffect(
              remoteServers.request(serverId, HOST_ADMIN_ROUTES.identity, acceptEmpty, {
                method: "POST",
                body: wireIdentity(identity),
              }),
            );
          }
          if (appearance !== undefined) {
            await runCauseEffect(
              remoteServers.request(serverId, HOST_APPEARANCE_ROUTES.appearance, acceptEmpty, {
                method: "POST",
                body: { appearance },
              }),
            );
            // The host also sends `host-appearance`; this shows the change before that event arrives.
            if (!changesIdentity) return runCauseEffect(remoteServers.applyAppearance(serverId, appearance));
            await runCauseEffect(remoteServers.applyAppearance(serverId, appearance));
          }
          // The host has published the change before it answered, so this reads the new name and logo.
          return runCauseEffect(remoteServers.refreshIdentity(serverId));
        },
      }),
      // Local: this app has nothing that starts it again after a quit. The renderer shows the action only
      // for a joined server whose host has `host-restart-v1`.
      restartHost: scopedQueryHandler({
        local: () => {
          throw new Error(sourceText("error.team.hostRestartUnsupported"));
        },
        remote: async (serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_RESTART_CAPABILITY))
            throw new Error(sourceText("error.team.hostRestartUnsupported"));
          await runCauseEffect(
            remoteServers.request(serverId, HOST_RESTART_ROUTES.restart, acceptEmpty, { method: "POST", body: {} }),
          );
        },
      }),
      rotateHostKey: scopedQueryHandler({
        local: async () => {
          await runCauseEffect(host.rotateIdentityKey());
        },
        // Owner only: the host refuses an admin or a member with 403.
        remote: async (serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_KEY_ROTATION_CAPABILITY))
            throw new Error(sourceText("error.team.hostKeyRotationUnsupported"));
          await runCauseEffect(
            remoteServers.request(serverId, HOST_KEY_ROTATION_ROUTES.rotate, acceptEmpty, {
              method: "POST",
              body: {},
            }),
          );
          // The answer does not make the new key trusted. The directory carries the handover that the
          // previous key signed, and this read follows it. The key is changed, so a failed read is not
          // a failure of the change: the next read follows it.
          await runCauseEffect(remoteServers.refreshIdentity(serverId)).catch(() => undefined);
        },
      }),
      getReleaseStatus: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, HOST_RELEASE_CAPABILITY)
            ? runCauseEffect(
                remoteServers.request(serverId, HOST_RELEASE_ROUTES.status, decodeHostReleaseStatusFromHost, {
                  method: "POST",
                  body: {},
                }),
              )
            : Promise.resolve(null),
      }),
      checkRelease: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_RELEASE_CAPABILITY)) return localUpdate();
          return runCauseEffect(
            remoteServers.request(serverId, HOST_RELEASE_ROUTES.check, decodeHostReleaseStatusFromHost, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      getUpdateStatus: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.status, {}),
      }),
      checkForUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.check, {}),
      }),
      startUpdate: scopedHandler(parseRestartMode, {
        local: localUpdate,
        remote: (restart, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.start, { restart }),
      }),
      cancelUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.cancel, {}),
      }),
      setUpdateSettings: scopedHandler(parseHostUpdateSettings, {
        local: localUpdate,
        remote: (settings, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.settings, settings),
      }),
      getTimezone: scopedQueryHandler({
        local: () => serverTimezone.get(),
        remote: (serverId) => remoteTimezone(serverId, HOST_TIMEZONE_ROUTES.settings, {}),
      }),
      setTimezone: scopedHandler(parseServerTimezone, {
        local: (timezone) => runCauseEffect(serverTimezone.set(timezone)),
        remote: (timezone, serverId) => remoteTimezone(serverId, HOST_TIMEZONE_ROUTES.update, { timezone }),
      }),
      getTurnLimits: scopedQueryHandler({
        local: () => hostTurnLimits.get(),
        remote: (serverId) => remoteTurnLimits(serverId, HOST_TURN_LIMITS_ROUTES.settings, {}),
      }),
      setTurnLimits: scopedHandler(parseHostTurnLimitsInput, {
        local: (input) => runCauseEffect(hostTurnLimits.set(input)),
        remote: (input, serverId) => remoteTurnLimits(serverId, HOST_TURN_LIMITS_ROUTES.update, input),
      }),
      // A host before host-personality-v1 uses the classic prompt.
      getPersonality: scopedQueryHandler({
        local: () => serverPersonality.get(),
        remote: async (serverId) =>
          remoteServers.supportsCapability(serverId, HOST_PERSONALITY_CAPABILITY)
            ? remotePersonality(serverId, HOST_PERSONALITY_ROUTES.settings, {})
            : { responseStyle: LEGACY_RESPONSE_STYLE },
      }),
      setPersonality: scopedHandler(parseServerPersonality, {
        local: (personality) => runCauseEffect(serverPersonality.set(personality)),
        remote: (personality, serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_PERSONALITY_CAPABILITY))
            throw new Error(sourceText("error.team.hostPersonalityUnsupported"));
          return remotePersonality(serverId, HOST_PERSONALITY_ROUTES.update, personality);
        },
      }),
      getAgentMemoryLimit: scopedQueryHandler({
        local: () => hostAgentMemoryLimit(agentMemoryLimit.get()),
        remote: (serverId) => remoteMemoryLimit(serverId, AGENT_MEMORY_LIMIT_ROUTES.settings, {}),
      }),
      // The host checks the value against its own choices, so a remote limit is any positive count.
      setAgentMemoryLimit: scopedHandler(parseMemoryLimitCount, {
        local: async (limit) =>
          hostAgentMemoryLimit(await runCauseEffect(agentMemoryLimit.set(parseAgentMemoryLimitPreference({ limit })))),
        remote: (limit, serverId) => remoteMemoryLimit(serverId, AGENT_MEMORY_LIMIT_ROUTES.update, { limit }),
      }),
      getMemoryReview: scopedQueryHandler({
        local: () => hostMemoryReview(memoryReview.get()),
        remote: (serverId) => remoteMemoryReview(serverId, MEMORY_REVIEW_ROUTES.settings, {}),
      }),
      // The host checks the value against its own choices, so a remote value is any count; 0 is off.
      setMemoryReview: scopedHandler(parseMemoryReviewCount, {
        local: async (interval) =>
          hostMemoryReview(await runCauseEffect(memoryReview.set(parseMemoryReviewPreference({ interval })))),
        remote: (interval, serverId) => remoteMemoryReview(serverId, MEMORY_REVIEW_ROUTES.update, { interval }),
      }),
      getSkillLearning: scopedQueryHandler({
        local: () => hostSkillLearning(skillLearning.get()),
        remote: (serverId) => remoteSkillLearning(serverId, SKILL_LEARNING_ROUTES.settings, {}),
      }),
      // The host checks the value against its own choices, so a remote value is any short text.
      setSkillLearning: scopedHandler(parseSkillLearningText, {
        local: async (mode) => {
          if (!isSkillLearningMode(mode)) throw new Error("Skill learning mode is required.");
          return hostSkillLearning(await runCauseEffect(skillLearning.set({ mode })));
        },
        remote: (mode, serverId) => remoteSkillLearning(serverId, SKILL_LEARNING_ROUTES.update, { mode }),
      }),
      getBrowsingMemory: scopedQueryHandler({
        local: () => hostBrowsingMemory(browsingMemory.get()),
        remote: (serverId) => remoteBrowsingMemory(serverId, BROWSING_MEMORY_ROUTES.settings, {}),
      }),
      setBrowsingMemory: scopedHandler(parseBrowsingMemoryEnabled, {
        local: async (enabled) => hostBrowsingMemory(await runCauseEffect(browsingMemory.set({ enabled }))),
        remote: (enabled, serverId) => remoteBrowsingMemory(serverId, BROWSING_MEMORY_ROUTES.update, { enabled }),
      }),
      getMachineAlerts: scopedQueryHandler({
        local: () => machineAlerts.alerts(),
        remote: (serverId) => remoteMachineAlerts(serverId, MACHINE_RESOURCES_ROUTES.alerts, {}),
      }),
      // The host checks the member, so a remote change is checked only for its shape here.
      setMachineAlerts: scopedHandler(decodeMachineAlertSettings, {
        local: (settings) => {
          if (!machineAlerts.canBeResponsible(settings.responsibleMemberId))
            throw new Error(sourceText("error.team.machineAlertMemberInvalid"));
          return runCauseEffect(machineAlerts.setAlerts(settings));
        },
        remote: (settings, serverId) => remoteMachineAlerts(serverId, MACHINE_RESOURCES_ROUTES.updateAlerts, settings),
      }),
      getPromptCacheTtl: scopedQueryHandler({
        local: () => promptCacheTtl.get(),
        remote: (serverId) => remotePromptCacheTtl(serverId, PROMPT_CACHE_TTL_ROUTES.settings, {}),
      }),
      setPromptCacheTtl: scopedHandler(parsePromptCacheTtl, {
        local: (ttl) => runCauseEffect(promptCacheTtl.set(ttl)),
        remote: (ttl, serverId) => remotePromptCacheTtl(serverId, PROMPT_CACHE_TTL_ROUTES.update, { ttl }),
      }),
      getClaudeUserSetup: scopedQueryHandler({
        local: () => claudeUserSetup.get(),
        remote: (serverId) => remoteClaudeUserSetup(serverId, CLAUDE_USER_SETUP_ROUTES.settings, {}),
      }),
      setClaudeUserSetup: scopedHandler(parseClaudeUserSetup, {
        local: (enabled) => runCauseEffect(claudeUserSetup.set(enabled)),
        remote: (enabled, serverId) => remoteClaudeUserSetup(serverId, CLAUDE_USER_SETUP_ROUTES.update, { enabled }),
      }),
      getClaudeCompactWindow: scopedQueryHandler({
        local: () => claudeCompactWindow.get(),
        remote: (serverId) => remoteClaudeCompactWindow(serverId, CLAUDE_COMPACT_WINDOW_ROUTES.settings, {}),
      }),
      setClaudeCompactWindow: scopedHandler(parseClaudeCompactWindow, {
        local: (tokens) => runCauseEffect(claudeCompactWindow.set(tokens)),
        remote: (tokens, serverId) =>
          remoteClaudeCompactWindow(serverId, CLAUDE_COMPACT_WINDOW_ROUTES.update, { tokens }),
      }),
      getModelVisibility: scopedHandler(parseProviderModelVisibilityProvider, {
        local: (provider) => runCauseEffect(modelVisibility.settings(provider)),
        remote: (provider, serverId) => remoteModelVisibility(serverId, MODEL_VISIBILITY_ROUTES.settings, { provider }),
      }),
      setModelVisibility: scopedHandler(parseProviderModelVisibilityChange, {
        local: (change) => runCauseEffect(modelVisibility.set(change)),
        remote: (change, serverId) => remoteModelVisibility(serverId, MODEL_VISIBILITY_ROUTES.update, change),
      }),
      getAgentAccess: scopedQueryHandler({
        local: () => {
          const serverId = localAccessServerId();
          return agentAccessSnapshot(agentAccess.levels(serverId), LOCAL_OWNER, localAgentIds());
        },
        remote: (serverId) => remoteAccess(serverId, AGENT_ACCESS_ROUTES.read, {}),
      }),
      setAgentAccess: scopedHandler(parseAgentAccessChange, {
        local: async (change) => {
          const serverId = localAccessServerId();
          // The local owner sees every agent of this host.
          const shown = new Set(localAgentIds());
          const saved = await Effect.runPromise(
            Effect.result(agentAccess.set(serverId, change, shown, shown, localOwner())),
          );
          if (Result.isFailure(saved)) {
            if (saved.failure._tag === "AgentAccessStale") throw new Error(sourceText("error.team.agentAccessStale"));
            throw saved.failure.cause;
          }
          return agentAccessSnapshot(agentAccess.levels(serverId), LOCAL_OWNER, [...shown]);
        },
        remote: (change, serverId) => remoteAccess(serverId, AGENT_ACCESS_ROUTES.set, change),
      }),
      getAuditLog: scopedQueryHandler({
        // A computer that does not host a server has no changes to show.
        local: (): ServerAuditLog => {
          const serverId = localServerId();
          return serverId ? serverAudit.read(serverId) : { entries: [] };
        },
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, SERVER_AUDIT_CAPABILITY))
            throw new Error(sourceText("error.team.serverAuditUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, SERVER_AUDIT_ROUTES.read, decodeServerAuditLog, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
    },
  };
}

function wireIdentity(input: UpdateHostIdentityInput) {
  return {
    ...(input.serverName === undefined ? {} : { serverName: input.serverName }),
    ...(input.logo === undefined
      ? {}
      : {
          logo: input.logo
            ? { mimeType: input.logo.mimeType, data: Buffer.from(input.logo.bytes).toString("base64") }
            : null,
        }),
  };
}

function parseClaudeUserSetup(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid Claude setup setting.");
  return value;
}

function parseClaudeCompactWindow(value: unknown): number | null {
  if (!isClaudeCompactWindowTokens(value)) throw new Error("Invalid Claude compaction size.");
  return value;
}

function parsePromptCacheTtl(value: unknown): PromptCacheTtl {
  if (!isPromptCacheTtl(value)) throw new Error("Prompt cache time is required.");
  return value;
}

function parseMemoryReviewCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Memory review interval is required.");
  return value;
}

function parseSkillLearningText(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 32) throw new Error("Skill learning mode is required.");
  return value;
}

function parseBrowsingMemoryEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Browsing memory setting is required.");
  return value;
}

function parseMemoryLimitCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Agent memory limit is required.");
  return value;
}

function parseRestartMode(value: unknown): UpdateRestartMode {
  if (!isOneOf(UPDATE_RESTART_MODES, value)) throw new Error("A restart mode is required.");
  return value;
}
