// The public marketplace catalog, read from the account service with plain GETs.
//
// The desktop app reads the same routes from its main process. The web client serves `/app` from the
// account service, so it reads them on its own origin. None of these routes needs an account.

import {
  decodeMarketplaceAgentDetail,
  decodeMarketplaceAgentPage,
  decodeMarketplaceSkillDetail,
  decodeMarketplaceSkillPage,
  type MarketplaceAgentDetail,
  type MarketplaceAgentPage,
  type MarketplaceAgentQuery,
  type MarketplaceSkillDetail,
  type MarketplaceSkillPage,
  type MarketplaceSkillQuery,
  marketplaceQueryParams,
} from "@openbot/contracts/ipc";

export interface MarketplaceCatalog {
  skills: {
    list: (query?: MarketplaceSkillQuery) => Promise<MarketplaceSkillPage>;
    get: (skillId: string) => Promise<MarketplaceSkillDetail>;
  };
  agents: {
    list: (query?: MarketplaceAgentQuery) => Promise<MarketplaceAgentPage>;
    get: (listingId: string) => Promise<MarketplaceAgentDetail>;
  };
}

export function createMarketplaceCatalog(request: typeof fetch): MarketplaceCatalog {
  async function read<T>(path: string, decode: (value: unknown) => T): Promise<T> {
    const response = await request(path, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("The marketplace could not be loaded. Try again.");
    return decode(await response.json());
  }
  return {
    skills: {
      list: (query = {}) => read(`/v1/skills/?${marketplaceQueryParams(query)}`, decodeMarketplaceSkillPage),
      get: (skillId) => read(`/v1/skills/${encodeURIComponent(skillId)}`, decodeMarketplaceSkillDetail),
    },
    agents: {
      list: (query = {}) =>
        read(`/v1/marketplace/agents/?${marketplaceQueryParams(query)}`, decodeMarketplaceAgentPage),
      get: (listingId) => read(`/v1/marketplace/agents/${encodeURIComponent(listingId)}`, decodeMarketplaceAgentDetail),
    },
  };
}
