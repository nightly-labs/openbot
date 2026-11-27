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
      icon?: ChannelIcon | null;
      imageUrl?: string | null;
    };

export type AgentChatTarget = Extract<ChatTarget, { kind: "agent" }>;
