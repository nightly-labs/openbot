import { defineMessages } from "../../message";

export const messages = defineMessages("marketplace", {
  // The listing: categories, rows, and the words for each kind of listing.
  "marketplace.category.coding": "Coding",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Data & Analytics",
  "marketplace.category.documents": "Documents",
  "marketplace.category.productivity": "Productivity",
  "marketplace.category.research": "Research",
  "marketplace.category.automation": "Automation",
  "marketplace.category.other": "Other",
  "marketplace.loadFailed": "Could not load the marketplace.",
  "marketplace.loading.skills": "Loading skills",
  "marketplace.loading.agents": "Loading agents",
  "marketplace.noMatch.skills": "No skills match this search.",
  "marketplace.noMatch.agents": "No agents match this search.",
  "marketplace.loadMore": "Load more",
  "marketplace.version": "Version {version}",

  // The dialog frame: title, close and tabs.
  "marketplace.title": "Marketplace",
  "marketplace.kinds": "Marketplace content types",
  "marketplace.tab.agents": "Agents",
  "marketplace.tab.skills": "Skills",
  "marketplace.description.apps": "Connect the tools and services that your agents work with.",
  "marketplace.description.agents": "Ready-made agents with their own instructions and skills.",
  "marketplace.description.skills": "Instructions that teach an agent a task or a tool.",

  // A plugin link.
  "marketplace.plugins.missing": "This plugin is not in the OpenBot catalog.",

  // The agent page.
  "marketplace.agents.loadingDetail": "Loading agent details…",
  "marketplace.agents.skills": "Skills",
  "marketplace.agents.routines": "Routines",
  "marketplace.agents.routineActive": "Active",
  "marketplace.agents.routineInactive": "Inactive",

  // The skill page, and why Try is off.
  "marketplace.skill.loading": "Loading skill",
  "marketplace.try.readFailed": "OpenBot could not read this agent's skills. Try again.",
  "marketplace.try.enable": "Enable this skill in agent settings to try it.",
  "marketplace.try.repair": "Repair this skill in agent settings to try it.",
  "marketplace.try.update": "Update this skill to try this version.",
  "marketplace.try.composerUnavailable": "The agent composer is unavailable.",

  // The Marketplace window. {name} is an agent, app or skill name. {count} is a number.
  "marketplace.open": "Open {name}",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Location",
  "marketplace.search.label": "Search the marketplace",
  "marketplace.search.placeholder": "Search",
  "marketplace.installs": { one: "{installs} install", other: "{installs} installs" },
  "marketplace.filter": "Filter",
  "marketplace.filter.on": "Filter: {filters}",
  "marketplace.filter.all": "All",
  "marketplace.filter.status": "Status",
  "marketplace.filter.category": "Category",
  "marketplace.filter.added": "Added",
  "marketplace.filter.notAdded": "Not added",
  "marketplace.filter.clear": "Clear filters",
  "marketplace.noMatch.apps": "No apps match this search.",
  "marketplace.noMatch.filters": "Nothing matches the filters.",
  "marketplace.noMatch.showAgents": { one: "Show {count} agent", other: "Show {count} agents" },
  "marketplace.noMatch.showApps": { one: "Show {count} app", other: "Show {count} apps" },
  "marketplace.noMatch.showSkills": { one: "Show {count} skill", other: "Show {count} skills" },
  "marketplace.empty.agents": "No agents are in the marketplace yet.",
  "marketplace.empty.apps": "No apps are in the marketplace yet.",
  "marketplace.empty.skills": "No skills are in the marketplace yet.",
  "marketplace.properties.agent": "About this agent",
  "marketplace.properties.creator": "Creator",
  "marketplace.properties.category": "Category",
  "marketplace.properties.version": "Version",
  "marketplace.properties.updated": "Updated",
  "marketplace.properties.installs": "Installs",

  // Agents.
  "marketplace.agent.add": "Add",
  "marketplace.agent.addNamed": "Add {name}",
  "marketplace.agent.addAgent": "Add agent",
  "marketplace.agent.added": "Added",
  "marketplace.agent.updateAvailable": "Update available",
  "marketplace.agent.update": "Update",
  "marketplace.agent.openChat": "Open chat",

  // Apps.
  "marketplace.app.connect": "Connect",
  "marketplace.app.reconnect": "Reconnect",
  "marketplace.app.connectNamed": "Connect {name}",
  "marketplace.app.reconnectNamed": "Reconnect {name}",
  "marketplace.app.connected": "Connected",
  "marketplace.app.attention": "Needs attention",
  // The plugin page alert when only some of its apps or skills are installed. {name} is the plugin name.
  "marketplace.app.partialTitle": "{name} is not complete",
  "marketplace.app.partialDescription": "Some of its apps or skills are not installed. Reconnect installs them.",
  "marketplace.app.notConnected": "Not connected",
  "marketplace.app.custom": "MCP server",
  "marketplace.app.githubTagline": "Repositories, issues and pull requests",
  "marketplace.app.onePasswordTagline": "Sign in to sites with logins you share",
  "marketplace.app.slackTagline": "Mentions and direct messages in Slack",
  "marketplace.app.discordTagline": "Mentions and direct messages in Discord",
  "marketplace.app.telegramTagline": "Groups and direct chats in Telegram",
  "marketplace.app.bitwardenTagline": "Sign in to sites with logins from a shared folder",
  // The category row in the information of a password manager page: 1Password and Bitwarden.
  "marketplace.app.onePasswordCategory": "Login and Credential Management",
  "marketplace.app.yourApps": "Your apps",
  "marketplace.app.addCustom": "Add custom",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Command",
  "marketplace.app.address": "Address",
  "marketplace.app.disconnect.title": "Disconnect {name}",
  "marketplace.app.disconnect.description":
    "Remove {name} and its skills from this computer. You can connect it again later.",
  "marketplace.app.disconnect.action": "Disconnect",
  "marketplace.app.remove.title": "Remove server",
  "marketplace.app.remove.description": "Your agents can no longer use this server. Its settings are deleted.",
  "marketplace.app.remove.action": "Remove",
  "marketplace.app.remove.confirmTitle": "Remove {name}?",
  "marketplace.app.remove.keep": "Keep",
  // The plugin page section with one row for each app, and the row text by how the app connects.
  // {name} is the app name, {field} the label of its key field, {host} "this computer" or a server name.
  "marketplace.app.connection": "Connection",
  "marketplace.app.setup.account": "Sign in with your {name} account in the browser.",
  "marketplace.app.setup.key": "Needs an API key from your {name} account.",
  "marketplace.app.setup.keySaved": "{field} saved on {host}.",
  "marketplace.app.setup.desktop": "Runs in the {name} desktop app at {address}.",
  "marketplace.app.setup.desktopConnected": "Connected to {address}.",
  "marketplace.app.setup.open": "No sign-in or key needed.",
  "marketplace.app.connectAgain": "Connect again",
  "marketplace.app.automation.askOnInstall": "Ask macOS for access at install",
  "marketplace.app.automation.title": "Access to Apple apps",
  "marketplace.app.automation.description":
    "macOS shows one prompt for each app. A closed app opens for a moment, then quits.",
  "marketplace.app.automation.request": "Ask for access",
  "marketplace.app.automation.allowed": "OpenBot can now control all of the Apple apps.",
  "marketplace.app.automation.refused":
    "macOS did not give access to {apps}. Allow OpenBot in System Settings › Privacy & Security › Automation.",
  "marketplace.app.automation.failed": "OpenBot could not ask macOS about {apps}. Try again.",
  "marketplace.app.automation.app.calendar": "Calendar",
  "marketplace.app.automation.app.contacts": "Contacts",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notes",
  "marketplace.app.automation.app.reminders": "Reminders",
  "marketplace.app.automation.app.messages": "Messages",
  "marketplace.app.automation.app.safari": "Safari",
  // The plugin page alert when the server refused an app's saved sign-in.
  "marketplace.app.signInTitle": "Sign in to {name} again",
  "marketplace.app.signInDescription":
    "{name} refused the saved sign-in. Your agents cannot use it until you sign in again.",

  // The catalog apps' listing text, by slug. Each English text is the catalog's own text, byte for
  // byte: a key whose English no longer matches the catalog is not used. The prompts are requests that
  // the user sends to an agent.
  "marketplace.plugin.aave.tagline": "Aave data and transactions",
  "marketplace.plugin.aave.description":
    "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, simulate lending actions, and prepare non-custodial transactions. Every transaction is returned unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
  "marketplace.plugin.aave.app":
    "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
  "marketplace.plugin.aave.prompt.stablecoinYield": "Where can I earn the most on stablecoins across Aave right now?",
  "marketplace.plugin.aave.prompt.usdcRates": "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
  "marketplace.plugin.canva.tagline": "Designs, assets and exports",
  "marketplace.plugin.canva.description":
    "Canva lets users create and edit designs in words, search their own design library, upload and organize assets, export in the format a channel needs, and leave comments where the work is. Each user signs in to their own Canva account, and the agent can do what that account can do.",
  "marketplace.plugin.canva.app":
    "Design creation and editing, library search, asset and brand management, exports, and comments, over one MCP server.",
  "marketplace.plugin.canva.prompt.recentDesign": "Show me my most recently edited Canva design.",
  "marketplace.plugin.canva.prompt.socialResize": "Resize my launch poster for Instagram and export both as PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes": "Turn these release notes into a six-slide Canva presentation.",
  "marketplace.plugin.linear.tagline": "Issues and project triage",
  "marketplace.plugin.linear.description":
    "Linear lets agents list assigned issues, triage the backlog, update statuses, and draft new issues in the workspace the signed-in account belongs to. Each user signs in to their own Linear account through the browser.",
  "marketplace.plugin.linear.app":
    "Issue search, triage, status updates, and issue creation, over Linear's MCP server with browser sign-in.",
  "marketplace.plugin.linear.prompt.myWeek": "What is assigned to me this week?",
  "marketplace.plugin.linear.prompt.backlog": "Triage the backlog: what is stale, blocked, or missing an owner?",
  "marketplace.plugin.linear.prompt.newIssue": "File an issue for the crash in the sync queue with reproduction steps.",
  "marketplace.plugin.notion.tagline": "Docs and knowledge base",
  "marketplace.plugin.notion.description":
    "Notion lets agents read and write pages, search the workspace, and keep meeting notes and specs where the team already works. Each user signs in to their own Notion account through the browser.",
  "marketplace.plugin.notion.app":
    "Page search, reading, writing, and workspace navigation, over Notion's MCP server with browser sign-in.",
  "marketplace.plugin.notion.prompt.findSpec": "Find the current launch spec and summarize the open questions.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Turn these bullets into a structured meeting note in my team space.",
  "marketplace.plugin.notion.prompt.updateDoc": "Update the onboarding doc with the new release checklist.",
  "marketplace.plugin.cobrain.tagline": "Shared memory for your AI agents",
  "marketplace.plugin.cobrain.description":
    "Cobrain is a Markdown memory that every AI you connect can read and write. Agents load the context of a client or project before working, search past notes and decisions, and save what they learn so the next thread starts where the last one ended. Each user signs in to their own Cobrain account.",
  "marketplace.plugin.cobrain.app": "Read, search and write notes in your Cobrain brain over one MCP server.",
  "marketplace.plugin.cobrain.prompt.startSession": "Load my Cobrain context for this project before we start.",
  "marketplace.plugin.cobrain.prompt.searchDecision": "Search my Cobrain notes for what we decided about pricing.",
  "marketplace.plugin.cobrain.prompt.saveNote": "Save a note in Cobrain with what we did today and what is left.",
  "marketplace.plugin.figma.tagline": "Designs and prototypes",
  "marketplace.plugin.figma.description":
    "Figma lets agents read design files, inspect components, styles and variables, and hand production specs to engineers. It connects to the MCP server in the Figma desktop app, on this computer. The server can read designs only; write support is in progress.",
  "marketplace.plugin.figma.app":
    "Design context, metadata, variables and screenshots, over the MCP server in the Figma desktop app. Read-only for now.",
  "marketplace.plugin.figma.prompt.handoff": "Hand off the checkout file: list screens, components, and styles.",
  "marketplace.plugin.figma.prompt.audit": "Audit this file for inconsistent spacing and color use.",
  "marketplace.plugin.figma.prompt.assets": "Extract the marketing icons at 2x for the app bundle.",
  "marketplace.plugin.paper.tagline": "Design canvas built on HTML and CSS",
  "marketplace.plugin.paper.description":
    "Paper lets agents read and write the design file that is open in Paper Desktop: inspect artboards, selections, computed styles, JSX and tokens, and create or change frames, text and styles. Install Paper Desktop, open it once, and open a file before you start. OpenBot starts the Paper CLI that Paper Desktop installs. Paper needs no key. Write tools change the open file, so review each write before you approve it.",
  "marketplace.plugin.paper.app":
    "Reads and writes the open Paper Desktop file, over the local MCP server that the Paper CLI relays. Needs Paper Desktop with a file open.",
  "marketplace.plugin.paper.prompt.implement":
    "Implement the selected Paper frame in this codebase, with our code conventions.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Use the styles in this repository and design a settings page in Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "List the design tokens in the open Paper file and compare them with our theme.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendar and more on your Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps lets agents use Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari on this Mac. It works on macOS only. OpenBot starts mcp-icloud, a community server that is not made by Apple or OpenBot. The server controls the apps through AppleScript, on this computer, and needs no account and no key. When you install it, OpenBot can ask macOS for access to all of these apps at once, with one prompt for each app. If you do not, macOS asks the first time an agent uses an app. To change this later, open System Settings › Privacy & Security › Automation. Agents can send email and iMessages, and change or delete events, contacts and reminders, so review each write before you approve it. What the tools read, such as email text, goes to the model provider of the agent.",
  "marketplace.plugin.appleApps.app":
    "Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari, over the local mcp-icloud server. Needs macOS and Automation access.",
  "marketplace.plugin.appleApps.prompt.unread": "Summarize my unread email in Apple Mail from today.",
  "marketplace.plugin.appleApps.prompt.today": "What is on my Apple Calendar today and tomorrow?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Find the latest email about the project meeting and add the meeting to my calendar.",
  "marketplace.plugin.sentry.tagline": "Errors and crash triage",
  "marketplace.plugin.sentry.description":
    "Sentry lets agents search recent errors, inspect stack traces and affected releases, and summarize what broke after a deploy. Each user signs in to their own Sentry account through the browser.",
  "marketplace.plugin.sentry.app":
    "Error search, issue inspection, and release health, over Sentry's MCP server with browser sign-in.",
  "marketplace.plugin.sentry.prompt.newErrors": "What new errors appeared since yesterday's deploy?",
  "marketplace.plugin.sentry.prompt.topCrash": "Explain the top crash in the mobile project and its likely cause.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "How healthy is the current release compared to the last one?",
  "marketplace.plugin.vercel.tagline": "Deployments, build logs and projects",
  "marketplace.plugin.vercel.description":
    "Vercel lets agents list projects and recent deployments, read build and runtime logs, and find why a build failed. Each user signs in to their own Vercel account through the browser and chooses the teams that agents can use. In those teams, agents get the same rights as the user's account. They can also change environment variables, domains, DNS records and deployments, and buy domains.",
  "marketplace.plugin.vercel.app":
    "Projects, deployments, build logs, and runtime logs, over Vercel's MCP server with browser sign-in.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Why did the last production deployment fail?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "List the deployments from today and their status.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Which routes had runtime errors in the last hour?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, storage and logs",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare lets agents list and manage Workers, DNS records, R2, D1 and KV through the Cloudflare API, query Workers logs, and search the Cloudflare docs. Each user signs in to their own Cloudflare account through the browser. On Cloudflare's consent page, choose Read only: the default, Minimal, does not let agents see Workers, logs or DNS records. With write permissions, agents can deploy and delete Workers, change DNS records and change other account settings.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, storage, and logs, over Cloudflare's API MCP server with browser sign-in.",
  "marketplace.plugin.cloudflare.prompt.workers": "Which Workers are deployed in my Cloudflare account?",
  "marketplace.plugin.cloudflare.prompt.errors": "Which Cloudflare Workers logged errors in the last hour?",
  "marketplace.plugin.cloudflare.prompt.dns": "List the DNS records of each zone in my Cloudflare account.",
  "marketplace.plugin.supabase.tagline": "Databases, logs and edge functions",
  "marketplace.plugin.supabase.description":
    "Supabase lets agents list projects, run SQL, read table schemas and logs, check security and performance advisors, manage edge functions and branches, and search the Supabase docs. Each user signs in to their own Supabase account through the browser and chooses an organization. Agents get full access: they can run SQL that changes or deletes data, apply migrations, deploy edge functions, and create or pause projects.",
  "marketplace.plugin.supabase.app":
    "Databases, logs, and edge functions, over Supabase's MCP server with browser sign-in.",
  "marketplace.plugin.supabase.prompt.projects": "Which projects are in my Supabase organization?",
  "marketplace.plugin.supabase.prompt.tables": "List the tables and columns of my Supabase database.",
  "marketplace.plugin.supabase.prompt.errors": "Which errors did my Supabase project log in the last hour?",
  "marketplace.plugin.context7.tagline": "Current library documentation",
  "marketplace.plugin.context7.description":
    "Context7 fetches current documentation and API references for libraries and frameworks, so answers use the version the project actually runs. It needs no account and no key.",
  "marketplace.plugin.context7.app":
    "Current library documentation lookup, over the Context7 MCP server with no sign-in.",
  "marketplace.plugin.context7.prompt.apiCheck": "What is the current API for virtualized lists in this framework?",
  "marketplace.plugin.context7.prompt.migrate": "What changed between v2 and v3 of this router?",
  "marketplace.plugin.context7.prompt.example": "Show a current example for authenticated file uploads.",
  "marketplace.plugin.stripe.tagline": "Payments and billing review",
  "marketplace.plugin.stripe.description":
    "Stripe lets agents look up payments, customers, and invoices, and draft payment links, in the account the signed-in user can reach. Each user signs in to their own Stripe account through the browser.",
  "marketplace.plugin.stripe.app":
    "Payment, customer, and invoice lookup, over Stripe's MCP server with browser sign-in.",
  "marketplace.plugin.stripe.prompt.payment": "Look up this payment and explain why it failed.",
  "marketplace.plugin.stripe.prompt.customer": "Summarize this customer's invoices and outstanding balance.",
  "marketplace.plugin.stripe.prompt.link": "Draft a payment link for the Pro plan at 49 per month.",
  "marketplace.plugin.posthog.tagline": "Product analytics and flags",
  "marketplace.plugin.posthog.description":
    "PostHog lets agents query events and funnels, inspect feature flags, and summarize what changed after a release. A personal API key from the project settings goes into one Authorization header.",
  "marketplace.plugin.posthog.app":
    "Event, funnel, and feature-flag access, over PostHog's MCP server with a personal API key.",
  "marketplace.plugin.posthog.prompt.funnel": "How does the signup funnel look for the last 14 days?",
  "marketplace.plugin.posthog.prompt.flag": "Which feature flags are enabled for this user?",
  "marketplace.plugin.posthog.prompt.release": "Did activation change after last week's release?",
  "marketplace.plugin.airtable.tagline": "Bases and records",
  "marketplace.plugin.airtable.description":
    "Airtable lets agents list bases, read and update records, and summarize table contents. An API key from the account page is passed to the local server as one environment variable.",
  "marketplace.plugin.airtable.app":
    "Base listing and record access, over a local MCP server with an Airtable API key.",
  "marketplace.plugin.airtable.prompt.bases": "What bases do I have access to?",
  "marketplace.plugin.airtable.prompt.records": "Summarize the launch tracker table.",
  "marketplace.plugin.airtable.prompt.update": "Mark the shipped features as done in the roadmap base.",
  "marketplace.plugin.firecrawl.tagline": "Web extraction and search",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl lets agents scrape pages, extract structured data, and search the web through one API. An API key from the Firecrawl dashboard is passed to the local server as one environment variable.",
  "marketplace.plugin.firecrawl.app":
    "Page scraping, extraction, and web search, over a local MCP server with a Firecrawl API key.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Extract the pricing table from this page as structured data.",
  "marketplace.plugin.firecrawl.prompt.research": "Research competitor pricing and cite each source page.",
  "marketplace.plugin.firecrawl.prompt.monitor": "What changed on our changelog page this month?",
  "marketplace.plugin.braveSearch.tagline": "Private web search",
  "marketplace.plugin.braveSearch.description":
    "Brave Search lets agents search the web and local results without tracking. An API key from the Brave Search API dashboard is passed to the local server as one environment variable.",
  "marketplace.plugin.braveSearch.app": "Web and local search, over a local MCP server with a Brave API key.",
  "marketplace.plugin.braveSearch.prompt.search": "What are reviewers saying about this framework version?",
  "marketplace.plugin.braveSearch.prompt.news": "Find today's announcements for this product area.",
  "marketplace.plugin.braveSearch.prompt.compare": "Compare these two vendors with cited sources.",
  "marketplace.plugin.obsidian.tagline": "Notes in your vault",
  "marketplace.plugin.obsidian.description":
    "Obsidian lets agents search, read and write the notes in your vault, so the vault can be their memory. The local server connects to the Local REST API plugin in the Obsidian app on this computer. The plugin's API key is passed to the local server as one environment variable. Keep Obsidian open while agents use it.",
  "marketplace.plugin.obsidian.app":
    "Note search, reading and editing, over a local MCP server with the Local REST API plugin key.",
  "marketplace.plugin.obsidian.prompt.recall": "What do my notes say about the decisions on this project?",
  "marketplace.plugin.obsidian.prompt.save": "Save this decision as a new note in my vault.",
  "marketplace.plugin.obsidian.prompt.log": "Add a summary of today's work to my Work log note.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'In Obsidian, open Settings > Local REST API. Copy the API key and turn on "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "Transactional email",
  "marketplace.plugin.resend.description":
    "Resend lets agents send transactional email and check delivery through one API. An API key from the Resend dashboard is passed to the local server as one environment variable.",
  "marketplace.plugin.resend.app": "Email sending and delivery checks, over a local MCP server with a Resend API key.",
  "marketplace.plugin.resend.prompt.send": "Send the launch announcement draft to the beta list.",
  "marketplace.plugin.resend.prompt.status": "Did the invoice email reach the customer?",
  "marketplace.plugin.resend.prompt.template": "Draft a password-reset email for the new flow.",
  "marketplace.plugin.composio.tagline": "Many apps through your own Composio link",
  "marketplace.plugin.composio.description":
    "Composio connects agents to Gmail, Slack, GitHub, and hundreds of other apps through one MCP server. Connect the apps you want in your Composio account, then paste its MCP URL and API key here.",
  "marketplace.plugin.composio.app":
    "The apps you add to your Composio MCP server, over the link from your Composio account.",
  "marketplace.plugin.composio.prompt.inbox": "Summarize my unread email and draft replies to the urgent ones.",
  "marketplace.plugin.composio.prompt.handoff": "Post a summary of this pull request to our team channel.",
  "marketplace.plugin.composio.prompt.apps": "Which apps and actions can you use through Composio?",
  // The connect form text of the catalog listings. Each English text is the catalog's own text, byte for byte.
  "marketplace.plugin.composio.hint.url": "The URL of an MCP server in your Composio account",
  "marketplace.plugin.composio.hint.apiKey": "Find it in your Composio account, in Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Postgres projects, branches and migrations",
  "marketplace.plugin.neon.description":
    "Neon lets agents list projects and branches, run SQL, read table schemas, test schema changes on a temporary branch, find slow queries, and search the Neon docs. Each user signs in to their own Neon account through the browser and can choose read-only access when they authorize. With full access, agents can run SQL that changes or deletes data, and create, reset or delete branches, databases and projects. Neon recommends its MCP server for development and testing, not for production databases.",
  "marketplace.plugin.neon.app":
    "Postgres projects, branches, SQL, and migrations, over Neon's MCP server with browser sign-in.",
  "marketplace.plugin.neon.prompt.projects": "Which projects and branches are in my Neon account?",
  "marketplace.plugin.neon.prompt.slowQueries": "Which queries are the slowest on my Neon database, and why?",
  "marketplace.plugin.neon.prompt.migration":
    "Add an index on the orders table in a temporary branch, and show me the result before you apply it.",
  "marketplace.plugin.prisma.tagline": "Postgres databases, backups and Compute apps",
  "marketplace.plugin.prisma.description":
    "Prisma lets agents list and create Prisma Postgres databases, read schemas, run SQL, list backups and restore them to a new database, manage Object Storage buckets, read Compute builds and logs, and search the Prisma docs. Each user signs in to their own Prisma account through the browser and selects a workspace. Agents get full access: they can run SQL that changes or deletes data, update schemas, delete databases and buckets, and stop, roll back or delete Compute deployments.",
  "marketplace.plugin.prisma.app":
    "Databases, SQL, backups, and Compute apps, over Prisma's MCP server with browser sign-in.",
  "marketplace.plugin.prisma.prompt.databases": "Which databases are in my Prisma workspace?",
  "marketplace.plugin.prisma.prompt.backups": "Show me all available backups of my database.",
  "marketplace.plugin.prisma.prompt.logs": "Show the runtime logs of my latest Compute deployment.",
  "marketplace.plugin.netlify.tagline": "Projects, deploys and request logs",
  "marketplace.plugin.netlify.description":
    "Netlify lets agents list projects and deploys, read edge request logs, create projects, and deploy code to an existing project. Each user signs in to their own Netlify account through the browser. Agents get the same access as the user's account: they can change environment variables, forms and visitor access, install or remove extensions, and delete form submissions and environment variables.",
  "marketplace.plugin.netlify.app":
    "Projects, deploys, request logs, and site settings, over Netlify's MCP server with browser sign-in.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "What is the status of the latest deploy of each of my Netlify projects?",
  "marketplace.plugin.netlify.prompt.errors": "Which URLs of my site returned server errors in the last day?",
  "marketplace.plugin.netlify.prompt.deploy": "Deploy this folder to my existing Netlify project.",
  "marketplace.plugin.railway.tagline": "Projects, services and deployments",
  "marketplace.plugin.railway.description":
    "Railway lets agents list projects and services, create projects, redeploy services, and manage feature flags. Agents can also give multi-step work to the Railway Agent, which reads logs, finds why a deploy failed, creates services and sets variables. Each user signs in to their own Railway account through the browser and chooses the workspaces and projects that agents can use. Agents get full access in those projects: they can deploy staged changes, delete feature flags, and change services, variables, databases and networking through the Railway Agent.",
  "marketplace.plugin.railway.app":
    "Projects, services, and deployments, over Railway's MCP server with browser sign-in.",
  "marketplace.plugin.railway.prompt.projects": "Which projects and services are in my Railway workspace?",
  "marketplace.plugin.railway.prompt.crash": "Why does my backend service on Railway crash on deploy?",
  "marketplace.plugin.railway.prompt.redeploy": "Redeploy the API service in my Railway project.",
  "marketplace.plugin.render.tagline": "Services, deploys and logs",
  "marketplace.plugin.render.description":
    "Render lets agents list workspaces and services, read logs, events and metrics, see the deploy history, trigger deploys, and run read-only SQL on Render Postgres. A Render API key goes into one Authorization header. The key reaches every workspace of the Render account. Agents can create web services, static sites, cron jobs, Postgres databases and Key Value instances, which can cost money, and they can replace the environment variables of a service. The server cannot delete a resource.",
  "marketplace.plugin.render.app": "Services, deploys, logs, and metrics, over Render's MCP server with an API key.",
  "marketplace.plugin.render.prompt.services": "Which services are in my Render workspace?",
  "marketplace.plugin.render.prompt.logs": "Which errors did my Render web service log in the last hour?",
  "marketplace.plugin.render.prompt.deploy": "Why did the last deploy of my Render service fail?",
  "marketplace.plugin.atlassian.tagline": "Jira work items and Confluence pages",
  "marketplace.plugin.atlassian.description":
    "Atlassian lets agents search and read Jira work items, Confluence pages and Bitbucket pull requests, and create or update work items, pages and comments. Each user signs in to their own Atlassian account through the browser and approves the access on a consent screen. Agents get the same permissions as the user: they can change work items and pages, change page permissions, and merge pull requests. Tools that delete Jira data stay off until an organization admin turns them on. Each tool call uses Rovo credits.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence, and Bitbucket, over Atlassian's MCP server with browser sign-in.",
  "marketplace.plugin.atlassian.prompt.assigned": "Which open Jira work items are assigned to me?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Find the Confluence page about our release process and summarize it.",
  "marketplace.plugin.atlassian.prompt.newItem": "Create a Jira work item for the login bug with steps to reproduce.",
  "marketplace.plugin.todoist.tagline": "Tasks, projects and reminders",
  "marketplace.plugin.todoist.description":
    "Todoist lets agents find tasks by date, text, label or filter, add and reschedule tasks, and manage projects, sections, labels, comments and reminders. Each user signs in to their own Todoist account through the browser. Agents get read and write access: they can change, complete and delete tasks, projects and other items.",
  "marketplace.plugin.todoist.app": "Tasks, projects, and reminders, over Todoist's MCP server with browser sign-in.",
  "marketplace.plugin.todoist.prompt.today": "Which Todoist tasks are due today?",
  "marketplace.plugin.todoist.prompt.capture": "Add these action items to my Todoist Inbox.",
  "marketplace.plugin.todoist.prompt.overdue": "Move my overdue Todoist tasks to tomorrow.",
  "marketplace.plugin.trello.tagline": "Boards, lists and cards",
  "marketplace.plugin.trello.description":
    "Trello lets agents search and read boards, lists, cards, checklists and comments, create boards and cards, move lists and cards, mark cards done, and add checklists, comments and labels. Agents can also read and add cards in the user's Trello Inbox, and read Planner events, which can come from a connected Google or Outlook calendar. Each user signs in to their own Trello account through the browser and chooses the workspaces on a consent screen. Agents get the same permissions as the user in those workspaces. They can archive cards and lists, but the server cannot delete anything permanently.",
  "marketplace.plugin.trello.app": "Boards, lists, and cards, over Trello's MCP server with browser sign-in.",
  "marketplace.plugin.trello.prompt.myCards": "Which Trello cards are assigned to me?",
  "marketplace.plugin.trello.prompt.board": "Summarize what is in progress on my Trello board.",
  "marketplace.plugin.trello.prompt.newCards": "Add these action items as cards to my Trello board.",
  "marketplace.plugin.huggingface.tagline": "Models, datasets and papers on the Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face lets agents search models, datasets, Spaces, collections and papers on the Hugging Face Hub, read model cards and repository files, preview datasets, and search the Hugging Face documentation. It uses public Hub data and needs no account and no key. The tools only read: agents cannot create repositories or run jobs.",
  "marketplace.plugin.huggingface.app":
    "Model, dataset, Space, paper, and docs search, over Hugging Face's MCP server with no sign-in.",
  "marketplace.plugin.huggingface.prompt.models": "Find small open models for speech recognition on Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Which papers are trending on Hugging Face today?",
  "marketplace.plugin.huggingface.prompt.dataset": "Find a dataset of weather time series and show its columns.",
  "marketplace.auth.apiKey": "API key",
  "marketplace.auth.personalApiKey": "Personal API key",
  "marketplace.auth.mcpUrl": "MCP URL",
  "marketplace.auth.createKey": "Create a key",

  // Skills.
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Try in {name}",

  // The Skills tab. {name} is a skill, a group or a sort name. {agents} is a list of agent names,
  // "all agents" or "4 agents". {agent} is one agent name. {state} is one or more states.
  "marketplace.skills.yours": "Your skills",
  "marketplace.skills.seeAll": "See all",
  "marketplace.skills.seeAllName": "See all: {name}",
  "marketplace.skills.none": "No agent has a skill yet.",
  "marketplace.skills.noneHint": "A skill teaches an agent one task. Add one below, or create your own.",
  "marketplace.skills.sourceLabel": "Source",
  "marketplace.skills.source.all": "All",
  "marketplace.skills.source.verified": "Verified",
  "marketplace.skills.source.public": "Public",
  "marketplace.skills.source.verifiedLong": "Verified by OpenBot",
  "marketplace.skills.source.publicLong": "Public: OpenBot did not check it",
  "marketplace.skills.sortLabel": "Sort",
  "marketplace.skills.sortName": "Sort: {name}",
  "marketplace.skills.sort.installs": "Most used",
  "marketplace.skills.sort.updated": "Recently updated",
  "marketplace.skills.sort.name": "Name",
  "marketplace.skills.featured": "Featured",
  "marketplace.skills.all": "All skills",
  "marketplace.skills.count": { one: "{count} skill", other: "{count} skills" },
  "marketplace.skills.searchIn": "Search {name}",
  "marketplace.skills.state.off": "Off",
  "marketplace.skills.state.repair": "Needs repair",
  "marketplace.skills.state.update": "Update available",
  "marketplace.skills.state.modified": "Changed by you",
  "marketplace.skills.stateOn": "{state} on {agents}",
  "marketplace.skills.version": "Version {version}",
  "marketplace.skills.origin.local": "Made on this computer",
  "marketplace.skills.origin.workspace": "In this agent's folder",
  "marketplace.skills.origin.marketplace": "From the Marketplace · version {version}",
  "marketplace.skills.status.notAdded": "Not added",
  "marketplace.skills.status.on": "On {agents}",
  "marketplace.skills.agentCount": { one: "{count} agent", other: "{count} agents" },
  "marketplace.skills.allAgents": "all agents",
  "marketplace.skills.agentsTitle": "Agents · {total}",
  "marketplace.skills.agents.search": "Search agents",
  "marketplace.skills.agents.searchName": "Search the agents with {name}",
  "marketplace.skills.agents.noMatch": "No agent matches “{query}”.",
  "marketplace.skills.agents.removeAll": "Remove all",
  "marketplace.skills.agents.removeAllName": {
    one: "Remove {name} from {count} agent",
    other: "Remove {name} from all {count} agents",
  },
  "marketplace.skills.agent.toggle": "{name} for {agent}",
  "marketplace.skills.agent.remove": "Remove",
  "marketplace.skills.agent.removeName": "Remove {name} from {agent}",
  "marketplace.skills.add": "Add",
  "marketplace.skills.addName": "Add {name} to agents",
  "marketplace.skills.addToAgents": "Add to agents",
  "marketplace.skills.onOf": "On {have} of {total}",
  "marketplace.skills.chooseAgents": "{name} is on {agents}. Choose agents",
  "marketplace.skills.dialog.list": "Agents with {name}",
  "marketplace.skills.dialog.search": { one: "Search {count} agent", other: "Search {count} agents" },
  "marketplace.skills.dialog.all": { one: "All {count} agent", other: "All {count} agents" },
  "marketplace.skills.dialog.allMatches": { one: "All {count} match", other: "All {count} matches" },
  "marketplace.skills.dialog.checked": "{checked} of {total}",
  "marketplace.skills.dialog.save": "Save",
  "marketplace.skills.dialog.saveBoth": "Save: add {added}, remove {removed}",
  "marketplace.skills.dialog.addTo": "Add to {agents}",
  "marketplace.skills.dialog.removeFrom": "Remove from {agents}",
  "marketplace.skills.dialog.full": "Skill limit reached",
  "marketplace.skills.dialog.unread": "Skills not read",
  "marketplace.skills.local.gone": "No agent has this skill now.",

  // Results that a screen reader hears. {agents} is a list of agent names.
  "marketplace.notice.agentAdded": "{name} added.",
  "marketplace.notice.agentUpdated": "{name} updated.",
  "marketplace.notice.appConnected": "{name} connected.",
  "marketplace.notice.appDisconnected": "{name} disconnected.",
  "marketplace.notice.serverRemoved": "{name} removed.",
  "marketplace.notice.skillInstalled": {
    one: "{name} installed on {count} agent.",
    other: "{name} installed on {count} agents.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} removed from {count} agent.",
    other: "{name} removed from {count} agents.",
  },
  "marketplace.error.skillPartial": "{name} did not change on these agents: {agents}. {reason}",

  // Errors. {reason} is an error message. {failures} is a list of error messages.
  "marketplace.error.openLink": "Could not open the link.",
  "marketplace.error.copyLink": "Could not copy the link.",
  "marketplace.error.connectNoServer": "Select a local server to connect this app.",
  "marketplace.error.installNoServer": "Select a local server to install a plugin.",
  "marketplace.error.installNoAgent": "Choose an agent to install this plugin's skills.",
  "marketplace.error.installLocalOnHost":
    "Install {name} on the computer that runs these agents: its app runs its server on that computer.",
  "marketplace.error.installOnHost":
    "Install {name} on the computer that runs these agents: its app needs a browser sign-in.",
  "marketplace.error.appInvalid": "{name} cannot be added: {reason}",
  "marketplace.error.uninstallNoServer": "Select a local server to uninstall a plugin.",
  "marketplace.error.uninstallPartial": "Some of {name} could not be removed. {failures}",
  "marketplace.error.actionFailed": "Could not complete the marketplace action. Try again.",
  "marketplace.thisAgent": "this agent",
});
