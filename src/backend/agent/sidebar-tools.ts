import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { z } from "zod";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";

const sectionId = z.string().min(1).max(INPUT_LIMITS.identifier);
const name = z.string().trim().min(1).max(INPUT_LIMITS.sidebarSectionName);
export const createSectionToolSchema = z.object({ name }).strict();
export const renameSectionToolSchema = z.object({ sectionId, name }).strict();
export const deleteSectionToolSchema = z.object({ sectionId }).strict();
export const assignAgentSectionToolSchema = z
  .object({
    agentId: z.string().min(1).max(INPUT_LIMITS.identifier),
    sectionId: sectionId.nullable(),
  })
  .strict();

export type AgentSidebar = Pick<SidebarLayoutStore, "getSnapshot" | "mutate">;

export async function handleSidebarTool(
  tool: string,
  args: unknown,
  sidebar: AgentSidebar | null,
  agentIds: ReadonlySet<string>,
): Promise<OpenBotToolResponse | null> {
  let action: SidebarLayoutAction | null;
  switch (tool) {
    case "list_sections":
      action = null;
      break;
    case "create_section":
      action = { type: "create", ...createSectionToolSchema.parse(args) };
      break;
    case "rename_section":
      action = { type: "rename", ...renameSectionToolSchema.parse(args) };
      break;
    case "delete_section":
      action = { type: "delete", ...deleteSectionToolSchema.parse(args) };
      break;
    case "assign_agent_section":
      action = { type: "assign", ...assignAgentSectionToolSchema.parse(args) };
      break;
    default:
      return null;
  }
  if (!sidebar) throw new Error("Sidebar sections are unavailable.");
  const layout = action ? await sidebar.mutate(action, agentIds) : sidebar.getSnapshot();
  return openBotToolResult(layout);
}
