import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";

const chatId = z.string().min(1).max(INPUT_LIMITS.identifier);
const sectionId = chatId;
const name = z.string().trim().min(1).max(INPUT_LIMITS.sidebarSectionName);
export const createSectionToolSchema = z.object({ name }).strict();
export const renameSectionToolSchema = z.object({ sectionId, name }).strict();
export const deleteSectionToolSchema = z.object({ sectionId }).strict();
/** One of `agentId` and `channelId`: the sidebar files a channel in a folder as it does an agent. */
export const assignAgentSectionToolSchema = z
  .object({
    agentId: chatId.optional(),
    channelId: chatId.optional(),
    sectionId: sectionId.nullable(),
  })
  .strict();

export type AgentSidebar = Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "withProfileAssignment">;

export const handleSidebarTool = Effect.fn("SidebarTools.handle")(function* (
  tool: string,
  args: unknown,
  sidebar: AgentSidebar | null,
  agentIds: () => ReadonlySet<string>,
  channelIds: () => ReadonlySet<string>,
) {
  let action: SidebarLayoutAction | null;
  switch (tool) {
    case "list_sections":
      action = null;
      break;
    case "create_section":
      action = { type: "create", ...(yield* toolStep(() => createSectionToolSchema.parse(args))) };
      break;
    case "rename_section":
      action = { type: "rename", ...(yield* toolStep(() => renameSectionToolSchema.parse(args))) };
      break;
    case "delete_section":
      action = { type: "delete", ...(yield* toolStep(() => deleteSectionToolSchema.parse(args))) };
      break;
    case "assign_agent_section": {
      const { agentId, channelId, sectionId } = yield* toolStep(() => assignAgentSectionToolSchema.parse(args));
      const id = channelId ?? agentId;
      if (id === undefined || (agentId !== undefined && channelId !== undefined))
        return openBotToolFailure("Pass one of agentId and channelId.");
      if (channelId !== undefined && !channelIds().has(channelId))
        return openBotToolFailure("Unknown channel. Use a channel id from openbot.list_channels.");
      // A channel id passed as agentId is accepted too: agents tried that before channelId existed.
      if (agentId !== undefined && !agentIds().has(agentId) && !channelIds().has(agentId))
        return openBotToolFailure(
          "Unknown agent. Use an agent id from openbot.list_agents, or a channel id from openbot.list_channels as channelId.",
        );
      action = { type: "assign", agentId: id, sectionId };
      break;
    }
    default:
      return null;
  }
  if (!sidebar) return yield* new ToolOperationFailed({ cause: new Error("Sidebar sections are unavailable.") });
  // The sidebar files agents and channels alike (`AgentService.sidebarChatIds`).
  const layout = action
    ? yield* sidebar.mutate(action, new Set([...agentIds(), ...channelIds()])).pipe(toToolOperationFailed)
    : sidebar.getSnapshot();
  return openBotToolResult(layout);
});
