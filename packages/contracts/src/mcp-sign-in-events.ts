import type { ConversationMessage } from "./ipc-conversation-messages";

export const MCP_SIGN_IN_ITEM_TYPE_PREFIX = "mcp-sign-in:";

/** An MCP server an agent saved that waits for the user's sign-in. The person signs in from the card. */
export interface McpSignInEvent {
  mcpServerId: string;
}

/** The id of a saved row, short enough that the item type stays within its 128 characters. */
function isMcpServerId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,116}$/u.test(value);
}

export function mcpSignInItemType(event: McpSignInEvent): string {
  if (!isMcpServerId(event.mcpServerId)) throw new Error("A valid MCP server id is required.");
  return `${MCP_SIGN_IN_ITEM_TYPE_PREFIX}${event.mcpServerId}`;
}

export function mcpSignInEvent(message: ConversationMessage): McpSignInEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(MCP_SIGN_IN_ITEM_TYPE_PREFIX)) return null;
  const mcpServerId = message.itemType.slice(MCP_SIGN_IN_ITEM_TYPE_PREFIX.length);
  return isMcpServerId(mcpServerId) ? { mcpServerId } : null;
}
