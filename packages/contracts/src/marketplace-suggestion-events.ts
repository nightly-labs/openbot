import type { ConversationMessage } from "./ipc-conversation-messages";
import { isPluginSlug } from "./plugin-links";

export const MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX = "marketplace-suggestion:";
/** The GitHub connection of the computer is a Marketplace app, but not a catalog plugin. Its id is a valid slug. */
export const GITHUB_MARKETPLACE_APP_ID = "github";

/** A Marketplace app an agent suggests in the conversation. The person decides in the card. */
export interface MarketplaceSuggestionEvent {
  /** A catalog plugin slug, or `github`. */
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
