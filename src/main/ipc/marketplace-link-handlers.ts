import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

interface MarketplaceLinkIpcDependencies {
  /** The agent or skill of a Marketplace link that arrived before a window could be told, taken once. */
  takePendingListing: () => MarketplaceListingLink | null;
}

/**
 * The Marketplace deep link, and nothing else, as `pluginIpcHandlers`.
 *
 * There is no add endpoint here on purpose. A link names a listing; adding the agent or skill is still
 * a press of Add on its page. An endpoint that added from a link would let a web page add an agent
 * that can act for the user.
 */
export function marketplaceLinkIpcHandlers({
  takePendingListing,
}: MarketplaceLinkIpcDependencies): Pick<IpcGroupHandlers, "marketplace"> {
  return {
    marketplace: {
      takePendingListing: handler(takePendingListing),
    },
  };
}
