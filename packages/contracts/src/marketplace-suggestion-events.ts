import type { ConversationMessage } from "./ipc-conversation-messages";
import { isPluginSlug } from "./plugin-links";

export const MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX = "marketplace-suggestion:";

/**
 * Every connector, in the order that Marketplace › Apps shows them. A
 * connector id is also its Marketplace app id, so an agent can suggest it in a conversation.
 */
export const CONNECTOR_IDS = [
  "slack",
  "discord",
  "telegram",
  "github",
  "onepassword",
  "bitwarden",
  "telegram-account",
  "whatsapp-account",
] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** A Marketplace app an agent suggests in the conversation. The person decides in the card. */
export interface MarketplaceSuggestionEvent {
  /** A catalog plugin slug, or a `ConnectorId`. */
  appId: string;
}

export function marketplaceSuggestionItemType(event: MarketplaceSuggestionEvent): string {
  if (!isPluginSlug(event.appId)) throw new Error("A valid Marketplace app id is required.");
  return `${MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX}${event.appId}`;
}

export function marketplaceSuggestionEvent(message: ConversationMessage): MarketplaceSuggestionEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX)) return null;
  const appId = message.itemType.slice(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX.length);
  return isPluginSlug(appId) ? { appId } : null;
}
