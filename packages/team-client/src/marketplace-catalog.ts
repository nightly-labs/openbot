// The public marketplace catalog and shared agent templates, read from the account service with plain GETs.
//
// The desktop app reads the same routes from its main process. The web client serves `/app` from the
// account service, so it reads them on its own origin. None of these routes needs an account.

import {
  type AgentTemplateDetail,
  decodeAgentTemplateDetail,
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
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";

class MarketplaceCatalogError extends Schema.TaggedError<MarketplaceCatalogError>()("MarketplaceCatalogError", {
  message: Schema.String,
}) {}

export interface MarketplaceCatalog {
  skills: {
    list: (query?: MarketplaceSkillQuery) => Effect.Effect<MarketplaceSkillPage, MarketplaceCatalogError>;
    get: (skillId: string) => Effect.Effect<MarketplaceSkillDetail, MarketplaceCatalogError>;
    /** The skill a shared link names, by its slug. */
    getBySlug: (slug: string) => Effect.Effect<MarketplaceSkillDetail, MarketplaceCatalogError>;
  };
  agents: {
    list: (query?: MarketplaceAgentQuery) => Effect.Effect<MarketplaceAgentPage, MarketplaceCatalogError>;
    get: (listingId: string) => Effect.Effect<MarketplaceAgentDetail, MarketplaceCatalogError>;
    /** The agent a shared link names: approved, or waiting for its first review with `pending`. */
    getListing: (agentId: string) => Effect.Effect<MarketplaceAgentDetail, MarketplaceCatalogError>;
  };
  /** A shared agent template, by the id its link names. */
  templates: { get: (templateId: string) => Effect.Effect<AgentTemplateDetail, MarketplaceCatalogError> };
}

export function createMarketplaceCatalog(request: typeof fetch): MarketplaceCatalog {
  const read = Effect.fn("MarketplaceCatalog.read")(function* <T>(
    path: string,
    decode: (value: unknown) => T,
    failure = sourceText("error.marketplace.catalogLoadFailed"),
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) => request(path, { headers: { accept: "application/json" }, signal }),
      catch: (error) => new MarketplaceCatalogError({ message: error instanceof Error ? error.message : failure }),
    });
    if (!response.ok) return yield* new MarketplaceCatalogError({ message: failure });
    const value = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) => new MarketplaceCatalogError({ message: error instanceof Error ? error.message : failure }),
    });
    return yield* Effect.try({
      try: () => decode(value),
      catch: (error) => new MarketplaceCatalogError({ message: error instanceof Error ? error.message : failure }),
    });
  });
  return {
    skills: {
      list: (query = {}) => read(`/v1/skills/?${marketplaceQueryParams(query)}`, decodeMarketplaceSkillPage),
      get: (skillId) => read(`/v1/skills/${encodeURIComponent(skillId)}`, decodeMarketplaceSkillDetail),
      getBySlug: (slug) => read(`/v1/skills/slug/${encodeURIComponent(slug)}`, decodeMarketplaceSkillDetail),
    },
    agents: {
      list: (query = {}) =>
        read(`/v1/marketplace/agents/?${marketplaceQueryParams(query)}`, decodeMarketplaceAgentPage),
      get: (listingId) => read(`/v1/marketplace/agents/${encodeURIComponent(listingId)}`, decodeMarketplaceAgentDetail),
      getListing: (agentId) =>
        read(`/v1/marketplace/agents/${encodeURIComponent(agentId)}/listing`, decodeMarketplaceAgentDetail),
    },
    templates: {
      get: (templateId) =>
        read(
          `/v1/agent-templates/${encodeURIComponent(templateId)}`,
          decodeAgentTemplateDetail,
          sourceText("error.marketplace.templateUnreadable"),
        ),
    },
  };
}
