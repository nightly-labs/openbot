/**
 * Plugin catalog served by the Account Worker.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand.
 */

export interface PluginCatalogIndex {
  schemaVersion: number;
  catalogVersion: string;
  plugins: Array<{ slug: string; version: string; featured: boolean; detailSha256: string }>;
}

export const PLUGIN_CATALOG_INDEX: PluginCatalogIndex = {
  schemaVersion: 1,
  catalogVersion: "v1",
  plugins: [
    {
      slug: "aave",
      version: "1.0.0",
      featured: true,
      detailSha256: "a48d147397385f04079d1fc94ecba212010e73196a84a74c01fe1e336fe8d188",
    },
    {
      slug: "canva",
      version: "1.0.0",
      featured: true,
      detailSha256: "b2fde1db15795e96eee4c7098518ff92c09958e8d474d2c247741ace3e06b3ce",
    },
    {
      slug: "github",
      version: "1.0.0",
      featured: true,
      detailSha256: "f33dc7018e8fcdbb9bc10051d051c06b2913d385f98e52ca01c039a337e419a0",
    },
    {
      slug: "linear",
      version: "1.0.0",
      featured: false,
      detailSha256: "c976586933c1d8d1c9cd456ca947d98534995f07f0c9f221b4374f08887a67e9",
    },
    {
      slug: "notion",
      version: "1.0.0",
      featured: true,
      detailSha256: "ea54dabd967a4a586763aecc86915ace7bafc3a232ca8aa5d6942ceb27e2fabc",
    },
    {
      slug: "figma",
      version: "1.0.0",
      featured: true,
      detailSha256: "e78bbbea897d0ab840fd613089634bd36e2fb710dca6ad739c0f964c6baf88fe",
    },
    {
      slug: "sentry",
      version: "1.0.0",
      featured: false,
      detailSha256: "412f984e42a88160c7b86a9b9d94e962f9f14b7e2d870807c7fc2b891dcc0a1d",
    },
    {
      slug: "context7",
      version: "1.0.0",
      featured: false,
      detailSha256: "33225f2fdbeac0dfcdf94dcf080948805daf500e2cc0f722f7e0eabc653edb2a",
    },
    {
      slug: "stripe",
      version: "1.0.0",
      featured: false,
      detailSha256: "8b53a691d487cbe70b46c8782903f6cfd77abf5d52dd01e0b666a41e6f593bbb",
    },
    {
      slug: "posthog",
      version: "1.0.0",
      featured: false,
      detailSha256: "b60b8e25c76aac5c02cb24d47bc2549c8e9e4e962a2ba54b2d7de0c3738f2279",
    },
    {
      slug: "airtable",
      version: "1.0.0",
      featured: false,
      detailSha256: "e6a379f48703481c51f9457d670c278c33b106db5337d18658c190eeae127913",
    },
    {
      slug: "firecrawl",
      version: "1.0.0",
      featured: false,
      detailSha256: "b287c44111eaf0d4e4fddfe90f766502485b6de917d9529af376b1d1cede7573",
    },
    {
      slug: "brave-search",
      version: "1.0.0",
      featured: false,
      detailSha256: "91612bd0105499cf7b30377dc9f9295ac199fa482599e2d4e21abeaa8ea61d29",
    },
    {
      slug: "resend",
      version: "1.0.0",
      featured: false,
      detailSha256: "8361ba20bd66a24032d777ddac44507d5f0fa44afae212869f25c0912ae949e4",
    },
  ],
};

export interface PluginCatalogPrompt {
  id: string;
  text: string;
}

export interface PluginCatalogApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: PluginCatalogServer;
}

export type PluginCatalogServer =
  | { name: string; transport: "http"; url: string; auth?: unknown }
  | { name: string; transport: "stdio"; command: string; args: string[]; auth?: unknown };

export interface PluginCatalogDetail {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  iconUrl: string | null;
  version: string;
  prompts: PluginCatalogPrompt[];
  apps: PluginCatalogApp[];
  skills: unknown[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}

export const PLUGIN_CATALOG_DETAILS: Record<string, PluginCatalogDetail> = {
  aave: {
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
  },
  canva: {
    slug: "canva",
    name: "Canva",
    tagline: "Designs, assets and exports",
    description:
      "Canva lets users create and edit designs in words, search their own design library, upload and organize assets, export in the format a channel needs, and leave comments where the work is. Each user signs in to their own Canva account, and the agent can do what that account can do.",
    category: "design",
    creatorName: "canva.com",
    iconUrl: "https://static.canva.com/static/images/favicon.ico",
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
        iconUrl: "https://static.canva.com/static/images/favicon.ico",
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
  },
  github: {
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
  },
  linear: {
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
  },
  notion: {
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
  },
  figma: {
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
  },
  sentry: {
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
        description:
          "Error search, issue inspection, and release health, over Sentry's MCP server with browser sign-in.",
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
  },
  context7: {
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
  },
  stripe: {
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
  },
  posthog: {
    slug: "posthog",
    name: "PostHog",
    tagline: "Product analytics and flags",
    description:
      "PostHog lets agents query events and funnels, inspect feature flags, and summarize what changed after a release. A personal API key from the project settings goes into one Authorization header.",
    category: "data-analytics",
    creatorName: "posthog.com",
    iconUrl: "https://posthog.com/favicon.ico",
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
        iconUrl: "https://posthog.com/favicon.ico",
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
  },
  airtable: {
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
  },
  firecrawl: {
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
  },
  "brave-search": {
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
  },
  resend: {
    slug: "resend",
    name: "Resend",
    tagline: "Transactional email",
    description:
      "Resend lets agents send transactional email and check delivery through one API. An API key from the Resend dashboard is passed to the local server as one environment variable.",
    category: "automation",
    creatorName: "resend.com",
    iconUrl: "https://resend.com/favicon.ico",
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
        iconUrl: "https://resend.com/favicon.ico",
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
                {
                  id: "token",
                  label: "API key",
                  env: "RESEND_API_KEY",
                  prefix: "",
                  hint: "Resend dashboard → API keys",
                },
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
  },
};
