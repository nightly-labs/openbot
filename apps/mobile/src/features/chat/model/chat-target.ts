import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export type ChatTarget =
  | (Pick<MobileAgent, "id" | "serverId" | "name" | "avatarSeed" | "avatarHue"> & { kind: "agent" })
  | { kind: "channel"; id: string; serverId: string; name: string; members: MobileAgent[] };

/** The target of a chat with one agent, such as an agent task. */
export type AgentChatTarget = Extract<ChatTarget, { kind: "agent" }>;
