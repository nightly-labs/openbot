import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

interface MarketplaceLinkIpcDependencies {
  takePendingListing: () => MarketplaceListingLink | null;
}

export function marketplaceLinkIpcHandlers({
  takePendingListing,
}: MarketplaceLinkIpcDependencies): Pick<IpcGroupHandlers, "marketplace"> {
  return {
    marketplace: {
      takePendingListing: handler(takePendingListing),
    },
  };
}
