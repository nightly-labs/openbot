import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";

const sectionId = z.string().min(1).max(INPUT_LIMITS.identifier);
const name = z.string().trim().min(1).max(INPUT_LIMITS.sidebarSectionName);
export const createSectionToolSchema = z.object({ name }).strict();
export const renameSectionToolSchema = z.object({ sectionId, name }).strict();
export const deleteSectionToolSchema = z.object({ sectionId }).strict();
/** `agentId` also takes a channel id: the sidebar files a channel in a folder as it does an agent. */
export const assignAgentSectionToolSchema = z
  .object({
    agentId: z.string().min(1).max(INPUT_LIMITS.identifier),
    sectionId: sectionId.nullable(),
  })
  .strict();

/** `removeAgent` is for `delete_agent`, which removes a deleted agent from the sidebar as the app does. */
export type AgentSidebar = Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "withProfileAssignment" | "removeAgent">;

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
      const assignment = yield* toolStep(() => assignAgentSectionToolSchema.parse(args));
      if (!agentIds().has(assignment.agentId) && !channelIds().has(assignment.agentId))
        return openBotToolFailure(
          "Unknown agent or channel. Use an id from openbot.list_agents or openbot.list_channels.",
        );
      action = { type: "assign", ...assignment };
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
