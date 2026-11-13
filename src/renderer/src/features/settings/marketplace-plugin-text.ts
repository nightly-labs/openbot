import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import { type AppTextKey, type AppTranslate, translateFor } from "@openbot/i18n";
import type {
  MarketplacePluginDetail,
  MarketplacePluginServer,
} from "@openbot/ui/features/settings/marketplace-plugins";

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
  cobrain: {
    tagline: "marketplace.plugin.cobrain.tagline",
    description: "marketplace.plugin.cobrain.description",
    apps: {
      "app-cobrain-mcp": "marketplace.plugin.cobrain.app",
    },
    prompts: {
      "prompt-start-session": "marketplace.plugin.cobrain.prompt.startSession",
      "prompt-search-decision": "marketplace.plugin.cobrain.prompt.searchDecision",
      "prompt-save-note": "marketplace.plugin.cobrain.prompt.saveNote",
    },
  },
  honcho: {
    tagline: "marketplace.plugin.honcho.tagline",
    description: "marketplace.plugin.honcho.description",
    apps: {
      "app-honcho-mcp": "marketplace.plugin.honcho.app",
    },
    prompts: {
      "prompt-recall": "marketplace.plugin.honcho.prompt.recall",
      "prompt-save": "marketplace.plugin.honcho.prompt.save",
      "prompt-preferences": "marketplace.plugin.honcho.prompt.preferences",
    },
  },
  hindsight: {
    tagline: "marketplace.plugin.hindsight.tagline",
    description: "marketplace.plugin.hindsight.description",
    apps: {
      "app-hindsight-mcp": "marketplace.plugin.hindsight.app",
    },
    prompts: {
      "prompt-recall": "marketplace.plugin.hindsight.prompt.recall",
      "prompt-retain": "marketplace.plugin.hindsight.prompt.retain",
      "prompt-reflect": "marketplace.plugin.hindsight.prompt.reflect",
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
  higgsfield: {
    tagline: "marketplace.plugin.higgsfield.tagline",
    description: "marketplace.plugin.higgsfield.description",
    apps: {
      "app-higgsfield-mcp": "marketplace.plugin.higgsfield.app",
    },
    prompts: {
      "prompt-credits": "marketplace.plugin.higgsfield.prompt.credits",
      "prompt-product-shot": "marketplace.plugin.higgsfield.prompt.productShot",
      "prompt-clip": "marketplace.plugin.higgsfield.prompt.clip",
    },
  },
  sunra: {
    tagline: "marketplace.plugin.sunra.tagline",
    description: "marketplace.plugin.sunra.description",
    apps: {
      "app-sunra-mcp": "marketplace.plugin.sunra.app",
    },
    prompts: {
      "prompt-balance": "marketplace.plugin.sunra.prompt.balance",
      "prompt-poster": "marketplace.plugin.sunra.prompt.poster",
      "prompt-clip": "marketplace.plugin.sunra.prompt.clip",
    },
  },
  elevenlabs: {
    tagline: "marketplace.plugin.elevenlabs.tagline",
    description: "marketplace.plugin.elevenlabs.description",
    apps: {
      "app-elevenlabs-mcp": "marketplace.plugin.elevenlabs.app",
    },
    prompts: {
      "prompt-speech": "marketplace.plugin.elevenlabs.prompt.speech",
      "prompt-agents": "marketplace.plugin.elevenlabs.prompt.agents",
      "prompt-conversations": "marketplace.plugin.elevenlabs.prompt.conversations",
    },
  },
  "apple-apps": {
    tagline: "marketplace.plugin.appleApps.tagline",
    description: "marketplace.plugin.appleApps.description",
    apps: {
      "app-apple-apps-mcp": "marketplace.plugin.appleApps.app",
    },
    prompts: {
      "prompt-unread": "marketplace.plugin.appleApps.prompt.unread",
      "prompt-today": "marketplace.plugin.appleApps.prompt.today",
      "prompt-schedule": "marketplace.plugin.appleApps.prompt.schedule",
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
  gitlab: {
    tagline: "marketplace.plugin.gitlab.tagline",
    description: "marketplace.plugin.gitlab.description",
    apps: {
      "app-gitlab-mcp": "marketplace.plugin.gitlab.app",
    },
    prompts: {
      "prompt-review-queue": "marketplace.plugin.gitlab.prompt.reviewQueue",
      "prompt-failed-pipeline": "marketplace.plugin.gitlab.prompt.failedPipeline",
      "prompt-new-issue": "marketplace.plugin.gitlab.prompt.newIssue",
    },
  },
  vercel: {
    tagline: "marketplace.plugin.vercel.tagline",
    description: "marketplace.plugin.vercel.description",
    apps: {
      "app-vercel-mcp": "marketplace.plugin.vercel.app",
    },
    prompts: {
      "prompt-failed-build": "marketplace.plugin.vercel.prompt.failedBuild",
      "prompt-recent-deployments": "marketplace.plugin.vercel.prompt.recentDeployments",
      "prompt-runtime-errors": "marketplace.plugin.vercel.prompt.runtimeErrors",
    },
  },
  cloudflare: {
    tagline: "marketplace.plugin.cloudflare.tagline",
    description: "marketplace.plugin.cloudflare.description",
    apps: {
      "app-cloudflare-mcp": "marketplace.plugin.cloudflare.app",
    },
    prompts: {
      "prompt-workers": "marketplace.plugin.cloudflare.prompt.workers",
      "prompt-errors": "marketplace.plugin.cloudflare.prompt.errors",
      "prompt-dns": "marketplace.plugin.cloudflare.prompt.dns",
    },
  },
  supabase: {
    tagline: "marketplace.plugin.supabase.tagline",
    description: "marketplace.plugin.supabase.description",
    apps: {
      "app-supabase-mcp": "marketplace.plugin.supabase.app",
    },
    prompts: {
      "prompt-projects": "marketplace.plugin.supabase.prompt.projects",
      "prompt-tables": "marketplace.plugin.supabase.prompt.tables",
      "prompt-errors": "marketplace.plugin.supabase.prompt.errors",
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
  revenuecat: {
    tagline: "marketplace.plugin.revenuecat.tagline",
    description: "marketplace.plugin.revenuecat.description",
    apps: {
      "app-revenuecat-mcp": "marketplace.plugin.revenuecat.app",
    },
    prompts: {
      "prompt-offerings": "marketplace.plugin.revenuecat.prompt.offerings",
      "prompt-revenue": "marketplace.plugin.revenuecat.prompt.revenue",
      "prompt-customer": "marketplace.plugin.revenuecat.prompt.customer",
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
  obsidian: {
    tagline: "marketplace.plugin.obsidian.tagline",
    description: "marketplace.plugin.obsidian.description",
    apps: {
      "app-obsidian-mcp": "marketplace.plugin.obsidian.app",
    },
    prompts: {
      "prompt-recall": "marketplace.plugin.obsidian.prompt.recall",
      "prompt-save": "marketplace.plugin.obsidian.prompt.save",
      "prompt-log": "marketplace.plugin.obsidian.prompt.log",
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
  omnisend: {
    tagline: "marketplace.plugin.omnisend.tagline",
    description: "marketplace.plugin.omnisend.description",
    apps: {
      "app-omnisend-mcp": "marketplace.plugin.omnisend.app",
    },
    prompts: {
      "prompt-last-campaign": "marketplace.plugin.omnisend.prompt.lastCampaign",
      "prompt-segment": "marketplace.plugin.omnisend.prompt.segment",
      "prompt-draft-campaign": "marketplace.plugin.omnisend.prompt.draftCampaign",
    },
  },
  postiz: {
    tagline: "marketplace.plugin.postiz.tagline",
    description: "marketplace.plugin.postiz.description",
    apps: {
      "app-postiz-mcp": "marketplace.plugin.postiz.app",
    },
    prompts: {
      "prompt-channels": "marketplace.plugin.postiz.prompt.channels",
      "prompt-week": "marketplace.plugin.postiz.prompt.week",
      "prompt-draft": "marketplace.plugin.postiz.prompt.draft",
    },
  },
  trypost: {
    tagline: "marketplace.plugin.trypost.tagline",
    description: "marketplace.plugin.trypost.description",
    apps: {
      "app-trypost-mcp": "marketplace.plugin.trypost.app",
    },
    prompts: {
      "prompt-week": "marketplace.plugin.trypost.prompt.week",
      "prompt-draft": "marketplace.plugin.trypost.prompt.draft",
      "prompt-analytics": "marketplace.plugin.trypost.prompt.analytics",
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
  neon: {
    tagline: "marketplace.plugin.neon.tagline",
    description: "marketplace.plugin.neon.description",
    apps: {
      "app-neon-mcp": "marketplace.plugin.neon.app",
    },
    prompts: {
      "prompt-projects": "marketplace.plugin.neon.prompt.projects",
      "prompt-slow-queries": "marketplace.plugin.neon.prompt.slowQueries",
      "prompt-migration": "marketplace.plugin.neon.prompt.migration",
    },
  },
  prisma: {
    tagline: "marketplace.plugin.prisma.tagline",
    description: "marketplace.plugin.prisma.description",
    apps: {
      "app-prisma-mcp": "marketplace.plugin.prisma.app",
    },
    prompts: {
      "prompt-databases": "marketplace.plugin.prisma.prompt.databases",
      "prompt-backups": "marketplace.plugin.prisma.prompt.backups",
      "prompt-logs": "marketplace.plugin.prisma.prompt.logs",
    },
  },
  netlify: {
    tagline: "marketplace.plugin.netlify.tagline",
    description: "marketplace.plugin.netlify.description",
    apps: {
      "app-netlify-mcp": "marketplace.plugin.netlify.app",
    },
    prompts: {
      "prompt-latest-deploy": "marketplace.plugin.netlify.prompt.latestDeploy",
      "prompt-errors": "marketplace.plugin.netlify.prompt.errors",
      "prompt-deploy": "marketplace.plugin.netlify.prompt.deploy",
    },
  },
  railway: {
    tagline: "marketplace.plugin.railway.tagline",
    description: "marketplace.plugin.railway.description",
    apps: {
      "app-railway-mcp": "marketplace.plugin.railway.app",
    },
    prompts: {
      "prompt-projects": "marketplace.plugin.railway.prompt.projects",
      "prompt-crash": "marketplace.plugin.railway.prompt.crash",
      "prompt-redeploy": "marketplace.plugin.railway.prompt.redeploy",
    },
  },
  render: {
    tagline: "marketplace.plugin.render.tagline",
    description: "marketplace.plugin.render.description",
    apps: {
      "app-render-mcp": "marketplace.plugin.render.app",
    },
    prompts: {
      "prompt-services": "marketplace.plugin.render.prompt.services",
      "prompt-logs": "marketplace.plugin.render.prompt.logs",
      "prompt-deploy": "marketplace.plugin.render.prompt.deploy",
    },
  },
  atlassian: {
    tagline: "marketplace.plugin.atlassian.tagline",
    description: "marketplace.plugin.atlassian.description",
    apps: {
      "app-atlassian-mcp": "marketplace.plugin.atlassian.app",
    },
    prompts: {
      "prompt-assigned": "marketplace.plugin.atlassian.prompt.assigned",
      "prompt-release-page": "marketplace.plugin.atlassian.prompt.releasePage",
      "prompt-new-item": "marketplace.plugin.atlassian.prompt.newItem",
    },
  },
  todoist: {
    tagline: "marketplace.plugin.todoist.tagline",
    description: "marketplace.plugin.todoist.description",
    apps: {
      "app-todoist-mcp": "marketplace.plugin.todoist.app",
    },
    prompts: {
      "prompt-today": "marketplace.plugin.todoist.prompt.today",
      "prompt-capture": "marketplace.plugin.todoist.prompt.capture",
      "prompt-overdue": "marketplace.plugin.todoist.prompt.overdue",
    },
  },
  ticktick: {
    tagline: "marketplace.plugin.ticktick.tagline",
    description: "marketplace.plugin.ticktick.description",
    apps: {
      "app-ticktick-mcp": "marketplace.plugin.ticktick.app",
    },
    prompts: {
      "prompt-today": "marketplace.plugin.ticktick.prompt.today",
      "prompt-capture": "marketplace.plugin.ticktick.prompt.capture",
      "prompt-week": "marketplace.plugin.ticktick.prompt.week",
    },
  },
  trello: {
    tagline: "marketplace.plugin.trello.tagline",
    description: "marketplace.plugin.trello.description",
    apps: {
      "app-trello-mcp": "marketplace.plugin.trello.app",
    },
    prompts: {
      "prompt-my-cards": "marketplace.plugin.trello.prompt.myCards",
      "prompt-board": "marketplace.plugin.trello.prompt.board",
      "prompt-new-cards": "marketplace.plugin.trello.prompt.newCards",
    },
  },
  clickup: {
    tagline: "marketplace.plugin.clickup.tagline",
    description: "marketplace.plugin.clickup.description",
    apps: {
      "app-clickup-mcp": "marketplace.plugin.clickup.app",
    },
    prompts: {
      "prompt-find-tasks": "marketplace.plugin.clickup.prompt.findTasks",
      "prompt-create-task": "marketplace.plugin.clickup.prompt.createTask",
      "prompt-summarize-doc": "marketplace.plugin.clickup.prompt.summarizeDoc",
    },
  },
  coinbase: {
    tagline: "marketplace.plugin.coinbase.tagline",
    description: "marketplace.plugin.coinbase.description",
    apps: {
      "app-coinbase-mcp": "marketplace.plugin.coinbase.app",
    },
    prompts: {
      "prompt-balances": "marketplace.plugin.coinbase.prompt.balances",
      "prompt-price": "marketplace.plugin.coinbase.prompt.price",
      "prompt-preview-order": "marketplace.plugin.coinbase.prompt.previewOrder",
    },
  },
  robinhood: {
    tagline: "marketplace.plugin.robinhood.tagline",
    description: "marketplace.plugin.robinhood.description",
    apps: {
      "app-robinhood-mcp": "marketplace.plugin.robinhood.app",
    },
    prompts: {
      "prompt-positions": "marketplace.plugin.robinhood.prompt.positions",
      "prompt-watchlist": "marketplace.plugin.robinhood.prompt.watchlist",
      "prompt-agentic-cash": "marketplace.plugin.robinhood.prompt.agenticCash",
    },
  },
  huggingface: {
    tagline: "marketplace.plugin.huggingface.tagline",
    description: "marketplace.plugin.huggingface.description",
    apps: {
      "app-huggingface-mcp": "marketplace.plugin.huggingface.app",
    },
    prompts: {
      "prompt-models": "marketplace.plugin.huggingface.prompt.models",
      "prompt-papers": "marketplace.plugin.huggingface.prompt.papers",
      "prompt-dataset": "marketplace.plugin.huggingface.prompt.dataset",
    },
  },
} as const satisfies Record<string, PluginTextKeys>;

/**
 * The keys of the connect form text, by its catalog English: the field labels and hints, and the
 * label of the page that gives a key. Text that is not here shows as the catalog has it.
 */
const AUTH_TEXT: Readonly<Record<string, AppTextKey>> = {
  "API key": "marketplace.auth.apiKey",
  "Personal API key": "marketplace.auth.personalApiKey",
  "Get a key": "mcp.connect.getKey",
  "Create a key": "marketplace.auth.createKey",
  "Find it in your Composio account, in Settings > Sessions & API Key.": "marketplace.plugin.composio.hint.apiKey",
  "In the RevenueCat dashboard, open API keys in your project and create a secret API key. A read-only key is enough to view data.":
    "marketplace.plugin.revenuecat.hint.apiKey",
  'In Obsidian, open Settings > Local REST API. Copy the API key and turn on "Enable non-encrypted (HTTP) server".':
    "marketplace.plugin.obsidian.hint.apiKey",
  "Create a key at app.honcho.dev.": "marketplace.plugin.honcho.hint.apiKey",
  "Create a key on the Connect page of Hindsight Cloud.": "marketplace.plugin.hindsight.hint.apiKey",
};

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

/** Connect form text in the reader's language, if the text is a catalog text that has a key. */
function authText(t: AppTranslate, text: string): string {
  return catalogText(t, Object.hasOwn(AUTH_TEXT, text) ? AUTH_TEXT[text] : undefined, text);
}

/** A way into a server, with its labels, hints and key page label in the reader's language. */
function localizedFlow(flow: McpConnectFlow, t: AppTranslate): McpConnectFlow {
  const label = authText(t, flow.label);
  if (flow.kind === "link") return { ...flow, label };
  const docs = flow.docsLabel === undefined ? {} : { docsLabel: authText(t, flow.docsLabel) };
  if (flow.kind === "local") return { ...flow, label, ...docs };
  return {
    ...flow,
    label,
    ...docs,
    fields: flow.fields.map((field) => ({
      ...field,
      label: authText(t, field.label),
      ...(field.hint === undefined ? {} : { hint: authText(t, field.hint) }),
    })),
  };
}

/** The server of an app, with its connect form text in the reader's language. */
function localizedServer(server: MarketplacePluginServer, t: AppTranslate): MarketplacePluginServer {
  return server.auth ? { ...server, auth: server.auth.map((flow) => localizedFlow(flow, t)) } : server;
}

/**
 * A catalog listing with its tagline, description, app descriptions, prompts and connect form text
 * in the reader's language.
 */
export function localizedPlugin(plugin: MarketplacePluginDetail, t: AppTranslate): MarketplacePluginDetail {
  const table: Readonly<Record<string, PluginTextKeys | undefined>> = PLUGIN_TEXT;
  const keys = Object.hasOwn(table, plugin.slug) ? table[plugin.slug] : undefined;
  return {
    ...plugin,
    tagline: catalogText(t, keys?.tagline, plugin.tagline),
    description: catalogText(t, keys?.description, plugin.description),
    apps: plugin.apps.map((app) => ({
      ...app,
      description: catalogText(t, keys && own(keys.apps, app.id), app.description),
      server: localizedServer(app.server, t),
    })),
    prompts: plugin.prompts.map((prompt) => ({
      ...prompt,
      text: catalogText(t, keys && own(keys.prompts, prompt.id), prompt.text),
    })),
  };
}
