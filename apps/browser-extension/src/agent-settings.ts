import {
  type AgentAdminSettings,
  type AgentStatus,
  type AvatarImageInput,
  type ClientAgentModelOption,
  isAgentStatus,
  isClientAgentModelOption,
  type UpdateAgentAdminSettingsInput,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import {
  AGENT_PENDING_RUNTIME_CAPABILITY,
  AGENT_PENDING_RUNTIME_ROUTES,
  pendingRuntimeUpdateBody,
} from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import {
  getAgentAdminSettings,
  setAgentChatColor,
  setAgentColor,
  updateAgentAdminSettings,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";

const decodeModels = guardedListDecoder(isClientAgentModelOption, "models");
const ignore = () => null;

/**
 * The agent settings of a joined server, as the web client changes them (`web-runtime.ts`). The host
 * checks each change: a member who may not change a setting gets the host's refusal in the panel.
 */
export function createAgentSettingsApi(request: TeamApiRequest, capabilities: readonly string[]) {
  const has = (capability: string) => capabilities.includes(capability);
  const send = (method: string, path: string, body?: TeamProtocolV2Json) => request(method, path, ignore, body);

  return {
    /** The models the panel's picker lists, and the providers' state. */
    async catalog(): Promise<{ models: ClientAgentModelOption[]; status: AgentStatus }> {
      const [models, status] = await Promise.all([
        request("GET", TEAM_API_ROUTES.agents.models, decodeModels),
        request("GET", TEAM_API_ROUTES.agents.status, (value) => {
          if (!isAgentStatus(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
          return value;
        }),
      ]);
      return { models, status };
    },

    /** A model change waits for the agent's turn (`agent-pending-runtime-v1`); colours have their own routes. */
    async updateAgent(input: UpdateAgentInput): Promise<void> {
      const runtimeChange = has(AGENT_PENDING_RUNTIME_CAPABILITY) ? pendingRuntimeUpdateBody(input) : null;
      if (runtimeChange) {
        await send("POST", AGENT_PENDING_RUNTIME_ROUTES.update, runtimeChange);
        return;
      }
      const {
        providerAccountId: _providerAccountId,
        backupModels: _backupModels,
        leaveUsageLimit: _leaveUsageLimit,
        avatarColor,
        chatColor,
        ...fields
      } = input;
      const chatColors = has(CHAT_COLORS_CAPABILITY);
      if (chatColor !== undefined && !chatColors) throw new Error(currentText().t("error.team.chatColorsUnsupported"));
      if (chatColor !== undefined)
        await runTeamEffect(setAgentChatColor(request, { agentId: input.agentId, color: chatColor }));
      const colors = has(AGENT_COLORS_CAPABILITY);
      const { avatarHue: _avatarHue, ...withoutHue } = fields;
      const profile = colors && avatarColor ? withoutHue : fields;
      if (colors && avatarColor !== undefined)
        await runTeamEffect(setAgentColor(request, { agentId: input.agentId, color: avatarColor }));
      const colourRouted = chatColor !== undefined || (colors && avatarColor !== undefined);
      if (!colourRouted || Object.entries(profile).some(([key, value]) => key !== "agentId" && value !== undefined))
        await send("PATCH", TEAM_API_ROUTES.agent.one(input.agentId), { ...profile });
    },

    async setAvatar(agentId: string, image: AvatarImageInput | null): Promise<void> {
      if (!image) {
        await send("DELETE", TEAM_API_ROUTES.agent.avatar(agentId));
        return;
      }
      await request(
        "PUT",
        TEAM_API_ROUTES.agent.avatar(agentId),
        ignore,
        {},
        {
          name: "avatar",
          mimeType: image.mimeType,
          base64: bytesToBase64(image.bytes),
        },
      );
    },

    /** The Permissions level, which only an owner or an admin reads. Null for anyone else. */
    async adminSettings(agentId: string): Promise<AgentAdminSettings | null> {
      if (!has(AGENT_ADMIN_CAPABILITY)) return null;
      return runTeamEffect(getAgentAdminSettings(request, agentId)).catch(() => null);
    },
    async updatePermissions(input: UpdateAgentAdminSettingsInput): Promise<AgentAdminSettings> {
      return runTeamEffect(updateAgentAdminSettings(request, input));
    },

    /** The agent forgets the messages before now and keeps its setup. */
    startNewChat: has(CONTEXT_RESET_CAPABILITY)
      ? async (agentId: string) => {
          await send("POST", CONTEXT_RESET_ROUTES.clear, { agentId });
        }
      : null,
    /** Deletes the messages of the agent's own chat. */
    deleteHistory: has(CHAT_HISTORY_CAPABILITY)
      ? async (agentId: string) => {
          await send("POST", CHAT_HISTORY_ROUTES.agentDelete, { agentId });
        }
      : null,
  };
}

export type AgentSettingsApi = ReturnType<typeof createAgentSettingsApi>;
