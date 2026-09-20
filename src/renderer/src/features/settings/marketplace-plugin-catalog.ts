/**
 * The plugins the marketplace offers.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand: run bun run marketplace:build:plugins, or
 * bun run marketplace:build:plugins -- --check to verify.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { MarketplacePluginApp, MarketplacePluginDetail } from "./marketplace-plugins";

/**
 * The configuration an app installs as. The catalog states the name and how the server is reached -
 * an address, or a command and its words; the rest of the record and `enabled` are made here rather
 * than stored as catalog data that could disagree with `normalizeMcpConfig`.
 *
 * A credential is never among them. What a server asks for is declared in `server.auth`, and the
 * value is typed by the user in the connect dialog, which hands back the configuration that
 * connected.
 *
 * The id is empty, which is what the store reads as "new". An id it does not hold is an edit of a
 * row that is gone, and the save is refused.
 */
export function createPluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

const AAVE: MarketplacePluginDetail = {
  id: "plugin-aave",
  slug: "aave",
  name: "Aave",
  tagline: "Aave data and transactions",
  description:
    "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, simulate lending actions, and prepare non-custodial transactions. Every transaction is returned unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
  category: "data-analytics",
  creatorName: "avara.xyz",
  iconUrl: "https://aave.com/images/icon-aave.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-stablecoin-yield", text: "Where can I earn the most on stablecoins across Aave right now?" },
    { id: "prompt-usdc-rates", text: "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?" },
    {
      id: "prompt-health-factor",
      text: "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
    },
  ],
  apps: [
    {
      id: "app-aave-mcp",
      name: "Aave",
      description:
        "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
      iconUrl: "https://aave.com/images/icon-aave.png",
      server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
    },
  ],
  websiteUrl: "https://aave.com",
  privacyPolicyUrl: "https://aave.com/privacy",
  termsUrl: "https://aave.com/terms",
  skills: [],
  installs: 0,
  featured: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/aave",
};

const CANVA: MarketplacePluginDetail = {
  id: "plugin-canva",
  slug: "canva",
  name: "Canva",
  tagline: "Designs, assets and exports",
  description:
    "Canva lets users create and edit designs in words, search their own design library, upload and organize assets, export in the format a channel needs, and leave comments where the work is. Each user signs in to their own Canva account, and the agent can do what that account can do.",
  category: "design",
  creatorName: "canva.com",
  iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-recent-design", text: "Show me my most recently edited Canva design." },
    { id: "prompt-social-resize", text: "Resize my launch poster for Instagram and export both as PNG." },
    { id: "prompt-deck-from-notes", text: "Turn these release notes into a six-slide Canva presentation." },
  ],
  apps: [
    {
      id: "app-canva-mcp",
      name: "Canva",
      description:
        "Design creation and editing, library search, asset and brand management, exports, and comments, over one MCP server.",
      iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
      server: {
        name: "canva",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.canva.com/mcp"],
        auth: [{ id: "canva-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://www.canva.com",
  privacyPolicyUrl: "https://www.canva.com/policies/privacy-policy/",
  termsUrl: "https://www.canva.com/policies/terms-of-use/",
  skills: [],
  installs: 0,
  featured: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/canva",
};

const GITHUB: MarketplacePluginDetail = {
  id: "plugin-github",
  slug: "github",
  name: "GitHub",
  tagline: "Issues, pull requests and code",
  description:
    "GitHub lets agents review pull requests, open and triage issues, search code, and manage releases in the repositories a personal access token can reach. The token stays on this computer and travels as one Authorization header.",
  category: "coding",
  creatorName: "github.com",
  iconUrl: "https://github.com/fluidicon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-pr-review", text: "Review my open pull requests and flag the riskiest one." },
    { id: "prompt-issue-triage", text: "What issues were opened against my repos this week?" },
    { id: "prompt-release-notes", text: "Draft release notes from merged pull requests since the last tag." },
  ],
  apps: [
    {
      id: "app-github-mcp",
      name: "GitHub",
      description:
        "Issues, pull requests, code search, and releases, over GitHub's remote MCP server with a personal access token.",
      iconUrl: "https://github.com/fluidicon.png",
      server: {
        name: "github",
        transport: "http",
        url: "https://api.githubcopilot.com/mcp/",
        auth: [
          {
            id: "github-pat",
            kind: "key",
            label: "Personal access token",
            fields: [
              {
                id: "token",
                label: "Personal access token",
                header: "Authorization",
                prefix: "Bearer ",
                placeholder: "github_pat_…",
                hint: "GitHub Settings → Developer settings → Personal access tokens",
              },
            ],
            docsUrl: "https://github.com/settings/tokens",
            docsLabel: "Create a token",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://github.com",
  privacyPolicyUrl: "https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement",
  termsUrl: "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
  skills: [],
  installs: 0,
  featured: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/github",
};

const LINEAR: MarketplacePluginDetail = {
  id: "plugin-linear",
  slug: "linear",
  name: "Linear",
  tagline: "Issues and project triage",
  description:
    "Linear lets agents list assigned issues, triage the backlog, update statuses, and draft new issues in the workspace the signed-in account belongs to. Each user signs in to their own Linear account through the browser.",
  category: "coding",
  creatorName: "linear.app",
  iconUrl: "https://linear.app/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-my-week", text: "What is assigned to me this week?" },
    { id: "prompt-backlog", text: "Triage the backlog: what is stale, blocked, or missing an owner?" },
    { id: "prompt-new-issue", text: "File an issue for the crash in the sync queue with reproduction steps." },
  ],
  apps: [
    {
      id: "app-linear-mcp",
      name: "Linear",
      description:
        "Issue search, triage, status updates, and issue creation, over Linear's MCP server with browser sign-in.",
      iconUrl: "https://linear.app/favicon.ico",
      server: {
        name: "linear",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.linear.app/sse"],
        auth: [{ id: "linear-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://linear.app",
  privacyPolicyUrl: "https://linear.app/privacy",
  termsUrl: "https://linear.app/terms",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/linear",
};

const NOTION: MarketplacePluginDetail = {
  id: "plugin-notion",
  slug: "notion",
  name: "Notion",
  tagline: "Docs and knowledge base",
  description:
    "Notion lets agents read and write pages, search the workspace, and keep meeting notes and specs where the team already works. Each user signs in to their own Notion account through the browser.",
  category: "productivity",
  creatorName: "notion.so",
  iconUrl: "https://www.notion.so/images/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-find-spec", text: "Find the current launch spec and summarize the open questions." },
    { id: "prompt-meeting-notes", text: "Turn these bullets into a structured meeting note in my team space." },
    { id: "prompt-update-doc", text: "Update the onboarding doc with the new release checklist." },
  ],
  apps: [
    {
      id: "app-notion-mcp",
      name: "Notion",
      description:
        "Page search, reading, writing, and workspace navigation, over Notion's MCP server with browser sign-in.",
      iconUrl: "https://www.notion.so/images/favicon.ico",
      server: {
        name: "notion",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.notion.com/mcp"],
        auth: [{ id: "notion-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://www.notion.so",
  privacyPolicyUrl: "https://www.notion.so/privacy",
  termsUrl: "https://www.notion.so/terms",
  skills: [],
  installs: 0,
  featured: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/notion",
};

const FIGMA: MarketplacePluginDetail = {
  id: "plugin-figma",
  slug: "figma",
  name: "Figma",
  tagline: "Designs and prototypes",
  description:
    "Figma lets agents read design files, inspect components and styles, extract assets, and hand production specs to engineers. Each user signs in to their own Figma account through the browser.",
  category: "design",
  creatorName: "figma.com",
  iconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-handoff", text: "Hand off the checkout file: list screens, components, and styles." },
    { id: "prompt-audit", text: "Audit this file for inconsistent spacing and color use." },
    { id: "prompt-assets", text: "Extract the marketing icons at 2x for the app bundle." },
  ],
  apps: [
    {
      id: "app-figma-mcp",
      name: "Figma",
      description:
        "File reading, component inspection, and asset extraction, over Figma's MCP server with browser sign-in.",
      iconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
      server: {
        name: "figma",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.figma.com/mcp"],
        auth: [{ id: "figma-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://www.figma.com",
  privacyPolicyUrl: "https://www.figma.com/privacy/",
  termsUrl: "https://www.figma.com/tos/",
  skills: [],
  installs: 0,
  featured: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/figma",
};

const SENTRY: MarketplacePluginDetail = {
  id: "plugin-sentry",
  slug: "sentry",
  name: "Sentry",
  tagline: "Errors and crash triage",
  description:
    "Sentry lets agents search recent errors, inspect stack traces and affected releases, and summarize what broke after a deploy. Each user signs in to their own Sentry account through the browser.",
  category: "coding",
  creatorName: "sentry.io",
  iconUrl: "https://sentry.io/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-new-errors", text: "What new errors appeared since yesterday's deploy?" },
    { id: "prompt-top-crash", text: "Explain the top crash in the mobile project and its likely cause." },
    { id: "prompt-release-health", text: "How healthy is the current release compared to the last one?" },
  ],
  apps: [
    {
      id: "app-sentry-mcp",
      name: "Sentry",
      description: "Error search, issue inspection, and release health, over Sentry's MCP server with browser sign-in.",
      iconUrl: "https://sentry.io/favicon.ico",
      server: {
        name: "sentry",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.sentry.dev/mcp"],
        auth: [{ id: "sentry-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://sentry.io",
  privacyPolicyUrl: "https://sentry.io/privacy/",
  termsUrl: "https://sentry.io/terms/",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/sentry",
};

const CONTEXT7: MarketplacePluginDetail = {
  id: "plugin-context7",
  slug: "context7",
  name: "Context7",
  tagline: "Current library documentation",
  description:
    "Context7 fetches current documentation and API references for libraries and frameworks, so answers use the version the project actually runs. It needs no account and no key.",
  category: "research",
  creatorName: "context7.com",
  iconUrl: "https://context7.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-api-check", text: "What is the current API for virtualized lists in this framework?" },
    { id: "prompt-migrate", text: "What changed between v2 and v3 of this router?" },
    { id: "prompt-example", text: "Show a current example for authenticated file uploads." },
  ],
  apps: [
    {
      id: "app-context7-mcp",
      name: "Context7",
      description: "Current library documentation lookup, over the Context7 MCP server with no sign-in.",
      iconUrl: "https://context7.com/favicon.ico",
      server: { name: "context7", transport: "http", url: "https://mcp.context7.com/mcp" },
    },
  ],
  websiteUrl: "https://context7.com",
  privacyPolicyUrl: "https://context7.com/privacy",
  termsUrl: "https://context7.com/terms",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/context7",
};

const STRIPE: MarketplacePluginDetail = {
  id: "plugin-stripe",
  slug: "stripe",
  name: "Stripe",
  tagline: "Payments and billing review",
  description:
    "Stripe lets agents look up payments, customers, and invoices, and draft payment links, in the account the signed-in user can reach. Each user signs in to their own Stripe account through the browser.",
  category: "other",
  creatorName: "stripe.com",
  iconUrl: "https://stripe.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-payment", text: "Look up this payment and explain why it failed." },
    { id: "prompt-customer", text: "Summarize this customer's invoices and outstanding balance." },
    { id: "prompt-link", text: "Draft a payment link for the Pro plan at 49 per month." },
  ],
  apps: [
    {
      id: "app-stripe-mcp",
      name: "Stripe",
      description: "Payment, customer, and invoice lookup, over Stripe's MCP server with browser sign-in.",
      iconUrl: "https://stripe.com/favicon.ico",
      server: {
        name: "stripe",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.stripe.com"],
        auth: [{ id: "stripe-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  websiteUrl: "https://stripe.com",
  privacyPolicyUrl: "https://stripe.com/privacy",
  termsUrl: "https://stripe.com/ssa",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/stripe",
};

const POSTHOG: MarketplacePluginDetail = {
  id: "plugin-posthog",
  slug: "posthog",
  name: "PostHog",
  tagline: "Product analytics and flags",
  description:
    "PostHog lets agents query events and funnels, inspect feature flags, and summarize what changed after a release. A personal API key from the project settings goes into one Authorization header.",
  category: "data-analytics",
  creatorName: "posthog.com",
  iconUrl: "https://app.posthog.com/static/icons/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-funnel", text: "How does the signup funnel look for the last 14 days?" },
    { id: "prompt-flag", text: "Which feature flags are enabled for this user?" },
    { id: "prompt-release", text: "Did activation change after last week's release?" },
  ],
  apps: [
    {
      id: "app-posthog-mcp",
      name: "PostHog",
      description: "Event, funnel, and feature-flag access, over PostHog's MCP server with a personal API key.",
      iconUrl: "https://app.posthog.com/static/icons/apple-touch-icon.png",
      server: {
        name: "posthog",
        transport: "http",
        url: "https://mcp.posthog.com/mcp",
        auth: [
          {
            id: "posthog-key",
            kind: "key",
            label: "Personal API key",
            fields: [
              {
                id: "token",
                label: "Personal API key",
                header: "Authorization",
                prefix: "Bearer ",
                placeholder: "phx_…",
                hint: "PostHog Project settings → Personal API keys",
              },
            ],
            docsUrl: "https://posthog.com/docs/api",
            docsLabel: "Create a key",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://posthog.com",
  privacyPolicyUrl: "https://posthog.com/privacy",
  termsUrl: "https://posthog.com/terms",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/posthog",
};

const AIRTABLE: MarketplacePluginDetail = {
  id: "plugin-airtable",
  slug: "airtable",
  name: "Airtable",
  tagline: "Bases and records",
  description:
    "Airtable lets agents list bases, read and update records, and summarize table contents. An API key from the account page is passed to the local server as one environment variable.",
  category: "data-analytics",
  creatorName: "airtable.com",
  iconUrl: "https://airtable.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-bases", text: "What bases do I have access to?" },
    { id: "prompt-records", text: "Summarize the launch tracker table." },
    { id: "prompt-update", text: "Mark the shipped features as done in the roadmap base." },
  ],
  apps: [
    {
      id: "app-airtable-mcp",
      name: "Airtable",
      description: "Base listing and record access, over a local MCP server with an Airtable API key.",
      iconUrl: "https://airtable.com/favicon.ico",
      server: {
        name: "airtable",
        transport: "stdio",
        command: "npx",
        args: ["-y", "airtable-mcp-server"],
        auth: [
          {
            id: "airtable-key",
            kind: "key",
            label: "API key",
            fields: [{ id: "token", label: "API key", env: "AIRTABLE_API_KEY", hint: "Airtable account page → API" }],
            docsUrl: "https://airtable.com/developers/web/api/introduction",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://www.airtable.com",
  privacyPolicyUrl: "https://www.airtable.com/privacy",
  termsUrl: "https://www.airtable.com/tos",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/airtable",
};

const FIRECRAWL: MarketplacePluginDetail = {
  id: "plugin-firecrawl",
  slug: "firecrawl",
  name: "Firecrawl",
  tagline: "Web extraction and search",
  description:
    "Firecrawl lets agents scrape pages, extract structured data, and search the web through one API. An API key from the Firecrawl dashboard is passed to the local server as one environment variable.",
  category: "research",
  creatorName: "firecrawl.dev",
  iconUrl: "https://www.firecrawl.dev/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-scrape", text: "Extract the pricing table from this page as structured data." },
    { id: "prompt-research", text: "Research competitor pricing and cite each source page." },
    { id: "prompt-monitor", text: "What changed on our changelog page this month?" },
  ],
  apps: [
    {
      id: "app-firecrawl-mcp",
      name: "Firecrawl",
      description: "Page scraping, extraction, and web search, over a local MCP server with a Firecrawl API key.",
      iconUrl: "https://www.firecrawl.dev/favicon.ico",
      server: {
        name: "firecrawl",
        transport: "stdio",
        command: "npx",
        args: ["-y", "firecrawl-mcp"],
        auth: [
          {
            id: "firecrawl-key",
            kind: "key",
            label: "API key",
            fields: [
              {
                id: "token",
                label: "API key",
                env: "FIRECRAWL_API_KEY",
                prefix: "",
                hint: "Firecrawl dashboard → API keys",
              },
            ],
            docsUrl: "https://docs.firecrawl.dev",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://www.firecrawl.dev",
  privacyPolicyUrl: "https://www.firecrawl.dev/privacy",
  termsUrl: "https://www.firecrawl.dev/terms",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/firecrawl",
};

const BRAVE_SEARCH: MarketplacePluginDetail = {
  id: "plugin-brave-search",
  slug: "brave-search",
  name: "Brave Search",
  tagline: "Private web search",
  description:
    "Brave Search lets agents search the web and local results without tracking. An API key from the Brave Search API dashboard is passed to the local server as one environment variable.",
  category: "research",
  creatorName: "brave.com",
  iconUrl: "https://brave.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-search", text: "What are reviewers saying about this framework version?" },
    { id: "prompt-news", text: "Find today's announcements for this product area." },
    { id: "prompt-compare", text: "Compare these two vendors with cited sources." },
  ],
  apps: [
    {
      id: "app-brave-search-mcp",
      name: "Brave Search",
      description: "Web and local search, over a local MCP server with a Brave API key.",
      iconUrl: "https://brave.com/favicon.ico",
      server: {
        name: "brave-search",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@brave/brave-search-mcp-server"],
        auth: [
          {
            id: "brave-key",
            kind: "key",
            label: "API key",
            fields: [
              { id: "token", label: "API key", env: "BRAVE_API_KEY", hint: "Brave Search API dashboard → API keys" },
            ],
            docsUrl: "https://brave.com/search/api/",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://brave.com",
  privacyPolicyUrl: "https://brave.com/privacy/",
  termsUrl: "https://brave.com/terms-of-use/",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/brave-search",
};

const RESEND: MarketplacePluginDetail = {
  id: "plugin-resend",
  slug: "resend",
  name: "Resend",
  tagline: "Transactional email",
  description:
    "Resend lets agents send transactional email and check delivery through one API. An API key from the Resend dashboard is passed to the local server as one environment variable.",
  category: "automation",
  creatorName: "resend.com",
  iconUrl: "https://resend.com/static/favicons/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-send", text: "Send the launch announcement draft to the beta list." },
    { id: "prompt-status", text: "Did the invoice email reach the customer?" },
    { id: "prompt-template", text: "Draft a password-reset email for the new flow." },
  ],
  apps: [
    {
      id: "app-resend-mcp",
      name: "Resend",
      description: "Email sending and delivery checks, over a local MCP server with a Resend API key.",
      iconUrl: "https://resend.com/static/favicons/favicon.ico",
      server: {
        name: "resend",
        transport: "stdio",
        command: "npx",
        args: ["-y", "resend-mcp"],
        auth: [
          {
            id: "resend-key",
            kind: "key",
            label: "API key",
            fields: [
              { id: "token", label: "API key", env: "RESEND_API_KEY", prefix: "", hint: "Resend dashboard → API keys" },
            ],
            docsUrl: "https://resend.com/docs/dashboard/api-keys/introduction",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  websiteUrl: "https://resend.com",
  privacyPolicyUrl: "https://resend.com/legal/privacy-policy",
  termsUrl: "https://resend.com/legal/terms",
  skills: [],
  installs: 0,
  featured: false,
  updatedAt: "2026-09-19T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/resend",
};

export const MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [
  AAVE,
  CANVA,
  GITHUB,
  LINEAR,
  NOTION,
  FIGMA,
  SENTRY,
  CONTEXT7,
  STRIPE,
  POSTHOG,
  AIRTABLE,
  FIRECRAWL,
  BRAVE_SEARCH,
  RESEND,
];
