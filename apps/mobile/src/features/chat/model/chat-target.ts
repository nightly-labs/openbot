import type { ChannelIcon } from "@openbot/contracts/ipc";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export type ChatTarget =
  | (Pick<MobileAgent, "id" | "serverId" | "name" | "avatarSeed" | "avatarHue" | "avatarColor"> & { kind: "agent" })
  | {
      kind: "channel";
      id: string;
      serverId: string;
      name: string;
      members: MobileAgent[];
      /** The channel picture, which takes the place of the member faces. */
      icon?: ChannelIcon | null;
      imageUrl?: string | null;
    };

/** The target of a chat with one agent, such as an agent task. */
export type AgentChatTarget = Extract<ChatTarget, { kind: "agent" }>;
