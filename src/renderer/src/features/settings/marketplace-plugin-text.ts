import { type AppTextKey, type AppTranslate, translateFor } from "@openbot/i18n";
import type { MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";

/** The keys of one catalog listing's text. Apps and prompts go by their catalog id. */
interface PluginTextKeys {
  tagline: AppTextKey;
  description: AppTextKey;
  apps: Readonly<Record<string, AppTextKey>>;
  prompts: Readonly<Record<string, AppTextKey>>;
}

/**
 * The text keys of each catalog listing, by slug.
 *
 * `marketplace-plugin-catalog.ts` is generated from `marketplace/plugin-catalog/`, and its English
 * is also what the auth API sends, so the catalog keeps its English and the screen maps a slug to
 * keys here. A listing that is not here shows its catalog text.
 */
const PLUGIN_TEXT = {
  aave: {
    tagline: "marketplace.plugin.aave.tagline",
    description: "marketplace.plugin.aave.description",
    apps: {
      "app-aave-mcp": "marketplace.plugin.aave.app",
    },
    prompts: {
      "prompt-stablecoin-yield": "marketplace.plugin.aave.prompt.stablecoinYield",
      "prompt-usdc-rates": "marketplace.plugin.aave.prompt.usdcRates",
      "prompt-health-factor": "marketplace.plugin.aave.prompt.healthFactor",
    },
  },
  canva: {
    tagline: "marketplace.plugin.canva.tagline",
    description: "marketplace.plugin.canva.description",
    apps: {
      "app-canva-mcp": "marketplace.plugin.canva.app",
    },
    prompts: {
      "prompt-recent-design": "marketplace.plugin.canva.prompt.recentDesign",
      "prompt-social-resize": "marketplace.plugin.canva.prompt.socialResize",
      "prompt-deck-from-notes": "marketplace.plugin.canva.prompt.deckFromNotes",
    },
  },
  linear: {
    tagline: "marketplace.plugin.linear.tagline",
    description: "marketplace.plugin.linear.description",
    apps: {
      "app-linear-mcp": "marketplace.plugin.linear.app",
    },
    prompts: {
      "prompt-my-week": "marketplace.plugin.linear.prompt.myWeek",
      "prompt-backlog": "marketplace.plugin.linear.prompt.backlog",
      "prompt-new-issue": "marketplace.plugin.linear.prompt.newIssue",
    },
  },
  notion: {
    tagline: "marketplace.plugin.notion.tagline",
    description: "marketplace.plugin.notion.description",
    apps: {
      "app-notion-mcp": "marketplace.plugin.notion.app",
    },
    prompts: {
      "prompt-find-spec": "marketplace.plugin.notion.prompt.findSpec",
      "prompt-meeting-notes": "marketplace.plugin.notion.prompt.meetingNotes",
      "prompt-update-doc": "marketplace.plugin.notion.prompt.updateDoc",
    },
  },
  figma: {
    tagline: "marketplace.plugin.figma.tagline",
    description: "marketplace.plugin.figma.description",
    apps: {
      "app-figma-mcp": "marketplace.plugin.figma.app",
    },
    prompts: {
      "prompt-handoff": "marketplace.plugin.figma.prompt.handoff",
      "prompt-audit": "marketplace.plugin.figma.prompt.audit",
      "prompt-assets": "marketplace.plugin.figma.prompt.assets",
    },
  },
  paper: {
    tagline: "marketplace.plugin.paper.tagline",
    description: "marketplace.plugin.paper.description",
    apps: {
      "app-paper-mcp": "marketplace.plugin.paper.app",
    },
    prompts: {
      "prompt-implement": "marketplace.plugin.paper.prompt.implement",
      "prompt-code-to-design": "marketplace.plugin.paper.prompt.codeToDesign",
      "prompt-tokens": "marketplace.plugin.paper.prompt.tokens",
    },
  },
  sentry: {
    tagline: "marketplace.plugin.sentry.tagline",
    description: "marketplace.plugin.sentry.description",
    apps: {
      "app-sentry-mcp": "marketplace.plugin.sentry.app",
    },
    prompts: {
      "prompt-new-errors": "marketplace.plugin.sentry.prompt.newErrors",
      "prompt-top-crash": "marketplace.plugin.sentry.prompt.topCrash",
      "prompt-release-health": "marketplace.plugin.sentry.prompt.releaseHealth",
    },
  },
  context7: {
    tagline: "marketplace.plugin.context7.tagline",
    description: "marketplace.plugin.context7.description",
    apps: {
      "app-context7-mcp": "marketplace.plugin.context7.app",
    },
    prompts: {
      "prompt-api-check": "marketplace.plugin.context7.prompt.apiCheck",
      "prompt-migrate": "marketplace.plugin.context7.prompt.migrate",
      "prompt-example": "marketplace.plugin.context7.prompt.example",
    },
  },
  stripe: {
    tagline: "marketplace.plugin.stripe.tagline",
    description: "marketplace.plugin.stripe.description",
    apps: {
      "app-stripe-mcp": "marketplace.plugin.stripe.app",
    },
    prompts: {
      "prompt-payment": "marketplace.plugin.stripe.prompt.payment",
      "prompt-customer": "marketplace.plugin.stripe.prompt.customer",
      "prompt-link": "marketplace.plugin.stripe.prompt.link",
    },
  },
  posthog: {
    tagline: "marketplace.plugin.posthog.tagline",
    description: "marketplace.plugin.posthog.description",
    apps: {
      "app-posthog-mcp": "marketplace.plugin.posthog.app",
    },
    prompts: {
      "prompt-funnel": "marketplace.plugin.posthog.prompt.funnel",
      "prompt-flag": "marketplace.plugin.posthog.prompt.flag",
      "prompt-release": "marketplace.plugin.posthog.prompt.release",
    },
  },
  airtable: {
    tagline: "marketplace.plugin.airtable.tagline",
    description: "marketplace.plugin.airtable.description",
    apps: {
      "app-airtable-mcp": "marketplace.plugin.airtable.app",
    },
    prompts: {
      "prompt-bases": "marketplace.plugin.airtable.prompt.bases",
      "prompt-records": "marketplace.plugin.airtable.prompt.records",
      "prompt-update": "marketplace.plugin.airtable.prompt.update",
    },
  },
  firecrawl: {
    tagline: "marketplace.plugin.firecrawl.tagline",
    description: "marketplace.plugin.firecrawl.description",
    apps: {
      "app-firecrawl-mcp": "marketplace.plugin.firecrawl.app",
    },
    prompts: {
      "prompt-scrape": "marketplace.plugin.firecrawl.prompt.scrape",
      "prompt-research": "marketplace.plugin.firecrawl.prompt.research",
      "prompt-monitor": "marketplace.plugin.firecrawl.prompt.monitor",
    },
  },
  "brave-search": {
    tagline: "marketplace.plugin.braveSearch.tagline",
    description: "marketplace.plugin.braveSearch.description",
    apps: {
      "app-brave-search-mcp": "marketplace.plugin.braveSearch.app",
    },
    prompts: {
      "prompt-search": "marketplace.plugin.braveSearch.prompt.search",
      "prompt-news": "marketplace.plugin.braveSearch.prompt.news",
      "prompt-compare": "marketplace.plugin.braveSearch.prompt.compare",
    },
  },
  resend: {
    tagline: "marketplace.plugin.resend.tagline",
    description: "marketplace.plugin.resend.description",
    apps: {
      "app-resend-mcp": "marketplace.plugin.resend.app",
    },
    prompts: {
      "prompt-send": "marketplace.plugin.resend.prompt.send",
      "prompt-status": "marketplace.plugin.resend.prompt.status",
      "prompt-template": "marketplace.plugin.resend.prompt.template",
    },
  },
  composio: {
    tagline: "marketplace.plugin.composio.tagline",
    description: "marketplace.plugin.composio.description",
    apps: {
      "app-composio-mcp": "marketplace.plugin.composio.app",
    },
    prompts: {
      "prompt-inbox": "marketplace.plugin.composio.prompt.inbox",
      "prompt-handoff": "marketplace.plugin.composio.prompt.handoff",
      "prompt-apps": "marketplace.plugin.composio.prompt.apps",
    },
  },
} as const satisfies Record<string, PluginTextKeys>;

const english = translateFor("en");

/** The key at `id`, if the record has one of its own. */
function own(keys: Readonly<Record<string, AppTextKey>>, id: string): AppTextKey | undefined {
  return Object.hasOwn(keys, id) ? keys[id] : undefined;
}

/**
 * `text` in the reader's language. The catalog is the source: a key whose English is not `text`
 * was written for older catalog text, so the catalog text shows, as it does for a listing with no key.
 */
function catalogText(t: AppTranslate, key: AppTextKey | undefined, text: string): string {
  return key && english(key) === text ? t(key) : text;
}

/** A catalog listing with its tagline, description, app descriptions and prompts in the reader's language. */
export function localizedPlugin(plugin: MarketplacePluginDetail, t: AppTranslate): MarketplacePluginDetail {
  const table: Readonly<Record<string, PluginTextKeys | undefined>> = PLUGIN_TEXT;
  const keys = Object.hasOwn(table, plugin.slug) ? table[plugin.slug] : undefined;
  if (!keys) return plugin;
  return {
    ...plugin,
    tagline: catalogText(t, keys.tagline, plugin.tagline),
    description: catalogText(t, keys.description, plugin.description),
    apps: plugin.apps.map((app) => ({ ...app, description: catalogText(t, own(keys.apps, app.id), app.description) })),
    prompts: plugin.prompts.map((prompt) => ({
      ...prompt,
      text: catalogText(t, own(keys.prompts, prompt.id), prompt.text),
    })),
  };
}
