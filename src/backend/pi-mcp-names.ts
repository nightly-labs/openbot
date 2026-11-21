import { createHash } from "node:crypto";
import { COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";

export const COMPUTER_USE_GUIDE_URI = "skill://cua-driver/SKILL.md";

export function piMcpServerName(kind: "external" | "local", name: string): string {
  return `openbot_${createHash("sha256").update(`${kind}:${name}`).digest("hex").slice(0, 8)}`;
}

export function piComputerUseGuideStep(): string {
  return `It is an MCP resource, not a file, so the read tool cannot open it: load read_mcp_resource with tool_search, then call it with server ${piMcpServerName("external", COMPUTER_USE_MCP_SERVER_NAME)} and uri ${COMPUTER_USE_GUIDE_URI}.`;
}
