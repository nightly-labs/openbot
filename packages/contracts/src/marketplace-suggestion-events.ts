import type { ConversationMessage } from "./ipc-conversation-messages";
import { isPluginSlug } from "./plugin-links";

export const MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX = "marketplace-suggestion:";

export const CONNECTOR_IDS = [
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "github",
  "onepassword",
  "bitwarden",
  "protonpass",
] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface MarketplaceSuggestionEvent {
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
