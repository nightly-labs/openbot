/**
 * The plugins the mobile Marketplace offers.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand: run bun run marketplace:build:plugins, or
 * bun run marketplace:build:plugins -- --check to verify.
 */

import type { SkillCategory } from "@openbot/contracts/ipc";

/** One credential the user types. It goes into a `header` (http) or an `env` value (stdio). */
export interface MobilePluginAuthField {
  id: string;
  label: string;
  /** The value replaces the listing's address. It must stay on the listing's host or a subdomain. */
  url?: boolean;
  header?: string;
  env?: string;
  /** Written in front of the typed value, such as `"Bearer "`. */
  prefix?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

export type MobilePluginAuthFlow =
  | { id: string; kind: "link"; label: string }
  | {
      id: string;
      kind: "key";
      label: string;
      fields: MobilePluginAuthField[];
      docsUrl?: string | null;
      docsLabel?: string;
    }
  | {
      id: string;
      kind: "local";
      label: string;
      steps: string[];
      note?: string;
      docsUrl?: string | null;
      docsLabel?: string;
    };

type MobilePluginServer =
  | { name: string; transport: "http"; url: string; earlierUrls?: string[]; auth?: MobilePluginAuthFlow[] }
  | { name: string; transport: "stdio"; command: string; args: string[]; auth?: MobilePluginAuthFlow[] };

export interface MobilePluginApp {
  id: string;
  name: string;
  description: string;
  server: MobilePluginServer;
}

export interface MobilePlugin {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  version: string;
  prompts: Array<{ id: string; text: string }>;
  apps: MobilePluginApp[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  featured: boolean;
}

export const MOBILE_PLUGINS: readonly MobilePlugin[] = [
  {
    slug: "aave",
    name: "Aave",
    tagline: "Aave data and transactions",
    description:
      "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, simulate lending actions, and prepare non-custodial transactions. Every transaction is returned unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
    category: "data-analytics",
    creatorName: "Avara",
    version: "1.0.0",
    prompts: [
      { id: "prompt-stablecoin-yield", text: "Where can I earn the most on stablecoins across Aave right now?" },
      { id: "prompt-usdc-rates", text: "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?" },
      {
        id: "prompt-health-factor",
        text: "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
      },
    ],
    websiteUrl: "https://aave.com",
    privacyPolicyUrl: "https://aave.com/privacy",
    termsUrl: "https://aave.com/terms",
    featured: true,
    apps: [
      {
        id: "app-aave-mcp",
        name: "Aave",
        description:
          "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
        server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
      },
    ],
  },
  {
    slug: "canva",
    name: "Canva",
    tagline: "Designs, assets and exports",
    description:
      "Canva lets users create and edit designs in words, search their own design library, upload and organize assets, export in the format a channel needs, and leave comments where the work is. Each user signs in to their own Canva account, and the agent can do what that account can do.",
    category: "design",
    creatorName: "Canva",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recent-design", text: "Show me my most recently edited Canva design." },
      { id: "prompt-social-resize", text: "Resize my launch poster for Instagram and export both as PNG." },
      { id: "prompt-deck-from-notes", text: "Turn these release notes into a six-slide Canva presentation." },
    ],
    websiteUrl: "https://www.canva.com",
    privacyPolicyUrl: "https://www.canva.com/policies/privacy-policy/",
    termsUrl: "https://www.canva.com/policies/terms-of-use/",
    featured: true,
    apps: [
      {
        id: "app-canva-mcp",
        name: "Canva",
        description:
          "Design creation and editing, library search, asset and brand management, exports, and comments, over one MCP server.",
        server: {
          name: "canva",
          transport: "http",
          url: "https://mcp.canva.com/mcp",
          auth: [{ id: "canva-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "linear",
    name: "Linear",
    tagline: "Issues and project triage",
    description:
      "Linear lets agents list assigned issues, triage the backlog, update statuses, and draft new issues in the workspace the signed-in account belongs to. Each user signs in to their own Linear account through the browser.",
    category: "coding",
    creatorName: "Linear",
    version: "1.0.0",
    prompts: [
      { id: "prompt-my-week", text: "What is assigned to me this week?" },
      { id: "prompt-backlog", text: "Triage the backlog: what is stale, blocked, or missing an owner?" },
      { id: "prompt-new-issue", text: "File an issue for the crash in the sync queue with reproduction steps." },
    ],
    websiteUrl: "https://linear.app",
    privacyPolicyUrl: "https://linear.app/privacy",
    termsUrl: "https://linear.app/terms",
    featured: false,
    apps: [
      {
        id: "app-linear-mcp",
        name: "Linear",
        description:
          "Issue search, triage, status updates, and issue creation, over Linear's MCP server with browser sign-in.",
        server: {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/mcp",
          auth: [{ id: "linear-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "notion",
    name: "Notion",
    tagline: "Docs and knowledge base",
    description:
      "Notion lets agents read and write pages, search the workspace, and keep meeting notes and specs where the team already works. Each user signs in to their own Notion account through the browser.",
    category: "productivity",
    creatorName: "Notion",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-spec", text: "Find the current launch spec and summarize the open questions." },
      { id: "prompt-meeting-notes", text: "Turn these bullets into a structured meeting note in my team space." },
      { id: "prompt-update-doc", text: "Update the onboarding doc with the new release checklist." },
    ],
    websiteUrl: "https://www.notion.so",
    privacyPolicyUrl: "https://www.notion.so/privacy",
    termsUrl: "https://www.notion.so/terms",
    featured: true,
    apps: [
      {
        id: "app-notion-mcp",
        name: "Notion",
        description:
          "Page search, reading, writing, and workspace navigation, over Notion's MCP server with browser sign-in.",
        server: {
          name: "notion",
          transport: "http",
          url: "https://mcp.notion.com/mcp",
          auth: [{ id: "notion-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "obsidian",
    name: "Obsidian",
    tagline: "Notes in your vault",
    description:
      "Obsidian lets agents search, read and write the notes in your vault, so the vault can be their memory. The local server connects to the Local REST API plugin in the Obsidian app on this computer. The plugin's API key is passed to the local server as one environment variable. Keep Obsidian open while agents use it.",
    category: "productivity",
    creatorName: "Obsidian",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recall", text: "What do my notes say about the decisions on this project?" },
      { id: "prompt-save", text: "Save this decision as a new note in my vault." },
      { id: "prompt-log", text: "Add a summary of today's work to my Work log note." },
    ],
    websiteUrl: "https://obsidian.md",
    privacyPolicyUrl: "https://obsidian.md/privacy",
    termsUrl: "https://obsidian.md/terms",
    featured: false,
    apps: [
      {
        id: "app-obsidian-mcp",
        name: "Obsidian",
        description: "Note search, reading and editing, over a local MCP server with the Local REST API plugin key.",
        server: {
          name: "obsidian",
          transport: "stdio",
          command: "npx",
          args: ["-y", "obsidian-mcp-server@3.7.2"],
          auth: [
            {
              id: "obsidian-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "token",
                  label: "API key",
                  env: "OBSIDIAN_API_KEY",
                  hint: 'In Obsidian, open Settings > Local REST API. Copy the API key and turn on "Enable non-encrypted (HTTP) server".',
                },
              ],
              docsUrl: "https://github.com/coddingtonbear/obsidian-local-rest-api",
              docsLabel: "Get a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "atlassian",
    name: "Atlassian",
    tagline: "Jira work items and Confluence pages",
    description:
      "Atlassian lets agents search and read Jira work items, Confluence pages and Bitbucket pull requests, and create or update work items, pages and comments. Each user signs in to their own Atlassian account through the browser and approves the access on a consent screen. Agents get the same permissions as the user: they can change work items and pages, change page permissions, and merge pull requests. Tools that delete Jira data stay off until an organization admin turns them on. Each tool call uses Rovo credits.",
    category: "productivity",
    creatorName: "Atlassian",
    version: "1.0.0",
    prompts: [
      { id: "prompt-assigned", text: "Which open Jira work items are assigned to me?" },
      { id: "prompt-release-page", text: "Find the Confluence page about our release process and summarize it." },
      { id: "prompt-new-item", text: "Create a Jira work item for the login bug with steps to reproduce." },
    ],
    websiteUrl: "https://www.atlassian.com",
    privacyPolicyUrl: "https://www.atlassian.com/legal/privacy-policy",
    termsUrl: "https://www.atlassian.com/legal/atlassian-customer-agreement",
    featured: false,
    apps: [
      {
        id: "app-atlassian-mcp",
        name: "Atlassian",
        description: "Jira, Confluence, and Bitbucket, over Atlassian's MCP server with browser sign-in.",
        server: {
          name: "atlassian",
          transport: "http",
          url: "https://mcp.atlassian.com/v2/mcp",
          auth: [{ id: "atlassian-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "todoist",
    name: "Todoist",
    tagline: "Tasks, projects and reminders",
    description:
      "Todoist lets agents find tasks by date, text, label or filter, add and reschedule tasks, and manage projects, sections, labels, comments and reminders. Each user signs in to their own Todoist account through the browser. Agents get read and write access: they can change, complete and delete tasks, projects and other items.",
    category: "productivity",
    creatorName: "Doist",
    version: "1.0.0",
    prompts: [
      { id: "prompt-today", text: "Which Todoist tasks are due today?" },
      { id: "prompt-capture", text: "Add these action items to my Todoist Inbox." },
      { id: "prompt-overdue", text: "Move my overdue Todoist tasks to tomorrow." },
    ],
    websiteUrl: "https://www.todoist.com",
    privacyPolicyUrl: "https://www.todoist.com/privacy",
    termsUrl: "https://www.todoist.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-todoist-mcp",
        name: "Todoist",
        description: "Tasks, projects, and reminders, over Todoist's MCP server with browser sign-in.",
        server: {
          name: "todoist",
          transport: "http",
          url: "https://ai.todoist.net/mcp",
          auth: [{ id: "todoist-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ticktick",
    name: "TickTick",
    tagline: "Tasks, lists, habits and focus",
    description:
      "TickTick lets agents search and filter tasks, add and update tasks, and manage lists, sections, folders, tags and comments. Agents can also read and change habits and focus records, and read events from the calendars connected to TickTick. Each user signs in to their own TickTick account through the browser. Agents get read and write access: they can complete, move and delete tasks, and delete tags and focus records.",
    category: "productivity",
    creatorName: "TickTick",
    version: "1.0.0",
    prompts: [
      { id: "prompt-today", text: "Which TickTick tasks are due today?" },
      { id: "prompt-capture", text: "Add these action items to my TickTick Inbox." },
      { id: "prompt-week", text: "Which TickTick tasks did I complete last week?" },
    ],
    websiteUrl: "https://ticktick.com",
    privacyPolicyUrl: "https://ticktick.com/privacy",
    termsUrl: "https://ticktick.com/tos",
    featured: false,
    apps: [
      {
        id: "app-ticktick-mcp",
        name: "TickTick",
        description: "Tasks, lists, habits and focus records, over TickTick's MCP server with browser sign-in.",
        server: {
          name: "ticktick",
          transport: "http",
          url: "https://mcp.ticktick.com",
          auth: [{ id: "ticktick-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "trello",
    name: "Trello",
    tagline: "Boards, lists and cards",
    description:
      "Trello lets agents search and read boards, lists, cards, checklists and comments, create boards and cards, move lists and cards, mark cards done, and add checklists, comments and labels. Agents can also read and add cards in the user's Trello Inbox, and read Planner events, which can come from a connected Google or Outlook calendar. Each user signs in to their own Trello account through the browser and chooses the workspaces on a consent screen. Agents get the same permissions as the user in those workspaces. They can archive cards and lists, but the server cannot delete anything permanently.",
    category: "productivity",
    creatorName: "Atlassian",
    version: "1.0.0",
    prompts: [
      { id: "prompt-my-cards", text: "Which Trello cards are assigned to me?" },
      { id: "prompt-board", text: "Summarize what is in progress on my Trello board." },
      { id: "prompt-new-cards", text: "Add these action items as cards to my Trello board." },
    ],
    websiteUrl: "https://trello.com",
    privacyPolicyUrl: "https://www.atlassian.com/legal/privacy-policy",
    termsUrl: "https://www.atlassian.com/legal/atlassian-customer-agreement",
    featured: false,
    apps: [
      {
        id: "app-trello-mcp",
        name: "Trello",
        description: "Boards, lists, and cards, over Trello's MCP server with browser sign-in.",
        server: {
          name: "trello",
          transport: "http",
          url: "https://mcp.trello.com/v1",
          auth: [{ id: "trello-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "cobrain",
    name: "Cobrain",
    tagline: "Shared memory for your AI agents",
    description:
      "Cobrain is a Markdown memory that every AI you connect can read and write. Agents load the context of a client or project before working, search past notes and decisions, and save what they learn so the next thread starts where the last one ended. Each user signs in to their own Cobrain account.",
    category: "productivity",
    creatorName: "Cobrain",
    version: "1.0.0",
    prompts: [
      { id: "prompt-start-session", text: "Load my Cobrain context for this project before we start." },
      { id: "prompt-search-decision", text: "Search my Cobrain notes for what we decided about pricing." },
      { id: "prompt-save-note", text: "Save a note in Cobrain with what we did today and what is left." },
    ],
    websiteUrl: "https://cobrain.space",
    privacyPolicyUrl: "https://cobrain.space/privacy",
    termsUrl: "https://cobrain.space/terms",
    featured: false,
    apps: [
      {
        id: "app-cobrain-mcp",
        name: "Cobrain",
        description: "Read, search and write notes in your Cobrain brain over one MCP server.",
        server: {
          name: "cobrain",
          transport: "http",
          url: "https://cobrain.space/mcp",
          auth: [{ id: "cobrain-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "honcho",
    name: "Honcho",
    tagline: "Your memory across AI tools",
    description:
      "Honcho by Plastic Labs gives agents a long-term memory of you that other AI tools you connect can share. Agents save what they learn, and Honcho reasons over it to build a model of your preferences, goals and ways of working. Agents ask it questions before they start. OpenBot agents keep their own memory too; Honcho is the memory that follows you to other tools. Messages that agents save go to your Honcho account.",
    category: "productivity",
    creatorName: "Plastic Labs",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recall", text: "Ask Honcho what it knows about how I like to work before we start." },
      { id: "prompt-save", text: "Save the decisions from this thread to Honcho." },
      { id: "prompt-preferences", text: "What does Honcho say about my writing style? Use it for this draft." },
    ],
    websiteUrl: "https://honcho.dev",
    privacyPolicyUrl: "https://app.honcho.dev/privacy",
    termsUrl: "https://app.honcho.dev/tos",
    featured: false,
    apps: [
      {
        id: "app-honcho-mcp",
        name: "Honcho",
        description: "Save and query long-term memory in your Honcho workspaces over one MCP server.",
        server: {
          name: "honcho",
          transport: "http",
          url: "https://mcp.honcho.dev",
          auth: [
            { id: "honcho-oauth", kind: "link", label: "Sign in" },
            {
              id: "honcho-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "api-key",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  placeholder: "hch-…",
                  hint: "Create a key at app.honcho.dev.",
                },
              ],
              docsUrl: "https://honcho.dev/docs/v3/guides/integrations/mcp",
              docsLabel: "Get a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "hindsight",
    name: "Hindsight",
    tagline: "Memory that learns over time",
    description:
      "Hindsight by Vectorize gives agents a long-term memory in Hindsight Cloud. Agents retain facts and events, recall them by meaning, time and entity, and reflect on them to form mental models. Memories are kept in banks, and agents can make a bank for each project or person. OpenBot agents keep their own memory too; Hindsight is the memory that other AI tools you connect can share. What agents retain goes to your Hindsight Cloud account.",
    category: "productivity",
    creatorName: "Vectorize",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recall", text: "Recall from Hindsight what we know about this project before we start." },
      { id: "prompt-retain", text: "Retain the decisions and open questions from this thread in Hindsight." },
      {
        id: "prompt-reflect",
        text: "Reflect on my Hindsight memories: what patterns do you see in my last month of work?",
      },
    ],
    websiteUrl: "https://hindsight.vectorize.io",
    privacyPolicyUrl: "https://vectorize.io/privacy",
    termsUrl: "https://vectorize.io/terms",
    featured: false,
    apps: [
      {
        id: "app-hindsight-mcp",
        name: "Hindsight",
        description: "Retain, recall and reflect on memories in your Hindsight Cloud banks over one MCP server.",
        server: {
          name: "hindsight",
          transport: "http",
          url: "https://api.hindsight.vectorize.io/mcp",
          auth: [
            { id: "hindsight-oauth", kind: "link", label: "Sign in" },
            {
              id: "hindsight-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "api-key",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  placeholder: "hsk_…",
                  hint: "Create a key on the Connect page of Hindsight Cloud.",
                },
              ],
              docsUrl: "https://ui.hindsight.vectorize.io/connect",
              docsLabel: "Get a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "figma",
    name: "Figma",
    tagline: "Designs and prototypes",
    description:
      "Figma lets agents read design files, inspect components, styles and variables, and hand production specs to engineers. It connects to the MCP server in the Figma desktop app, on this computer. The server can read designs only; write support is in progress.",
    category: "design",
    creatorName: "Figma",
    version: "1.1.0",
    prompts: [
      { id: "prompt-handoff", text: "Hand off the checkout file: list screens, components, and styles." },
      { id: "prompt-audit", text: "Audit this file for inconsistent spacing and color use." },
      { id: "prompt-assets", text: "Extract the marketing icons at 2x for the app bundle." },
    ],
    websiteUrl: "https://www.figma.com",
    privacyPolicyUrl: "https://www.figma.com/privacy/",
    termsUrl: "https://www.figma.com/tos/",
    featured: true,
    apps: [
      {
        id: "app-figma-mcp",
        name: "Figma",
        description:
          "Design context, metadata, variables and screenshots, over the MCP server in the Figma desktop app. Read-only for now.",
        server: {
          name: "figma-desktop",
          transport: "http",
          url: "http://127.0.0.1:3845/mcp",
          auth: [
            {
              id: "figma-desktop",
              label: "Figma desktop app",
              kind: "local",
              steps: [
                "Open the Figma desktop app and sign in. The server needs a Dev or Full seat on a paid plan.",
                "Open a design file from a team project, not from Drafts.",
                'Press ⌘K (Ctrl+K on Windows), search for "MCP", and turn on "Enable desktop MCP server".',
                "Keep Figma open while agents use it.",
              ],
              note: "The local server can only read designs: layout, code context, variables and screenshots. It cannot draw or edit yet. We are working on write support.",
              docsUrl: "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "paper",
    name: "Paper",
    tagline: "Design canvas built on HTML and CSS",
    description:
      "Paper lets agents read and write the design file that is open in Paper Desktop: inspect artboards, selections, computed styles, JSX and tokens, and create or change frames, text and styles. Install Paper Desktop, open it once, and open a file before you start. OpenBot starts the Paper CLI that Paper Desktop installs. Paper needs no key. Write tools change the open file, so review each write before you approve it.",
    category: "design",
    creatorName: "Paper",
    version: "1.0.1",
    prompts: [
      {
        id: "prompt-implement",
        text: "Implement the selected Paper frame in this codebase, with our code conventions.",
      },
      { id: "prompt-code-to-design", text: "Use the styles in this repository and design a settings page in Paper." },
      { id: "prompt-tokens", text: "List the design tokens in the open Paper file and compare them with our theme." },
    ],
    websiteUrl: "https://paper.design",
    privacyPolicyUrl: "https://paper.design/legal/privacy",
    termsUrl: "https://paper.design/legal/tos",
    featured: false,
    apps: [
      {
        id: "app-paper-mcp",
        name: "Paper",
        description:
          "Reads and writes the open Paper Desktop file, over the local MCP server that the Paper CLI relays. Needs Paper Desktop with a file open.",
        server: { name: "paper", transport: "stdio", command: "~/.paper/bin/paper", args: ["mcp"] },
      },
    ],
  },
  {
    slug: "higgsfield",
    name: "Higgsfield",
    tagline: "AI images, videos and audio",
    description:
      "Higgsfield lets agents generate images, videos, characters and audio with Higgsfield models such as Seedance, Kling, Veo and MiniMax Hailuo, check the credit balance, and browse the Asset Library. Results are saved to the user's Higgsfield Assets. Each user signs in to their own Higgsfield account through the browser. Every generation uses credits of that account at standard rates, also on an unlimited plan.",
    category: "design",
    creatorName: "Higgsfield",
    version: "1.0.0",
    prompts: [
      { id: "prompt-credits", text: "How many Higgsfield credits do I have?" },
      { id: "prompt-product-shot", text: "Make a Higgsfield product photo of a ceramic mug on a wooden table." },
      { id: "prompt-clip", text: "Make a 5-second Higgsfield video of waves at sunset." },
    ],
    websiteUrl: "https://higgsfield.ai",
    privacyPolicyUrl: "https://higgsfield.ai/privacy-policy",
    termsUrl: "https://higgsfield.ai/terms-of-use-agreement",
    featured: false,
    apps: [
      {
        id: "app-higgsfield-mcp",
        name: "Higgsfield",
        description:
          "Image, video and audio generation, characters, credits and assets, over Higgsfield's MCP server with browser sign-in.",
        server: {
          name: "higgsfield",
          transport: "http",
          url: "https://mcp.higgsfield.ai/mcp",
          auth: [{ id: "higgsfield-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "sunra",
    name: "Sunra",
    tagline: "AI images, videos, audio and 3D",
    description:
      "Sunra lets agents make images, videos, audio and 3D models with models such as GPT Image, Nano Banana, Seedream, FLUX, Seedance, Kling and Veo, check the credit balance, and read the results. Results go to a project in the user's Sunra account. Each user signs in to their own Sunra account through the browser. Sunra first quotes the cost of each generation, and spends credits of that account only after it is confirmed.",
    category: "design",
    creatorName: "Sunra",
    version: "1.0.0",
    prompts: [
      { id: "prompt-balance", text: "How many Sunra credits do I have?" },
      { id: "prompt-poster", text: "Make a Sunra poster of a night market in the rain, in portrait format." },
      { id: "prompt-clip", text: "Make a 5-second Sunra video of a paper boat on a river. Tell me the cost first." },
    ],
    websiteUrl: "https://sunra.ai",
    privacyPolicyUrl: "https://sunra.ai/privacy",
    termsUrl: "https://sunra.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-sunra-mcp",
        name: "Sunra",
        description:
          "Image, video, audio and 3D generation, credits and results, over Sunra's MCP server with browser sign-in.",
        server: {
          name: "sunra",
          transport: "http",
          url: "https://mcp.sunra.ai",
          auth: [{ id: "sunra-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "elevenlabs",
    name: "ElevenLabs",
    tagline: "Speech, voices and voice agents",
    description:
      "ElevenLabs lets agents turn text into speech, work with voices, and create, test and review ElevenLabs voice agents and their conversations. Generated audio comes back as a short-lived download link. Each user signs in to their own ElevenLabs account through the browser, and each generation uses credits of that account.",
    category: "design",
    creatorName: "ElevenLabs",
    version: "1.0.0",
    prompts: [
      { id: "prompt-speech", text: "Read this paragraph aloud with a calm ElevenLabs voice and give me the audio." },
      { id: "prompt-agents", text: "List my ElevenLabs voice agents and the voice each one uses." },
      { id: "prompt-conversations", text: "Summarize the last ten conversations of my support voice agent." },
    ],
    websiteUrl: "https://elevenlabs.io",
    privacyPolicyUrl: "https://elevenlabs.io/privacy-policy",
    termsUrl: "https://elevenlabs.io/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-elevenlabs-mcp",
        name: "ElevenLabs",
        description:
          "Text to speech, voices, and voice agent management, over ElevenLabs' MCP server with browser sign-in.",
        server: {
          name: "elevenlabs",
          transport: "http",
          url: "https://api.elevenlabs.io/v1/mcp",
          auth: [{ id: "elevenlabs-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "apple-apps",
    name: "Apple apps",
    tagline: "Mail, Calendar and more on your Mac",
    description:
      "Apple apps lets agents use Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari on this Mac. It works on macOS only. OpenBot starts mcp-icloud, a community server that is not made by Apple or OpenBot. The server controls the apps through AppleScript, on this computer, and needs no account and no key. When you install it, OpenBot can ask macOS for access to all of these apps at once, with one prompt for each app. If you do not, macOS asks the first time an agent uses an app. To change this later, open System Settings › Privacy & Security › Automation. Agents can send email and iMessages, and change or delete events, contacts and reminders, so review each write before you approve it. What the tools read, such as email text, goes to the model provider of the agent.",
    category: "productivity",
    creatorName: "MrGo2",
    version: "1.1.1",
    prompts: [
      { id: "prompt-unread", text: "Summarize my unread email in Apple Mail from today." },
      { id: "prompt-today", text: "What is on my Apple Calendar today and tomorrow?" },
      {
        id: "prompt-schedule",
        text: "Find the latest email about the project meeting and add the meeting to my calendar.",
      },
    ],
    websiteUrl: "https://github.com/MrGo2/icloud-mcp",
    privacyPolicyUrl: "https://github.com/MrGo2/icloud-mcp/blob/main/PRIVACY.md",
    termsUrl: "https://github.com/MrGo2/icloud-mcp/blob/main/LICENSE",
    featured: false,
    apps: [
      {
        id: "app-apple-apps-mcp",
        name: "Apple apps",
        description:
          "Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari, over the local mcp-icloud server. Needs macOS and Automation access.",
        server: { name: "apple-apps", transport: "stdio", command: "npx", args: ["-y", "mcp-icloud@2.1.4"] },
      },
    ],
  },
  {
    slug: "sentry",
    name: "Sentry",
    tagline: "Errors and crash triage",
    description:
      "Sentry lets agents search recent errors, inspect stack traces and affected releases, and summarize what broke after a deploy. Each user signs in to their own Sentry account through the browser.",
    category: "coding",
    creatorName: "Sentry",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-errors", text: "What new errors appeared since yesterday's deploy?" },
      { id: "prompt-top-crash", text: "Explain the top crash in the mobile project and its likely cause." },
      { id: "prompt-release-health", text: "How healthy is the current release compared to the last one?" },
    ],
    websiteUrl: "https://sentry.io",
    privacyPolicyUrl: "https://sentry.io/privacy/",
    termsUrl: "https://sentry.io/terms/",
    featured: false,
    apps: [
      {
        id: "app-sentry-mcp",
        name: "Sentry",
        description:
          "Error search, issue inspection, and release health, over Sentry's MCP server with browser sign-in.",
        server: {
          name: "sentry",
          transport: "http",
          url: "https://mcp.sentry.dev/mcp",
          auth: [{ id: "sentry-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "gitlab",
    name: "GitLab",
    tagline: "Issues, merge requests and pipelines",
    description:
      "GitLab lets agents search projects, read and create issues, review and update merge requests, read repository files and commits, and check CI pipelines and jobs on GitLab.com. Each user signs in to their own GitLab account through the browser. Agents get the same permissions as the user: they can push commits, change issues and merge requests, and merge them. For a self-hosted GitLab, add an MCP server with your GitLab address followed by /api/v4/mcp in the MCP servers settings, and sign in there.",
    category: "coding",
    creatorName: "GitLab",
    version: "1.0.0",
    prompts: [
      { id: "prompt-review-queue", text: "Which merge requests wait for my review?" },
      { id: "prompt-failed-pipeline", text: "Why did the last pipeline on the default branch fail?" },
      { id: "prompt-new-issue", text: "File an issue for the crash in the sync queue with reproduction steps." },
    ],
    websiteUrl: "https://about.gitlab.com",
    privacyPolicyUrl: "https://about.gitlab.com/privacy/",
    termsUrl: "https://about.gitlab.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-gitlab-mcp",
        name: "GitLab",
        description:
          "Projects, issues, merge requests, repositories and CI pipelines, over GitLab's MCP server with browser sign-in.",
        server: {
          name: "gitlab",
          transport: "http",
          url: "https://gitlab.com/api/v4/mcp",
          auth: [{ id: "gitlab-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "vercel",
    name: "Vercel",
    tagline: "Deployments, build logs and projects",
    description:
      "Vercel lets agents list projects and recent deployments, read build and runtime logs, and find why a build failed. Each user signs in to their own Vercel account through the browser and chooses the teams that agents can use. In those teams, agents get the same rights as the user's account. They can also change environment variables, domains, DNS records and deployments, and buy domains.",
    category: "coding",
    creatorName: "Vercel",
    version: "1.0.0",
    prompts: [
      { id: "prompt-failed-build", text: "Why did the last production deployment fail?" },
      { id: "prompt-recent-deployments", text: "List the deployments from today and their status." },
      { id: "prompt-runtime-errors", text: "Which routes had runtime errors in the last hour?" },
    ],
    websiteUrl: "https://vercel.com",
    privacyPolicyUrl: "https://vercel.com/legal/privacy-notice",
    termsUrl: "https://vercel.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-vercel-mcp",
        name: "Vercel",
        description:
          "Projects, deployments, build logs, and runtime logs, over Vercel's MCP server with browser sign-in.",
        server: {
          name: "vercel",
          transport: "http",
          url: "https://mcp.vercel.com",
          auth: [{ id: "vercel-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    tagline: "Workers, DNS, storage and logs",
    description:
      "Cloudflare lets agents list and manage Workers, DNS records, R2, D1 and KV through the Cloudflare API, query Workers logs, and search the Cloudflare docs. Each user signs in to their own Cloudflare account through the browser. On Cloudflare's consent page, choose Read only: the default, Minimal, does not let agents see Workers, logs or DNS records. With write permissions, agents can deploy and delete Workers, change DNS records and change other account settings.",
    category: "coding",
    creatorName: "Cloudflare",
    version: "1.0.1",
    prompts: [
      { id: "prompt-workers", text: "Which Workers are deployed in my Cloudflare account?" },
      { id: "prompt-errors", text: "Which Cloudflare Workers logged errors in the last hour?" },
      { id: "prompt-dns", text: "List the DNS records of each zone in my Cloudflare account." },
    ],
    websiteUrl: "https://www.cloudflare.com",
    privacyPolicyUrl: "https://www.cloudflare.com/privacypolicy/",
    termsUrl: "https://www.cloudflare.com/website-terms/",
    featured: false,
    apps: [
      {
        id: "app-cloudflare-mcp",
        name: "Cloudflare",
        description: "Workers, DNS, storage, and logs, over Cloudflare's API MCP server with browser sign-in.",
        server: {
          name: "cloudflare",
          transport: "http",
          url: "https://mcp.cloudflare.com/mcp",
          auth: [{ id: "cloudflare-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "supabase",
    name: "Supabase",
    tagline: "Databases, logs and edge functions",
    description:
      "Supabase lets agents list projects, run SQL, read table schemas and logs, check security and performance advisors, manage edge functions and branches, and search the Supabase docs. Each user signs in to their own Supabase account through the browser and chooses an organization. Agents get full access: they can run SQL that changes or deletes data, apply migrations, deploy edge functions, and create or pause projects.",
    category: "coding",
    creatorName: "Supabase",
    version: "1.0.0",
    prompts: [
      { id: "prompt-projects", text: "Which projects are in my Supabase organization?" },
      { id: "prompt-tables", text: "List the tables and columns of my Supabase database." },
      { id: "prompt-errors", text: "Which errors did my Supabase project log in the last hour?" },
    ],
    websiteUrl: "https://supabase.com",
    privacyPolicyUrl: "https://supabase.com/privacy",
    termsUrl: "https://supabase.com/terms",
    featured: false,
    apps: [
      {
        id: "app-supabase-mcp",
        name: "Supabase",
        description: "Databases, logs, and edge functions, over Supabase's MCP server with browser sign-in.",
        server: {
          name: "supabase",
          transport: "http",
          url: "https://mcp.supabase.com/mcp",
          auth: [{ id: "supabase-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "neon",
    name: "Neon",
    tagline: "Postgres projects, branches and migrations",
    description:
      "Neon lets agents list projects and branches, run SQL, read table schemas, test schema changes on a temporary branch, find slow queries, and search the Neon docs. Each user signs in to their own Neon account through the browser and can choose read-only access when they authorize. With full access, agents can run SQL that changes or deletes data, and create, reset or delete branches, databases and projects. Neon recommends its MCP server for development and testing, not for production databases.",
    category: "coding",
    creatorName: "Neon",
    version: "1.0.0",
    prompts: [
      { id: "prompt-projects", text: "Which projects and branches are in my Neon account?" },
      { id: "prompt-slow-queries", text: "Which queries are the slowest on my Neon database, and why?" },
      {
        id: "prompt-migration",
        text: "Add an index on the orders table in a temporary branch, and show me the result before you apply it.",
      },
    ],
    websiteUrl: "https://neon.com",
    privacyPolicyUrl: "https://www.databricks.com/legal/privacynotice",
    termsUrl: "https://neon.com/platform-terms",
    featured: false,
    apps: [
      {
        id: "app-neon-mcp",
        name: "Neon",
        description: "Postgres projects, branches, SQL, and migrations, over Neon's MCP server with browser sign-in.",
        server: {
          name: "neon",
          transport: "http",
          url: "https://mcp.neon.tech/mcp",
          auth: [{ id: "neon-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "prisma",
    name: "Prisma",
    tagline: "Postgres databases, backups and Compute apps",
    description:
      "Prisma lets agents list and create Prisma Postgres databases, read schemas, run SQL, list backups and restore them to a new database, manage Object Storage buckets, read Compute builds and logs, and search the Prisma docs. Each user signs in to their own Prisma account through the browser and selects a workspace. Agents get full access: they can run SQL that changes or deletes data, update schemas, delete databases and buckets, and stop, roll back or delete Compute deployments.",
    category: "coding",
    creatorName: "Prisma",
    version: "1.0.0",
    prompts: [
      { id: "prompt-databases", text: "Which databases are in my Prisma workspace?" },
      { id: "prompt-backups", text: "Show me all available backups of my database." },
      { id: "prompt-logs", text: "Show the runtime logs of my latest Compute deployment." },
    ],
    websiteUrl: "https://www.prisma.io",
    privacyPolicyUrl: "https://www.prisma.io/legal/privacy",
    termsUrl: "https://www.prisma.io/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-prisma-mcp",
        name: "Prisma",
        description: "Databases, SQL, backups, and Compute apps, over Prisma's MCP server with browser sign-in.",
        server: {
          name: "prisma",
          transport: "http",
          url: "https://mcp.prisma.io/mcp",
          auth: [{ id: "prisma-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "netlify",
    name: "Netlify",
    tagline: "Projects, deploys and request logs",
    description:
      "Netlify lets agents list projects and deploys, read edge request logs, create projects, and deploy code to an existing project. Each user signs in to their own Netlify account through the browser. Agents get the same access as the user's account: they can change environment variables, forms and visitor access, install or remove extensions, and delete form submissions and environment variables.",
    category: "coding",
    creatorName: "Netlify",
    version: "1.0.0",
    prompts: [
      { id: "prompt-latest-deploy", text: "What is the status of the latest deploy of each of my Netlify projects?" },
      { id: "prompt-errors", text: "Which URLs of my site returned server errors in the last day?" },
      { id: "prompt-deploy", text: "Deploy this folder to my existing Netlify project." },
    ],
    websiteUrl: "https://www.netlify.com",
    privacyPolicyUrl: "https://www.netlify.com/privacy/",
    termsUrl: "https://www.netlify.com/pdf/self-serve-subscription-agreement.pdf",
    featured: false,
    apps: [
      {
        id: "app-netlify-mcp",
        name: "Netlify",
        description:
          "Projects, deploys, request logs, and site settings, over Netlify's MCP server with browser sign-in.",
        server: {
          name: "netlify",
          transport: "http",
          url: "https://netlify-mcp.netlify.app/mcp",
          auth: [{ id: "netlify-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "railway",
    name: "Railway",
    tagline: "Projects, services and deployments",
    description:
      "Railway lets agents list projects and services, create projects, redeploy services, and manage feature flags. Agents can also give multi-step work to the Railway Agent, which reads logs, finds why a deploy failed, creates services and sets variables. Each user signs in to their own Railway account through the browser and chooses the workspaces and projects that agents can use. Agents get full access in those projects: they can deploy staged changes, delete feature flags, and change services, variables, databases and networking through the Railway Agent.",
    category: "coding",
    creatorName: "Railway",
    version: "1.0.0",
    prompts: [
      { id: "prompt-projects", text: "Which projects and services are in my Railway workspace?" },
      { id: "prompt-crash", text: "Why does my backend service on Railway crash on deploy?" },
      { id: "prompt-redeploy", text: "Redeploy the API service in my Railway project." },
    ],
    websiteUrl: "https://railway.com",
    privacyPolicyUrl: "https://railway.com/legal/privacy",
    termsUrl: "https://railway.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-railway-mcp",
        name: "Railway",
        description: "Projects, services, and deployments, over Railway's MCP server with browser sign-in.",
        server: {
          name: "railway",
          transport: "http",
          url: "https://mcp.railway.com",
          auth: [{ id: "railway-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "render",
    name: "Render",
    tagline: "Services, deploys and logs",
    description:
      "Render lets agents list workspaces and services, read logs, events and metrics, see the deploy history, trigger deploys, and run read-only SQL on Render Postgres. A Render API key goes into one Authorization header. The key reaches every workspace of the Render account. Agents can create web services, static sites, cron jobs, Postgres databases and Key Value instances, which can cost money, and they can replace the environment variables of a service. The server cannot delete a resource.",
    category: "coding",
    creatorName: "Render",
    version: "1.0.0",
    prompts: [
      { id: "prompt-services", text: "Which services are in my Render workspace?" },
      { id: "prompt-logs", text: "Which errors did my Render web service log in the last hour?" },
      { id: "prompt-deploy", text: "Why did the last deploy of my Render service fail?" },
    ],
    websiteUrl: "https://render.com",
    privacyPolicyUrl: "https://render.com/privacy",
    termsUrl: "https://render.com/terms",
    featured: false,
    apps: [
      {
        id: "app-render-mcp",
        name: "Render",
        description: "Services, deploys, logs, and metrics, over Render's MCP server with an API key.",
        server: {
          name: "render",
          transport: "http",
          url: "https://mcp.render.com/mcp",
          auth: [
            {
              id: "render-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "token",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  placeholder: "rnd_…",
                  hint: "Render Account settings → API keys",
                },
              ],
              docsUrl: "https://dashboard.render.com/u/settings?add-api-key",
              docsLabel: "Create a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "context7",
    name: "Context7",
    tagline: "Current library documentation",
    description:
      "Context7 fetches current documentation and API references for libraries and frameworks, so answers use the version the project actually runs. It needs no account and no key.",
    category: "research",
    creatorName: "Upstash",
    version: "1.0.0",
    prompts: [
      { id: "prompt-api-check", text: "What is the current API for virtualized lists in this framework?" },
      { id: "prompt-migrate", text: "What changed between v2 and v3 of this router?" },
      { id: "prompt-example", text: "Show a current example for authenticated file uploads." },
    ],
    websiteUrl: "https://context7.com",
    privacyPolicyUrl: "https://context7.com/privacy",
    termsUrl: "https://context7.com/terms",
    featured: false,
    apps: [
      {
        id: "app-context7-mcp",
        name: "Context7",
        description: "Current library documentation lookup, over the Context7 MCP server with no sign-in.",
        server: { name: "context7", transport: "http", url: "https://mcp.context7.com/mcp" },
      },
    ],
  },
  {
    slug: "huggingface",
    name: "Hugging Face",
    tagline: "Models, datasets and papers on the Hub",
    description:
      "Hugging Face lets agents search models, datasets, Spaces, collections and papers on the Hugging Face Hub, read model cards and repository files, preview datasets, and search the Hugging Face documentation. It uses public Hub data and needs no account and no key. The tools only read: agents cannot create repositories or run jobs.",
    category: "research",
    creatorName: "Hugging Face",
    version: "1.0.0",
    prompts: [
      { id: "prompt-models", text: "Find small open models for speech recognition on Hugging Face." },
      { id: "prompt-papers", text: "Which papers are trending on Hugging Face today?" },
      { id: "prompt-dataset", text: "Find a dataset of weather time series and show its columns." },
    ],
    websiteUrl: "https://huggingface.co",
    privacyPolicyUrl: "https://huggingface.co/privacy",
    termsUrl: "https://huggingface.co/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-huggingface-mcp",
        name: "Hugging Face",
        description: "Model, dataset, Space, paper, and docs search, over Hugging Face's MCP server with no sign-in.",
        server: { name: "huggingface", transport: "http", url: "https://huggingface.co/mcp" },
      },
    ],
  },
  {
    slug: "stripe",
    name: "Stripe",
    tagline: "Payments and billing review",
    description:
      "Stripe lets agents look up payments, customers, and invoices, and draft payment links, in the account the signed-in user can reach. Each user signs in to their own Stripe account through the browser.",
    category: "other",
    creatorName: "Stripe",
    version: "1.0.0",
    prompts: [
      { id: "prompt-payment", text: "Look up this payment and explain why it failed." },
      { id: "prompt-customer", text: "Summarize this customer's invoices and outstanding balance." },
      { id: "prompt-link", text: "Draft a payment link for the Pro plan at 49 per month." },
    ],
    websiteUrl: "https://stripe.com",
    privacyPolicyUrl: "https://stripe.com/privacy",
    termsUrl: "https://stripe.com/ssa",
    featured: false,
    apps: [
      {
        id: "app-stripe-mcp",
        name: "Stripe",
        description: "Payment, customer, and invoice lookup, over Stripe's MCP server with browser sign-in.",
        server: {
          name: "stripe",
          transport: "http",
          url: "https://mcp.stripe.com",
          auth: [{ id: "stripe-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "revenuecat",
    name: "RevenueCat",
    tagline: "Subscriptions, products and paywalls",
    description:
      "RevenueCat lets agents read and change the setup of your in-app subscriptions: apps, products, entitlements, offerings, packages, paywalls and experiments. Agents can also look up customers and their purchases, and read charts and metrics. A RevenueCat secret API key goes into one Authorization header. The key reaches one project. With a read-only key, agents can only read. With a write key, agents can submit products to the App Store for review, grant entitlements to customers, and delete packages, targeting rules and webhooks.",
    category: "other",
    creatorName: "RevenueCat",
    version: "1.0.0",
    prompts: [
      { id: "prompt-offerings", text: "Which offerings and packages does my RevenueCat project have?" },
      { id: "prompt-revenue", text: "How did my RevenueCat revenue and active subscriptions change this month?" },
      {
        id: "prompt-customer",
        text: "Which entitlements does this RevenueCat customer have, and when do they expire?",
      },
    ],
    websiteUrl: "https://www.revenuecat.com",
    privacyPolicyUrl: "https://www.revenuecat.com/privacy",
    termsUrl: "https://www.revenuecat.com/terms",
    featured: false,
    apps: [
      {
        id: "app-revenuecat-mcp",
        name: "RevenueCat",
        description:
          "Products, entitlements, offerings, paywalls and metrics, over RevenueCat's MCP server with a secret API key.",
        server: {
          name: "revenuecat",
          transport: "http",
          url: "https://mcp.revenuecat.ai/mcp",
          auth: [
            {
              id: "revenuecat-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "token",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  placeholder: "sk_…",
                  hint: "In the RevenueCat dashboard, open API keys in your project and create a secret API key. A read-only key is enough to view data.",
                },
              ],
              docsUrl: "https://www.revenuecat.com/docs/projects/authentication#finding-api-keys",
              docsLabel: "Create a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "posthog",
    name: "PostHog",
    tagline: "Product analytics and flags",
    description:
      "PostHog lets agents query events and funnels, inspect feature flags, and summarize what changed after a release. A personal API key from the project settings goes into one Authorization header.",
    category: "data-analytics",
    creatorName: "PostHog",
    version: "1.0.0",
    prompts: [
      { id: "prompt-funnel", text: "How does the signup funnel look for the last 14 days?" },
      { id: "prompt-flag", text: "Which feature flags are enabled for this user?" },
      { id: "prompt-release", text: "Did activation change after last week's release?" },
    ],
    websiteUrl: "https://posthog.com",
    privacyPolicyUrl: "https://posthog.com/privacy",
    termsUrl: "https://posthog.com/terms",
    featured: false,
    apps: [
      {
        id: "app-posthog-mcp",
        name: "PostHog",
        description: "Event, funnel, and feature-flag access, over PostHog's MCP server with a personal API key.",
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
  },
  {
    slug: "airtable",
    name: "Airtable",
    tagline: "Bases and records",
    description:
      "Airtable lets agents list bases, read and update records, and summarize table contents. An API key from the account page is passed to the local server as one environment variable.",
    category: "data-analytics",
    creatorName: "Airtable",
    version: "1.0.1",
    prompts: [
      { id: "prompt-bases", text: "What bases do I have access to?" },
      { id: "prompt-records", text: "Summarize the launch tracker table." },
      { id: "prompt-update", text: "Mark the shipped features as done in the roadmap base." },
    ],
    websiteUrl: "https://www.airtable.com",
    privacyPolicyUrl: "https://www.airtable.com/privacy",
    termsUrl: "https://www.airtable.com/tos",
    featured: false,
    apps: [
      {
        id: "app-airtable-mcp",
        name: "Airtable",
        description: "Base listing and record access, over a local MCP server with an Airtable API key.",
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
  },
  {
    slug: "firecrawl",
    name: "Firecrawl",
    tagline: "Web extraction and search",
    description:
      "Firecrawl lets agents scrape pages, extract structured data, and search the web through one API. An API key from the Firecrawl dashboard is passed to the local server as one environment variable.",
    category: "research",
    creatorName: "Firecrawl",
    version: "1.0.0",
    prompts: [
      { id: "prompt-scrape", text: "Extract the pricing table from this page as structured data." },
      { id: "prompt-research", text: "Research competitor pricing and cite each source page." },
      { id: "prompt-monitor", text: "What changed on our changelog page this month?" },
    ],
    websiteUrl: "https://www.firecrawl.dev",
    privacyPolicyUrl: "https://www.firecrawl.dev/privacy",
    termsUrl: "https://www.firecrawl.dev/terms",
    featured: false,
    apps: [
      {
        id: "app-firecrawl-mcp",
        name: "Firecrawl",
        description: "Page scraping, extraction, and web search, over a local MCP server with a Firecrawl API key.",
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
  },
  {
    slug: "brave-search",
    name: "Brave Search",
    tagline: "Private web search",
    description:
      "Brave Search lets agents search the web and local results without tracking. An API key from the Brave Search API dashboard is passed to the local server as one environment variable.",
    category: "research",
    creatorName: "Brave",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search", text: "What are reviewers saying about this framework version?" },
      { id: "prompt-news", text: "Find today's announcements for this product area." },
      { id: "prompt-compare", text: "Compare these two vendors with cited sources." },
    ],
    websiteUrl: "https://brave.com",
    privacyPolicyUrl: "https://brave.com/privacy/",
    termsUrl: "https://brave.com/terms-of-use/",
    featured: false,
    apps: [
      {
        id: "app-brave-search-mcp",
        name: "Brave Search",
        description: "Web and local search, over a local MCP server with a Brave API key.",
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
  },
  {
    slug: "resend",
    name: "Resend",
    tagline: "Transactional email",
    description:
      "Resend lets agents send transactional email and check delivery through one API. An API key from the Resend dashboard is passed to the local server as one environment variable.",
    category: "automation",
    creatorName: "Resend",
    version: "1.0.0",
    prompts: [
      { id: "prompt-send", text: "Send the launch announcement draft to the beta list." },
      { id: "prompt-status", text: "Did the invoice email reach the customer?" },
      { id: "prompt-template", text: "Draft a password-reset email for the new flow." },
    ],
    websiteUrl: "https://resend.com",
    privacyPolicyUrl: "https://resend.com/legal/privacy-policy",
    termsUrl: "https://resend.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-resend-mcp",
        name: "Resend",
        description: "Email sending and delivery checks, over a local MCP server with a Resend API key.",
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
  },
  {
    slug: "omnisend",
    name: "Omnisend",
    tagline: "Email and SMS marketing",
    description:
      "Omnisend lets agents read campaign and form reports, find contacts and segments, and create and edit campaigns, automations, email templates, forms and products. Each user signs in to their own Omnisend account through the browser and selects the access level on the consent screen. With write access, agents can also send campaigns and delete data. Select read-only access when agents only need reports.",
    category: "automation",
    creatorName: "Omnisend",
    version: "1.0.0",
    prompts: [
      { id: "prompt-last-campaign", text: "How did last week's campaigns perform compared to the week before?" },
      { id: "prompt-segment", text: "How many contacts are in the VIP segment, and how did it change this month?" },
      { id: "prompt-draft-campaign", text: "Draft a campaign for the new collection, but do not send it." },
    ],
    websiteUrl: "https://www.omnisend.com",
    privacyPolicyUrl: "https://www.omnisend.com/privacy/",
    termsUrl: "https://www.omnisend.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-omnisend-mcp",
        name: "Omnisend",
        description:
          "Campaigns, automations, contacts, segments, forms and reports, over Omnisend's MCP server with browser sign-in.",
        server: {
          name: "omnisend",
          transport: "http",
          url: "https://mcp.omnisend.com/mcp",
          auth: [{ id: "omnisend-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "postiz",
    name: "Postiz",
    tagline: "Social media scheduling",
    description:
      "Postiz lets agents list your social media channels, and draft, schedule and publish posts on more than 30 networks, such as X, LinkedIn, Instagram and TikTok. Agents can also upload media and make AI images and videos. Sign in to your Postiz account through the browser, or paste the API key from Settings › Developers in Postiz. All Postiz cloud plans include API access. Agents can publish a post immediately, so review each post before you approve it.",
    category: "automation",
    creatorName: "Postiz",
    version: "1.0.0",
    prompts: [
      { id: "prompt-channels", text: "Which social media channels are connected to Postiz?" },
      { id: "prompt-week", text: "Which posts are scheduled for next week?" },
      { id: "prompt-draft", text: "Draft a LinkedIn post about our new release, but do not schedule it." },
    ],
    websiteUrl: "https://postiz.com",
    privacyPolicyUrl: "https://postiz.com/privacy",
    termsUrl: "https://postiz.com/terms",
    featured: false,
    apps: [
      {
        id: "app-postiz-mcp",
        name: "Postiz",
        description:
          "Channels, drafts, scheduled posts and media, over Postiz's MCP server with browser sign-in or an API key.",
        server: {
          name: "postiz",
          transport: "http",
          url: "https://mcp.postiz.com/mcp-oauth-dynamic",
          auth: [
            { id: "postiz-oauth", kind: "link", label: "Sign in" },
            {
              id: "postiz-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "api-key",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  hint: "Postiz Settings › Developers › Your API key",
                },
              ],
              docsUrl: "https://docs.postiz.com/general/settings/developers",
              docsLabel: "Get a key",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "trypost",
    name: "TryPost",
    tagline: "Social media scheduling",
    description:
      "TryPost lets agents list your connected channels, and draft, schedule, queue and publish posts on X, LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads, Bluesky, Mastodon, Pinterest and more. Agents can also read analytics, manage ideas and approvals, and set posting times. Sign in to your TryPost account through the browser and choose a workspace. Agents can publish a post immediately, so review each post before you approve it.",
    category: "automation",
    creatorName: "TryPost",
    version: "1.0.0",
    prompts: [
      { id: "prompt-week", text: "Which posts are scheduled for this week?" },
      { id: "prompt-draft", text: "Draft a LinkedIn post about our new release, but do not schedule it." },
      { id: "prompt-analytics", text: "Which of my posts from last month had the most engagement?" },
    ],
    websiteUrl: "https://trypost.it",
    privacyPolicyUrl: "https://trypost.it/en/privacy",
    termsUrl: "https://trypost.it/en/terms",
    featured: false,
    apps: [
      {
        id: "app-trypost-mcp",
        name: "TryPost",
        description: "Channels, posts, queue, ideas and analytics, over TryPost's MCP server with browser sign-in.",
        server: {
          name: "trypost",
          transport: "http",
          url: "https://app.trypost.it/mcp/trypost",
          auth: [{ id: "trypost-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "composio",
    name: "Composio",
    tagline: "Gmail, Slack, GitHub and 1,000+ more apps",
    description:
      "Composio connects your agents to Gmail, Slack, GitHub and more than 1,000 other apps through one MCP server. Sign in with your Composio account. When an agent needs an app, it asks you to connect that app.",
    category: "automation",
    creatorName: "Composio",
    version: "1.2.0",
    prompts: [
      { id: "prompt-inbox", text: "Summarize my unread email and draft replies to the urgent ones." },
      { id: "prompt-handoff", text: "Post a summary of this pull request to our team channel." },
      { id: "prompt-apps", text: "Which apps and actions can you use through Composio?" },
    ],
    websiteUrl: "https://composio.dev",
    privacyPolicyUrl: "https://composio.dev/privacy-policy",
    termsUrl: "https://composio.dev/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-composio-mcp",
        name: "Composio",
        description:
          "The apps you connect in your Composio account. An agent asks you to connect an app when it needs it.",
        server: {
          name: "composio",
          transport: "http",
          url: "https://connect.composio.dev/mcp",
          earlierUrls: ["https://composio.dev/"],
          auth: [
            { id: "composio-oauth", kind: "link", label: "Sign in" },
            {
              id: "composio-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "api-key",
                  label: "API key",
                  header: "x-consumer-api-key",
                  placeholder: "ck_…",
                  hint: "Find it in your Composio account, in Settings > Sessions & API Key.",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    slug: "clickup",
    name: "ClickUp",
    tagline: "Tasks, docs and team updates",
    description:
      "ClickUp lets agents search tasks, docs, comments and chat, create and update tasks, lists and docs, post comments, send chat messages and track time. Each user signs in to their own ClickUp account through the browser. Agents get the same permissions as the user. They can move tasks to the trash and delete comments.",
    category: "productivity",
    creatorName: "ClickUp",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-tasks", text: "Find my open ClickUp tasks due this week." },
      { id: "prompt-create-task", text: "Create a ClickUp task for these action items and assign it to me." },
      {
        id: "prompt-summarize-doc",
        text: "Find the latest project update in ClickUp and summarize the open questions.",
      },
    ],
    websiteUrl: "https://clickup.com",
    privacyPolicyUrl: "https://clickup.com/terms/privacy",
    termsUrl: "https://clickup.com/terms",
    featured: false,
    apps: [
      {
        id: "app-clickup-mcp",
        name: "ClickUp",
        description: "Tasks, docs, comments, chat and time tracking, over ClickUp's MCP server with browser sign-in.",
        server: {
          name: "clickup",
          transport: "http",
          url: "https://mcp.clickup.com/mcp",
          auth: [{ id: "clickup-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "coinbase",
    name: "Coinbase",
    tagline: "Crypto prices, portfolios and trading",
    description:
      "Coinbase lets agents read prices, balances, portfolios, orders and fees in Coinbase Advanced Trade, preview and place orders, convert between assets, and move funds between portfolios. Each user signs in to their own Coinbase account through the browser. Agents get the same permissions as the user. Orders and conversions use real funds, and agents can pay for x402 requests from the USDC balance.",
    category: "data-analytics",
    creatorName: "Coinbase",
    version: "1.0.0",
    prompts: [
      { id: "prompt-balances", text: "What are my Coinbase balances in each portfolio?" },
      { id: "prompt-price", text: "Show the BTC-USD price on Coinbase and how it moved this week." },
      { id: "prompt-preview-order", text: "Preview a 50 USD market buy of ETH on Coinbase. Do not place the order." },
    ],
    websiteUrl: "https://www.coinbase.com",
    privacyPolicyUrl: "https://www.coinbase.com/legal/privacy",
    termsUrl: "https://www.coinbase.com/legal/user_agreement",
    featured: false,
    apps: [
      {
        id: "app-coinbase-mcp",
        name: "Coinbase",
        description:
          "Prices, balances, portfolios, orders and conversions, over Coinbase's MCP server with browser sign-in.",
        server: {
          name: "coinbase",
          transport: "http",
          url: "https://agents.coinbase.com/mcp",
          auth: [{ id: "coinbase-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "robinhood",
    name: "Robinhood",
    tagline: "Brokerage accounts and agentic trading",
    description:
      "Robinhood lets agents read the accounts, positions, balances, transaction history and watchlists of a Robinhood customer, read market data, and place stock, options and crypto orders. Each user signs in to their own Robinhood account through the browser. At the first sign-in, Robinhood asks the user to open a separate Agentic account. Agents can trade only in that account, and by default they place orders without asking the user to approve each one.",
    category: "data-analytics",
    creatorName: "Robinhood",
    version: "1.0.0",
    prompts: [
      { id: "prompt-positions", text: "Summarize my Robinhood positions and how they moved today." },
      { id: "prompt-watchlist", text: "How did each stock on my Robinhood watchlist move this week?" },
      { id: "prompt-agentic-cash", text: "How much cash is in my Robinhood Agentic account?" },
    ],
    websiteUrl: "https://robinhood.com",
    privacyPolicyUrl: "https://robinhood.com/us/en/support/articles/privacy-policy/",
    termsUrl: "https://robinhood.com/us/en/about/legal/",
    featured: false,
    apps: [
      {
        id: "app-robinhood-mcp",
        name: "Robinhood",
        description: "Accounts, positions, market data and trades, over Robinhood's MCP server with browser sign-in.",
        server: {
          name: "robinhood",
          transport: "http",
          url: "https://agent.robinhood.com/mcp/trading",
          auth: [{ id: "robinhood-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "1inch",
    name: "1inch",
    tagline: "API docs and SDK examples",
    description:
      "1inch lets agents search the 1inch Business API documentation and read SDK code examples for swaps, limit orders, and other integrations. Documentation search and SDK examples need no account and no key.",
    category: "coding",
    creatorName: "1inch",
    version: "1.0.0",
    prompts: [
      { id: "prompt-swap-api", text: "How do I get a swap quote with the 1inch API? Show the request parameters." },
      { id: "prompt-sdk-example", text: "Show the SDK example for creating a limit order." },
      { id: "prompt-chains", text: "Which chains does the 1inch Swap API support?" },
    ],
    websiteUrl: "https://business.1inch.com",
    privacyPolicyUrl: "https://business.1inch.com/portal/privacy-policy",
    termsUrl: "https://business.1inch.com/portal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-1inch-mcp",
        name: "1inch",
        description: "1inch documentation search and SDK examples, over the 1inch MCP server with no sign-in.",
        server: { name: "1inch", transport: "http", url: "https://api.1inch.com/mcp/protocol" },
      },
    ],
  },
  {
    slug: "21st",
    name: "21st",
    tagline: "React UI component catalog",
    description:
      "21st lets agents search a catalog of React UI components and add the chosen components to the project. Each user signs in to their own 21st account through the browser.",
    category: "coding",
    creatorName: "21st",
    version: "1.0.0",
    prompts: [
      { id: "prompt-pricing-table", text: "Find a pricing table component that fits this landing page." },
      { id: "prompt-navbar", text: "Add a responsive navigation bar component to the header." },
      { id: "prompt-compare", text: "Show three date picker components and compare their props." },
    ],
    websiteUrl: "https://21st.dev",
    privacyPolicyUrl: "https://21st.dev/privacy",
    termsUrl: "https://21st.dev/terms",
    featured: false,
    apps: [
      {
        id: "app-21st-mcp",
        name: "21st",
        description: "UI component search and install, over 21st's MCP server with browser sign-in.",
        server: {
          name: "21st",
          transport: "http",
          url: "https://21st.dev/api/mcp",
          auth: [{ id: "21st-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "2chat",
    name: "2Chat",
    tagline: "WhatsApp, SMS, and voice",
    description:
      "2Chat lets agents read WhatsApp and SMS conversations, look up and add contacts, and draft replies on the 2Chat numbers of the signed-in account. Each user signs in to their own 2Chat account through the browser.",
    category: "productivity",
    creatorName: "2Chat",
    version: "1.0.0",
    prompts: [
      { id: "prompt-unread", text: "Summarize the WhatsApp conversations that have no reply yet." },
      { id: "prompt-contact", text: "Add a contact for Ana Ruiz with her phone number and company." },
      {
        id: "prompt-draft-reply",
        text: "Draft a reply to the last message from this customer about the delivery date.",
      },
    ],
    websiteUrl: "https://2chat.co",
    privacyPolicyUrl: "https://2chat.co/privacy-policy",
    termsUrl: "https://2chat.co/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-2chat-mcp",
        name: "2Chat",
        description: "WhatsApp, SMS, contact, and call tools, over 2Chat's MCP server with browser sign-in.",
        server: {
          name: "2chat",
          transport: "http",
          url: "https://mcp.2chat.io/mcp",
          auth: [{ id: "2chat-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "adspirer",
    name: "Adspirer",
    tagline: "Ad campaign reporting",
    description:
      "Adspirer lets agents read campaign performance and draft campaign changes across Google Ads, Meta Ads, LinkedIn Ads, and TikTok Ads accounts that the user connects in Adspirer. Each user signs in to their own Adspirer account through the browser.",
    category: "data-analytics",
    creatorName: "Adspirer",
    version: "1.0.0",
    prompts: [
      { id: "prompt-weekly", text: "How did my Google Ads campaigns perform last week compared to the week before?" },
      { id: "prompt-waste", text: "Which keywords spent the most this month with no conversions?" },
      { id: "prompt-draft-ads", text: "Draft three new ad headlines for the spring sale campaign." },
    ],
    websiteUrl: "https://www.adspirer.com",
    privacyPolicyUrl: "https://www.adspirer.com/privacy",
    termsUrl: "https://www.adspirer.com/terms",
    featured: false,
    apps: [
      {
        id: "app-adspirer-mcp",
        name: "Adspirer",
        description: "Ad account reporting and campaign management, over Adspirer's MCP server with browser sign-in.",
        server: {
          name: "adspirer",
          transport: "http",
          url: "https://mcp.adspirer.com/mcp",
          auth: [{ id: "adspirer-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "affinity",
    name: "Affinity",
    tagline: "Relationship CRM for dealmaking",
    description:
      "Affinity lets agents search people, companies, and opportunities, read notes and interaction history, and update lists in the CRM of the signed-in account. Each user signs in to their own Affinity account through the browser.",
    category: "productivity",
    creatorName: "Affinity",
    version: "1.0.0",
    prompts: [
      { id: "prompt-who-knows", text: "Who on my team has the strongest connection to this company?" },
      { id: "prompt-pipeline", text: "Summarize the deals in my pipeline list that had no contact in 30 days." },
      { id: "prompt-meeting-prep", text: "Prepare a brief on this founder from our notes and past emails." },
    ],
    websiteUrl: "https://www.affinity.co",
    privacyPolicyUrl: "https://www.affinity.co/legal/privacy-policy",
    termsUrl: "https://www.affinity.co/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-affinity-mcp",
        name: "Affinity",
        description: "CRM search, notes, and list updates, over Affinity's MCP server with browser sign-in.",
        server: {
          name: "affinity",
          transport: "http",
          url: "https://mcp.affinity.co/mcp",
          auth: [{ id: "affinity-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "agentmail",
    name: "AgentMail",
    tagline: "Email inboxes for agents",
    description:
      "AgentMail lets agents create email inboxes, read threads, and draft and send messages from those inboxes. Each user signs in to their own AgentMail account through the browser.",
    category: "automation",
    creatorName: "AgentMail",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-inbox", text: "Create an inbox for the support agent." },
      { id: "prompt-summarize", text: "Summarize the unread threads in the support inbox." },
      { id: "prompt-draft", text: "Draft a reply to the latest message in the billing thread." },
    ],
    websiteUrl: "https://www.agentmail.to",
    privacyPolicyUrl: "https://www.agentmail.to/legal/privacy",
    termsUrl: "https://www.agentmail.to/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-agentmail-mcp",
        name: "AgentMail",
        description: "Inbox, thread, and message tools, over AgentMail's MCP server with browser sign-in.",
        server: {
          name: "agentmail",
          transport: "http",
          url: "https://mcp.agentmail.to/mcp",
          auth: [{ id: "agentmail-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ahrefs",
    name: "Ahrefs",
    tagline: "SEO and keyword data",
    description:
      "Ahrefs lets agents research keywords, backlinks, organic traffic, and competitor sites with Ahrefs data. Each user signs in to their own Ahrefs account through the browser.",
    category: "research",
    creatorName: "Ahrefs",
    version: "1.0.0",
    prompts: [
      { id: "prompt-keywords", text: "Find low-difficulty keywords about home espresso machines." },
      { id: "prompt-competitors", text: "Which pages bring the most organic traffic to this competitor?" },
      { id: "prompt-backlinks", text: "List the new backlinks to our site in the last 30 days." },
    ],
    websiteUrl: "https://ahrefs.com",
    privacyPolicyUrl: "https://ahrefs.com/legal/privacy-policy",
    termsUrl: "https://ahrefs.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-ahrefs-mcp",
        name: "Ahrefs",
        description: "Keyword, backlink, and site research, over Ahrefs's MCP server with browser sign-in.",
        server: {
          name: "ahrefs",
          transport: "http",
          url: "https://api.ahrefs.com/mcp/mcp",
          auth: [{ id: "ahrefs-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "airwallex",
    name: "Airwallex",
    tagline: "Business accounts and cards",
    description:
      "Airwallex lets agents read balances and transactions, build cashflow reports, create beneficiaries, and issue cards in the production account of the signed-in user. Each user signs in to their own Airwallex account through the browser.",
    category: "other",
    creatorName: "Airwallex",
    version: "1.0.0",
    prompts: [
      { id: "prompt-balances", text: "What are my balances in each currency today?" },
      { id: "prompt-cashflow", text: "Build a cashflow report for last month." },
      { id: "prompt-card-spend", text: "Which cards had the most spend this quarter?" },
    ],
    websiteUrl: "https://www.airwallex.com",
    privacyPolicyUrl: "https://www.airwallex.com/global/terms/privacy-policy",
    termsUrl: "https://www.airwallex.com/global/terms",
    featured: false,
    apps: [
      {
        id: "app-airwallex-mcp",
        name: "Airwallex",
        description:
          "Balances, transactions, reports, beneficiaries, and cards, over Airwallex's MCP server with browser sign-in.",
        server: {
          name: "airwallex",
          transport: "http",
          url: "https://mcp.airwallex.com/mcp",
          auth: [{ id: "airwallex-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "akiflow",
    name: "Akiflow",
    tagline: "Tasks and calendar planning",
    description:
      "Akiflow lets agents read and add tasks, plan the day, and check calendar events in the signed-in account. Each user signs in to their own Akiflow account through the browser.",
    category: "productivity",
    creatorName: "Akiflow",
    version: "1.0.0",
    prompts: [
      { id: "prompt-today", text: "What is on my plan for today?" },
      { id: "prompt-add-task", text: "Add a task to review the contract draft on Friday morning." },
      { id: "prompt-free-time", text: "Where do I have two free hours this week for deep work?" },
    ],
    websiteUrl: "https://akiflow.com",
    privacyPolicyUrl: "https://akiflow.com/privacy-policy",
    termsUrl: "https://akiflow.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-akiflow-mcp",
        name: "Akiflow",
        description: "Task, calendar, and planning tools, over Akiflow's MCP server with browser sign-in.",
        server: {
          name: "akiflow",
          transport: "http",
          url: "https://mcp.akiflow.com/mcp",
          auth: [{ id: "akiflow-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "aleph",
    name: "Aleph",
    tagline: "Financial data for FP&A",
    description:
      "Aleph lets agents query the financial data, reports, and models of the signed-in user's Aleph workspace. Each user signs in to their own Aleph account through the browser.",
    category: "data-analytics",
    creatorName: "Aleph",
    version: "1.0.0",
    prompts: [
      { id: "prompt-variance", text: "Explain the variance between budget and actuals for last quarter." },
      { id: "prompt-burn", text: "What is our monthly burn rate for the last six months?" },
      { id: "prompt-board-summary", text: "Draft a summary of revenue and margin trends for the board pack." },
    ],
    websiteUrl: "https://www.getaleph.com",
    privacyPolicyUrl: "https://www.getaleph.com/privacy-policy",
    termsUrl: "https://www.getaleph.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-aleph-mcp",
        name: "Aleph",
        description: "Financial data and report queries, over Aleph's MCP server with browser sign-in.",
        server: {
          name: "aleph",
          transport: "http",
          url: "https://mcp.getaleph.com/mcp",
          auth: [{ id: "aleph-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "algolia",
    name: "Algolia",
    tagline: "Search index management",
    description:
      "Algolia lets agents search indices, read and update index settings, and check search analytics in the applications that the signed-in user can access. Each user signs in to their own Algolia account through the browser.",
    category: "coding",
    creatorName: "Algolia",
    version: "1.0.0",
    prompts: [
      { id: "prompt-no-results", text: "Which search queries returned no results last week?" },
      { id: "prompt-settings", text: "Show the searchable attributes and ranking settings of the products index." },
      { id: "prompt-test-query", text: "Search the products index for 'running shoes' and explain the ranking." },
    ],
    websiteUrl: "https://www.algolia.com",
    privacyPolicyUrl: "https://www.algolia.com/policies/privacy",
    termsUrl: "https://www.algolia.com/policies/terms",
    featured: false,
    apps: [
      {
        id: "app-algolia-mcp",
        name: "Algolia",
        description: "Index search, settings, and analytics, over Algolia's MCP server with browser sign-in.",
        server: {
          name: "algolia",
          transport: "http",
          url: "https://mcp.algolia.com/mcp",
          auth: [{ id: "algolia-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "allo",
    name: "Allo",
    tagline: "Business phone and SMS",
    description:
      "Allo lets agents read call transcripts and SMS, look up and update contacts, and draft text messages in the signed-in workspace. Each user signs in to their own Allo account through the browser.",
    category: "productivity",
    creatorName: "Allo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-missed", text: "Which calls did I miss today, and what did the callers want?" },
      { id: "prompt-transcript", text: "Summarize my last call with this customer." },
      { id: "prompt-contact", text: "Update the contact for Tom Becker with his new company name." },
    ],
    websiteUrl: "https://www.withallo.com",
    privacyPolicyUrl: "https://www.withallo.com/privacy-policy",
    termsUrl: "https://www.withallo.com/terms-conditions",
    featured: false,
    apps: [
      {
        id: "app-allo-mcp",
        name: "Allo",
        description: "Call, SMS, and contact tools, over Allo's MCP server with browser sign-in.",
        server: {
          name: "allo",
          transport: "http",
          url: "https://mcp.withallo.com/mcp",
          auth: [{ id: "allo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "alphavantage",
    name: "Alpha Vantage",
    tagline: "Stock and market data",
    description:
      "Alpha Vantage lets agents look up stock prices, company fundamentals, forex and crypto rates, economic indicators, and technical indicators. Each user signs in to their own Alpha Vantage account through the browser.",
    category: "data-analytics",
    creatorName: "Alpha Vantage",
    version: "1.0.0",
    prompts: [
      { id: "prompt-quote", text: "What is the latest price and daily change for MSFT?" },
      { id: "prompt-earnings", text: "Compare the last four quarters of earnings for AAPL and GOOGL." },
      { id: "prompt-rsi", text: "Show the 14-day RSI for NVDA over the last month." },
    ],
    websiteUrl: "https://www.alphavantage.co",
    privacyPolicyUrl: "https://www.alphavantage.co/privacy/",
    termsUrl: "https://www.alphavantage.co/terms_of_service/",
    featured: false,
    apps: [
      {
        id: "app-alphavantage-mcp",
        name: "Alpha Vantage",
        description:
          "Market prices, fundamentals, and indicators, over Alpha Vantage's MCP server with browser sign-in.",
        server: {
          name: "alphavantage",
          transport: "http",
          url: "https://mcp.alphavantage.co/mcp",
          auth: [{ id: "alphavantage-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "amplemarket",
    name: "Amplemarket",
    tagline: "Sales prospecting and enrichment",
    description:
      "Amplemarket lets agents find and research leads, enrich companies and contacts, review outreach activity, and add leads to lists in the signed-in account. Each user signs in to their own Amplemarket account through the browser.",
    category: "research",
    creatorName: "Amplemarket",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-find-leads",
        text: "Find heads of finance at logistics companies in Germany with 200 to 1,000 employees.",
      },
      { id: "prompt-account", text: "Research this company: tech stack, recent hires, and funding." },
      { id: "prompt-touchpoints", text: "What were our past touchpoints with this email address?" },
    ],
    websiteUrl: "https://www.amplemarket.com",
    privacyPolicyUrl: "https://www.amplemarket.com/legal/privacy",
    termsUrl: "https://www.amplemarket.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-amplemarket-mcp",
        name: "Amplemarket",
        description: "Lead search, enrichment, and outreach data, over Amplemarket's MCP server with browser sign-in.",
        server: {
          name: "amplemarket",
          transport: "http",
          url: "https://mcp.amplemarket.com/mcp",
          auth: [{ id: "amplemarket-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "amplitude",
    name: "Amplitude",
    tagline: "Product analytics",
    description:
      "Amplitude lets agents query events, charts, dashboards, and experiments in the projects that the signed-in user can access. Each user signs in to their own Amplitude account through the browser.",
    category: "data-analytics",
    creatorName: "Amplitude",
    version: "1.0.0",
    prompts: [
      { id: "prompt-retention", text: "How did week-one retention change after the last release?" },
      { id: "prompt-funnel", text: "Where do users drop off in the signup funnel?" },
      { id: "prompt-experiment", text: "Summarize the results of the running checkout experiment." },
    ],
    websiteUrl: "https://amplitude.com",
    privacyPolicyUrl: "https://amplitude.com/privacy",
    termsUrl: "https://amplitude.com/terms",
    featured: false,
    apps: [
      {
        id: "app-amplitude-mcp",
        name: "Amplitude",
        description: "Product analytics queries and charts, over Amplitude's MCP server with browser sign-in.",
        server: {
          name: "amplitude",
          transport: "http",
          url: "https://mcp.amplitude.com/mcp",
          auth: [{ id: "amplitude-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ando",
    name: "Ando",
    tagline: "Team chat with agents",
    description:
      "Ando lets agents join a workspace as a member, read channels and threads, and post messages. Each user signs in to their own Ando account through the browser.",
    category: "productivity",
    creatorName: "Ando",
    version: "1.0.0",
    prompts: [
      { id: "prompt-catch-up", text: "Summarize what happened in the product channel today." },
      { id: "prompt-mentions", text: "Which threads mention me and still need an answer?" },
      { id: "prompt-draft-update", text: "Draft a status update for the launch thread." },
    ],
    websiteUrl: "https://www.ando.so",
    privacyPolicyUrl: "https://www.ando.so/security/privacy-policy",
    termsUrl: "https://www.ando.so/security/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-ando-mcp",
        name: "Ando",
        description: "Channel, thread, and message tools, over Ando's MCP server with browser sign-in.",
        server: {
          name: "ando",
          transport: "http",
          url: "https://mcp.ando.so/mcp",
          auth: [{ id: "ando-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "apify",
    name: "Apify",
    tagline: "Web scraping and automation",
    description:
      "Apify lets agents search the Apify Store, run Actors that scrape and extract web data, and read the results. Each user signs in to their own Apify account through the browser.",
    category: "research",
    creatorName: "Apify",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-actor", text: "Find an Actor that extracts reviews from Google Maps." },
      { id: "prompt-scrape", text: "Scrape the product names and prices from this category page." },
      { id: "prompt-last-run", text: "Show the results of my last Actor run." },
    ],
    websiteUrl: "https://apify.com",
    privacyPolicyUrl: "https://docs.apify.com/legal/privacy-policy",
    termsUrl: "https://docs.apify.com/legal/general-terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-apify-mcp",
        name: "Apify",
        description: "Actor search, runs, and dataset results, over Apify's MCP server with browser sign-in.",
        server: {
          name: "apify",
          transport: "http",
          url: "https://mcp.apify.com",
          auth: [{ id: "apify-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "apollo",
    name: "Apollo",
    tagline: "B2B contacts and prospecting",
    description:
      "Apollo lets agents search B2B contacts and companies, enrich records, and review sequences in the signed-in account. Each user signs in to their own Apollo account through the browser.",
    category: "research",
    creatorName: "Apollo.io",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-contacts", text: "Find VPs of engineering at fintech companies in London." },
      { id: "prompt-enrich", text: "Enrich this list of companies with size, industry, and location." },
      { id: "prompt-sequences", text: "Which of my sequences had the best reply rate this month?" },
    ],
    websiteUrl: "https://www.apollo.io",
    privacyPolicyUrl: "https://www.apollo.io/privacy-policy",
    termsUrl: "https://www.apollo.io/terms",
    featured: false,
    apps: [
      {
        id: "app-apollo-mcp",
        name: "Apollo",
        description: "Contact search, enrichment, and sequences, over Apollo's MCP server with browser sign-in.",
        server: {
          name: "apollo",
          transport: "http",
          url: "https://mcp.apollo.io/mcp",
          auth: [{ id: "apollo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "artie",
    name: "Artie",
    tagline: "Real-time data pipelines",
    description:
      "Artie lets agents create, check, and manage the real-time database replication pipelines of the signed-in account. Each user signs in to their own Artie account through the browser.",
    category: "data-analytics",
    creatorName: "Artie",
    version: "1.0.0",
    prompts: [
      { id: "prompt-status", text: "Which of my pipelines have errors or lag right now?" },
      { id: "prompt-tables", text: "List the tables that the Postgres pipeline replicates to Snowflake." },
      { id: "prompt-new-pipeline", text: "Help me set up a pipeline from our MySQL database to BigQuery." },
    ],
    websiteUrl: "https://www.artie.com",
    privacyPolicyUrl: "https://www.artie.com/privacy",
    termsUrl: "https://www.artie.com/docs/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-artie-mcp",
        name: "Artie",
        description: "Pipeline setup, status, and management, over Artie's MCP server with browser sign-in.",
        server: {
          name: "artie",
          transport: "http",
          url: "https://mcp.artie.com/mcp",
          auth: [{ id: "artie-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "atlan",
    name: "Atlan",
    tagline: "Data catalog and lineage",
    description:
      "Atlan lets agents search data assets, read lineage and ownership, and update asset metadata with the signed-in user's permissions. Each user signs in to their own Atlan account through the browser.",
    category: "data-analytics",
    creatorName: "Atlan",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-table", text: "Which table holds the certified revenue numbers?" },
      { id: "prompt-lineage", text: "Show the upstream lineage of the monthly churn dashboard." },
      { id: "prompt-owner", text: "Who owns the orders table, and which dashboards use it?" },
    ],
    websiteUrl: "https://atlan.com",
    privacyPolicyUrl: "https://atlan.com/privacy-policy/",
    termsUrl: "https://atlan.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-atlan-mcp",
        name: "Atlan",
        description: "Asset search, lineage, and metadata, over Atlan's MCP server with browser sign-in.",
        server: {
          name: "atlan",
          transport: "http",
          url: "https://mcp.atlan.com/mcp",
          auth: [{ id: "atlan-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "attio",
    name: "Attio",
    tagline: "CRM records and deals",
    description:
      "Attio lets agents search records, update deals, log notes, and create tasks in the workspace of the signed-in account. Each user signs in to their own Attio account through the browser.",
    category: "productivity",
    creatorName: "Attio",
    version: "1.0.0",
    prompts: [
      { id: "prompt-stale-deals", text: "Which open deals had no activity in the last two weeks?" },
      { id: "prompt-log-note", text: "Log a note on the Acme deal with the points from today's call." },
      { id: "prompt-follow-up", text: "Create a task to follow up with this contact next Tuesday." },
    ],
    websiteUrl: "https://attio.com",
    privacyPolicyUrl: "https://attio.com/legal/privacy",
    termsUrl: "https://attio.com/legal/services-agreement",
    featured: false,
    apps: [
      {
        id: "app-attio-mcp",
        name: "Attio",
        description: "Record search, deal updates, notes, and tasks, over Attio's MCP server with browser sign-in.",
        server: {
          name: "attio",
          transport: "http",
          url: "https://mcp.attio.com/mcp",
          auth: [{ id: "attio-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "aws-knowledge",
    name: "AWS Knowledge",
    tagline: "AWS documentation lookup",
    description:
      "AWS Knowledge lets agents search and read current AWS documentation, and check which services and features are available in each AWS Region. It needs no account and no key.",
    category: "coding",
    creatorName: "Amazon Web Services",
    version: "1.0.0",
    prompts: [
      { id: "prompt-region", text: "Is Amazon Bedrock available in eu-central-1?" },
      { id: "prompt-best-practice", text: "What does the AWS documentation recommend for S3 bucket access control?" },
      { id: "prompt-limits", text: "What are the default Lambda concurrency limits, and how do I raise them?" },
    ],
    websiteUrl: "https://aws.amazon.com",
    privacyPolicyUrl: "https://aws.amazon.com/privacy/",
    termsUrl: "https://aws.amazon.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-aws-knowledge-mcp",
        name: "AWS Knowledge",
        description:
          "AWS documentation search and regional availability, over the AWS Knowledge MCP server with no sign-in.",
        server: { name: "aws-knowledge", transport: "http", url: "https://knowledge-mcp.global.api.aws" },
      },
    ],
  },
  {
    slug: "base44",
    name: "Base44",
    tagline: "AI app builder",
    description:
      "Base44 lets agents create and manage Base44 projects, edit an app's code in its sandbox, and call the Base44 platform API. Each user signs in to their own Base44 account through the browser.",
    category: "coding",
    creatorName: "Base44",
    version: "1.0.0",
    prompts: [
      { id: "prompt-list-apps", text: "List my Base44 apps and when each one changed last." },
      { id: "prompt-new-app", text: "Create a Base44 app for booking meeting rooms." },
      { id: "prompt-fix", text: "Fix the form validation on the signup page of my app." },
    ],
    websiteUrl: "https://base44.com",
    privacyPolicyUrl: "https://base44.com/about-us/legal/privacy-policy",
    termsUrl: "https://base44.com/about-us/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-base44-mcp",
        name: "Base44",
        description: "Project, app code, and platform tools, over Base44's MCP server with browser sign-in.",
        server: {
          name: "base44",
          transport: "http",
          url: "https://app.base44.com/mcp",
          auth: [{ id: "base44-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "basecamp",
    name: "Basecamp",
    tagline: "Projects, to-dos, and messages",
    description:
      "Basecamp lets agents read projects and message threads, add to-dos, and post updates with the access the signed-in user already has. Each user signs in to their own Basecamp account through the browser.",
    category: "productivity",
    creatorName: "37signals",
    version: "1.0.0",
    prompts: [
      { id: "prompt-catch-up", text: "Catch me up on the website redesign project this week." },
      { id: "prompt-overdue", text: "Which to-dos assigned to me are overdue?" },
      { id: "prompt-add-todo", text: "Add a to-do to review the launch checklist by Thursday." },
    ],
    websiteUrl: "https://basecamp.com",
    privacyPolicyUrl: "https://basecamp.com/about/policies/privacy",
    termsUrl: "https://basecamp.com/about/policies/terms",
    featured: false,
    apps: [
      {
        id: "app-basecamp-mcp",
        name: "Basecamp",
        description: "Project, to-do, and message tools, over Basecamp's MCP server with browser sign-in.",
        server: {
          name: "basecamp",
          transport: "http",
          url: "https://mcp.basecamp.com/mcp",
          auth: [{ id: "basecamp-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "beehiiv",
    name: "beehiiv",
    tagline: "Newsletter posts and subscribers",
    description:
      "beehiiv lets agents read posts, subscribers, and performance data, and draft posts in the publications of the signed-in account. Each user signs in to their own beehiiv account through the browser.",
    category: "productivity",
    creatorName: "beehiiv",
    version: "1.0.0",
    prompts: [
      { id: "prompt-top-posts", text: "Which of my last ten posts had the best open and click rates?" },
      { id: "prompt-growth", text: "How did my subscriber count change this month, and from which sources?" },
      { id: "prompt-draft-post", text: "Draft a post that announces our new pricing." },
    ],
    websiteUrl: "https://www.beehiiv.com",
    privacyPolicyUrl: "https://www.beehiiv.com/privacy",
    termsUrl: "https://www.beehiiv.com/tou",
    featured: false,
    apps: [
      {
        id: "app-beehiiv-mcp",
        name: "beehiiv",
        description: "Post, subscriber, and analytics tools, over beehiiv's MCP server with browser sign-in.",
        server: {
          name: "beehiiv",
          transport: "http",
          url: "https://mcp.beehiiv.com/mcp",
          auth: [{ id: "beehiiv-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "betterstack",
    name: "Better Stack",
    tagline: "Uptime, logs, and incidents",
    description:
      "Better Stack lets agents check monitors and incidents, query logs and metrics, and read on-call schedules in the signed-in team. Each user signs in to their own Better Stack account through the browser.",
    category: "coding",
    creatorName: "Better Stack",
    version: "1.0.0",
    prompts: [
      { id: "prompt-incidents", text: "Which incidents are open, and what caused them?" },
      { id: "prompt-errors", text: "Find the most frequent errors in the API logs in the last hour." },
      { id: "prompt-on-call", text: "Who is on call this weekend?" },
    ],
    websiteUrl: "https://betterstack.com",
    privacyPolicyUrl: "https://betterstack.com/privacy",
    termsUrl: "https://betterstack.com/terms",
    featured: false,
    apps: [
      {
        id: "app-betterstack-mcp",
        name: "Better Stack",
        description: "Monitor, incident, and log tools, over Better Stack's MCP server with browser sign-in.",
        server: {
          name: "betterstack",
          transport: "http",
          url: "https://mcp.betterstack.com",
          auth: [{ id: "betterstack-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "bird",
    name: "Bird",
    tagline: "Email, SMS, and WhatsApp APIs",
    description:
      "Bird lets agents send email, SMS, and WhatsApp messages, verify domains, manage numbers, and inspect message delivery in the workspace of the signed-in account. Each user signs in to their own Bird account through the browser.",
    category: "automation",
    creatorName: "Bird",
    version: "1.0.0",
    prompts: [
      { id: "prompt-delivery", text: "Why did the last password reset email to this address fail?" },
      { id: "prompt-domain", text: "Check the DNS records for our sending domain and tell me what is missing." },
      { id: "prompt-test-sms", text: "Send a test SMS to my own number with the new template." },
    ],
    websiteUrl: "https://bird.com",
    privacyPolicyUrl: "https://bird.com/legal/privacy",
    termsUrl: "https://bird.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-bird-mcp",
        name: "Bird",
        description: "Messaging, domain, number, and delivery tools, over Bird's MCP server with browser sign-in.",
        server: {
          name: "bird",
          transport: "http",
          url: "https://mcp.bird.com",
          auth: [{ id: "bird-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "blotato",
    name: "Blotato",
    tagline: "Social media publishing",
    description:
      "Blotato lets agents draft, schedule, and publish posts to the social accounts that the user connects in Blotato. Each user signs in to their own Blotato account through the browser.",
    category: "automation",
    creatorName: "Blotato",
    version: "1.0.0",
    prompts: [
      { id: "prompt-draft-thread", text: "Draft a LinkedIn post from this blog article." },
      { id: "prompt-schedule", text: "Schedule this post for Tuesday at 9:00 on my X account." },
      { id: "prompt-queue", text: "What posts are scheduled for this week?" },
    ],
    websiteUrl: "https://www.blotato.com",
    privacyPolicyUrl: "https://www.blotato.com/privacy-policy",
    termsUrl: "https://www.blotato.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-blotato-mcp",
        name: "Blotato",
        description: "Post drafting, scheduling, and publishing, over Blotato's MCP server with browser sign-in.",
        server: {
          name: "blotato",
          transport: "http",
          url: "https://mcp.blotato.com/mcp",
          auth: [{ id: "blotato-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "brex",
    name: "Brex",
    tagline: "Expenses, cards, and bills",
    description:
      "Brex lets agents look up expenses, users, cards, banking transactions, and bills in the account of the signed-in user. Each user signs in to their own Brex account through the browser.",
    category: "other",
    creatorName: "Brex",
    version: "1.0.0",
    prompts: [
      { id: "prompt-missing-receipts", text: "Which of my expenses this month are missing receipts?" },
      { id: "prompt-team-spend", text: "Summarize card spend by team for last quarter." },
      { id: "prompt-bills", text: "Which bills are due in the next two weeks?" },
    ],
    websiteUrl: "https://www.brex.com",
    privacyPolicyUrl: "https://www.brex.com/legal/privacy",
    termsUrl: "https://www.brex.com/legal/platform-agreement",
    featured: false,
    apps: [
      {
        id: "app-brex-mcp",
        name: "Brex",
        description: "Expense, card, transaction, and bill lookup, over Brex's MCP server with browser sign-in.",
        server: {
          name: "brex",
          transport: "http",
          url: "https://api.brex.com/mcp",
          auth: [{ id: "brex-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "brightdata",
    name: "Bright Data",
    tagline: "Web search and scraping",
    description:
      "Bright Data lets agents search the web, read pages as Markdown, and collect structured data from public sites through Bright Data's unblocking and browser infrastructure. Each user signs in to their own Bright Data account through the browser, and requests use that account's quota.",
    category: "research",
    creatorName: "Bright Data",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search", text: "Search the web for recent reviews of this product and summarize them." },
      { id: "prompt-scrape", text: "Read this page as Markdown and list the prices it shows." },
      {
        id: "prompt-compare",
        text: "Collect the public pricing pages of these three competitors and compare the plans.",
      },
    ],
    websiteUrl: "https://brightdata.com",
    privacyPolicyUrl: "https://brightdata.com/privacy",
    termsUrl: "https://brightdata.com/license",
    featured: false,
    apps: [
      {
        id: "app-brightdata-mcp",
        name: "Bright Data",
        description:
          "Web search, page scraping, and structured web data, over Bright Data's MCP server with browser sign-in.",
        server: {
          name: "brightdata",
          transport: "http",
          url: "https://mcp.brightdata.com/mcp",
          auth: [{ id: "brightdata-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "browserless",
    name: "Browserless",
    tagline: "Cloud browsers for agents",
    description:
      "Browserless lets agents open pages in a hosted browser, read their content, take screenshots, and make PDFs, also on sites that need JavaScript. Each user signs in to their own Browserless account through the browser.",
    category: "automation",
    creatorName: "Browserless",
    version: "1.0.0",
    prompts: [
      { id: "prompt-read-page", text: "Open this page in a browser and give me its main text." },
      { id: "prompt-screenshot", text: "Take a full-page screenshot of our pricing page." },
      { id: "prompt-pdf", text: "Make a PDF of this article." },
    ],
    websiteUrl: "https://www.browserless.io",
    privacyPolicyUrl: "https://www.browserless.io/privacy-policy",
    termsUrl: "https://www.browserless.io/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-browserless-mcp",
        name: "Browserless",
        description:
          "Hosted browser sessions, page content, screenshots, and PDFs, over Browserless' MCP server with browser sign-in.",
        server: {
          name: "browserless",
          transport: "http",
          url: "https://mcp.browserless.io/mcp",
          auth: [{ id: "browserless-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "buffer",
    name: "Buffer",
    tagline: "Social media scheduling",
    description:
      "Buffer lets agents read connected channels, the post queue, drafts and ideas, read post analytics, and draft, schedule or edit posts. Each user signs in to their own Buffer account through the browser.",
    category: "automation",
    creatorName: "Buffer",
    version: "1.0.0",
    prompts: [
      { id: "prompt-queue", text: "What is in my Buffer queue for this week?" },
      { id: "prompt-draft", text: "Draft a LinkedIn post about our new release and save it as a Buffer draft." },
      { id: "prompt-analytics", text: "Which of my posts from last month had the most engagement?" },
    ],
    websiteUrl: "https://buffer.com",
    privacyPolicyUrl: "https://buffer.com/legal#privacy-policy",
    termsUrl: "https://buffer.com/legal#terms",
    featured: false,
    apps: [
      {
        id: "app-buffer-mcp",
        name: "Buffer",
        description:
          "Channels, queue, drafts, ideas, and post analytics, over Buffer's MCP server with browser sign-in.",
        server: {
          name: "buffer",
          transport: "http",
          url: "https://mcp.buffer.com/mcp",
          auth: [{ id: "buffer-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "buildkite",
    name: "Buildkite",
    tagline: "CI pipelines and builds",
    description:
      "Buildkite lets agents read pipelines, builds, jobs, logs and test results, and find why a build failed, in the organizations of the signed-in account. Each user signs in to their own Buildkite account through the browser.",
    category: "coding",
    creatorName: "Buildkite",
    version: "1.0.0",
    prompts: [
      { id: "prompt-failed-build", text: "Why did the latest build on main fail?" },
      { id: "prompt-flaky", text: "Which tests failed most often in the last week of builds?" },
      { id: "prompt-status", text: "Show the status of the open builds for this branch." },
    ],
    websiteUrl: "https://buildkite.com",
    privacyPolicyUrl: "https://buildkite.com/about/legal/privacy-policy/",
    termsUrl: "https://buildkite.com/about/legal/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-buildkite-mcp",
        name: "Buildkite",
        description: "Pipelines, builds, job logs, and test results, over Buildkite's MCP server with browser sign-in.",
        server: {
          name: "buildkite",
          transport: "http",
          url: "https://mcp.buildkite.com/mcp",
          auth: [{ id: "buildkite-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "calendly",
    name: "Calendly",
    tagline: "Scheduling and availability",
    description:
      "Calendly lets agents check availability, look up scheduled events and invitees, and manage event types and booking links. Each user signs in to their own Calendly account through the browser.",
    category: "productivity",
    creatorName: "Calendly",
    version: "1.0.0",
    prompts: [
      { id: "prompt-week", text: "Which Calendly meetings do I have this week?" },
      { id: "prompt-availability", text: "When am I free for a 30-minute meeting on Thursday?" },
      { id: "prompt-link", text: "Give me the booking link for my intro call event type." },
    ],
    websiteUrl: "https://calendly.com",
    privacyPolicyUrl: "https://calendly.com/legal/privacy-notice",
    termsUrl: "https://calendly.com/legal/customer-terms-conditions",
    featured: false,
    apps: [
      {
        id: "app-calendly-mcp",
        name: "Calendly",
        description:
          "Availability, scheduled events, and booking links, over Calendly's MCP server with browser sign-in.",
        server: {
          name: "calendly",
          transport: "http",
          url: "https://mcp.calendly.com",
          auth: [{ id: "calendly-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "cartesia",
    name: "Cartesia",
    tagline: "Speech and voices",
    description:
      "Cartesia lets agents turn text into speech, transcribe audio, and list, clone and localize voices. Each user signs in to their own Cartesia account through the browser, and each generation uses credits of that account.",
    category: "design",
    creatorName: "Cartesia",
    version: "1.0.0",
    prompts: [
      { id: "prompt-speech", text: "Read this paragraph aloud with a warm Cartesia voice and give me the audio." },
      { id: "prompt-voices", text: "List the Cartesia voices that speak German." },
      { id: "prompt-transcribe", text: "Transcribe this audio file." },
    ],
    websiteUrl: "https://www.cartesia.ai",
    privacyPolicyUrl: "https://www.cartesia.ai/legal/privacy",
    termsUrl: "https://www.cartesia.ai/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-cartesia-mcp",
        name: "Cartesia",
        description:
          "Text to speech, transcription, and voice management, over Cartesia's MCP server with browser sign-in.",
        server: {
          name: "cartesia",
          transport: "http",
          url: "https://mcp.cartesia.ai/mcp",
          auth: [{ id: "cartesia-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "circleback",
    name: "Circleback",
    tagline: "Meeting notes and transcripts",
    description:
      "Circleback lets agents search meetings, read notes, transcripts and action items, and look up the people and companies in them. Each user signs in to their own Circleback account through the browser.",
    category: "productivity",
    creatorName: "Circleback",
    version: "1.0.0",
    prompts: [
      { id: "prompt-last-meeting", text: "Summarize my last meeting with Acme and its action items." },
      { id: "prompt-mentions", text: "Find where pricing came up in this month's meeting transcripts." },
      { id: "prompt-open-items", text: "Which action items assigned to me are still open?" },
    ],
    websiteUrl: "https://circleback.ai",
    privacyPolicyUrl: "https://circleback.ai/privacy",
    termsUrl: "https://circleback.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-circleback-mcp",
        name: "Circleback",
        description:
          "Meetings, notes, transcripts, and action items, over Circleback's MCP server with browser sign-in.",
        server: {
          name: "circleback",
          transport: "http",
          url: "https://circleback.ai/api/mcp",
          auth: [{ id: "circleback-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "clarify",
    name: "Clarify",
    tagline: "Industrial data and signals",
    description:
      "Clarify lets agents read signals, time series and events from the industrial data of the signed-in Clarify organization. Each user signs in to their own Clarify account through the browser.",
    category: "data-analytics",
    creatorName: "Searis",
    version: "1.0.0",
    prompts: [
      { id: "prompt-trend", text: "How did the temperature signals at this site change over the last 24 hours?" },
      { id: "prompt-anomalies", text: "Which signals moved outside their normal range this week?" },
      { id: "prompt-find", text: "Find the signals that measure pump pressure." },
    ],
    websiteUrl: "https://www.clarify.io",
    privacyPolicyUrl: "https://www.clarify.io/legals/privacy-policy-2021-06-30",
    termsUrl: "https://www.clarify.io/legals/terms-of-service-280421",
    featured: false,
    apps: [
      {
        id: "app-clarify-mcp",
        name: "Clarify",
        description: "Industrial signals, time series, and events, over Clarify's MCP server with browser sign-in.",
        server: {
          name: "clarify",
          transport: "http",
          url: "https://mcp.clarify.io/mcp",
          auth: [{ id: "clarify-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "clerk",
    name: "Clerk",
    tagline: "Authentication and users",
    description:
      "Clerk lets agents create and configure Clerk applications, view authentication settings, manage users, and check the DNS records of production instances. Each user signs in to their own Clerk account through the browser.",
    category: "coding",
    creatorName: "Clerk",
    version: "1.0.0",
    prompts: [
      { id: "prompt-apps", text: "List my Clerk applications and their instances." },
      { id: "prompt-signups", text: "Who signed up to my development instance this week?" },
      { id: "prompt-dns", text: "Which DNS records does my production instance still need?" },
    ],
    websiteUrl: "https://clerk.com",
    privacyPolicyUrl: "https://clerk.com/legal/privacy",
    termsUrl: "https://clerk.com/legal/standard-terms",
    featured: false,
    apps: [
      {
        id: "app-clerk-mcp",
        name: "Clerk",
        description: "Applications, authentication settings, and users, over Clerk's MCP server with browser sign-in.",
        server: {
          name: "clerk",
          transport: "http",
          url: "https://mcp.clerk.com/mcp",
          auth: [{ id: "clerk-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "clickhouse",
    name: "ClickHouse Cloud",
    tagline: "Read-only ClickHouse Cloud queries",
    description:
      "ClickHouse Cloud lets agents list services, databases and tables, run read-only SELECT queries, and read backups, ClickPipes and costs. Each user signs in to their own ClickHouse Cloud account through the browser, and the remote MCP server must be turned on for each service.",
    category: "data-analytics",
    creatorName: "ClickHouse",
    version: "1.0.0",
    prompts: [
      { id: "prompt-tables", text: "Which tables are in the analytics database of my production service?" },
      { id: "prompt-query", text: "How many events per day did we store last week?" },
      { id: "prompt-cost", text: "What did my ClickHouse Cloud organization cost last month?" },
    ],
    websiteUrl: "https://clickhouse.com",
    privacyPolicyUrl: "https://clickhouse.com/legal/privacy-policy",
    termsUrl: "https://clickhouse.com/legal/agreements/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-clickhouse-mcp",
        name: "ClickHouse Cloud",
        description:
          "Services, schemas, read-only queries, and costs, over ClickHouse Cloud's MCP server with browser sign-in.",
        server: {
          name: "clickhouse",
          transport: "http",
          url: "https://mcp.clickhouse.cloud/mcp",
          auth: [{ id: "clickhouse-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "close",
    name: "Close",
    tagline: "Sales CRM",
    description:
      "Close lets agents search leads, contacts and opportunities, read activity history, and log notes and tasks. Each user signs in to their own Close account through the browser, and the user chooses the access scopes at sign-in.",
    category: "productivity",
    creatorName: "Close",
    version: "1.0.0",
    prompts: [
      { id: "prompt-stale", text: "Which open opportunities had no activity in the last two weeks?" },
      { id: "prompt-lead", text: "Summarize the history of the Acme lead." },
      { id: "prompt-note", text: "Log a note on this lead with the points from today's call." },
    ],
    websiteUrl: "https://close.com",
    privacyPolicyUrl: "https://close.com/privacy",
    termsUrl: "https://close.com/tos",
    featured: false,
    apps: [
      {
        id: "app-close-mcp",
        name: "Close",
        description: "Leads, contacts, opportunities, and activities, over Close's MCP server with browser sign-in.",
        server: {
          name: "close",
          transport: "http",
          url: "https://mcp.close.com/mcp",
          auth: [{ id: "close-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "cloudinary",
    name: "Cloudinary",
    tagline: "Image and video assets",
    description:
      "Cloudinary lets agents search, upload, tag and organize images, videos and files, and build transformation URLs. Each user signs in to their own Cloudinary account through the browser.",
    category: "design",
    creatorName: "Cloudinary",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find", text: "Find the product images tagged summer in my Cloudinary account." },
      { id: "prompt-upload", text: "Upload this image to the marketing folder." },
      { id: "prompt-resize", text: "Give me a URL for this image resized to 800 pixels wide." },
    ],
    websiteUrl: "https://cloudinary.com",
    privacyPolicyUrl: "https://cloudinary.com/privacy",
    termsUrl: "https://cloudinary.com/tou",
    featured: false,
    apps: [
      {
        id: "app-cloudinary-mcp",
        name: "Cloudinary",
        description: "Asset search, upload, tagging, and folders, over Cloudinary's MCP server with browser sign-in.",
        server: {
          name: "cloudinary",
          transport: "http",
          url: "https://asset-management.mcp.cloudinary.com/mcp",
          auth: [{ id: "cloudinary-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "coda",
    name: "Coda",
    tagline: "Docs, pages and tables",
    description:
      "Coda lets agents read and write docs, pages and tables in the workspace of the signed-in account. Each user signs in to their own Coda account through the browser.",
    category: "documents",
    creatorName: "Superhuman",
    version: "1.0.0",
    prompts: [
      { id: "prompt-summary", text: "Summarize the project plan doc in Coda." },
      { id: "prompt-table", text: "Which rows in the launch tracker table are still open?" },
      { id: "prompt-page", text: "Draft a new page in this doc with the notes from today's meeting." },
    ],
    websiteUrl: "https://coda.io",
    privacyPolicyUrl: "https://superhuman.com/legal/privacy-policy",
    termsUrl: "https://superhuman.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-coda-mcp",
        name: "Coda",
        description: "Docs, pages, and tables, over Coda's MCP server with browser sign-in.",
        server: {
          name: "coda",
          transport: "http",
          url: "https://coda.io/apis/mcp",
          auth: [{ id: "coda-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "coingecko",
    name: "CoinGecko",
    tagline: "Crypto market data",
    description:
      "CoinGecko lets agents read current and historical crypto prices, market capitalization, trading volume, and token data from the CoinGecko API. The public server needs no account and no key.",
    category: "data-analytics",
    creatorName: "CoinGecko",
    version: "1.0.0",
    prompts: [
      { id: "prompt-price", text: "What are the current prices of Bitcoin and Ethereum in EUR?" },
      { id: "prompt-top-movers", text: "Which of the top 100 coins moved the most in the last 24 hours?" },
      { id: "prompt-history", text: "Show the daily closing price of Solana for the last 30 days." },
    ],
    websiteUrl: "https://www.coingecko.com",
    privacyPolicyUrl: "https://www.coingecko.com/en/privacy",
    termsUrl: "https://www.coingecko.com/en/terms",
    featured: false,
    apps: [
      {
        id: "app-coingecko-mcp",
        name: "CoinGecko",
        description: "Crypto prices and market data, over the CoinGecko MCP server with no sign-in.",
        server: { name: "coingecko", transport: "http", url: "https://mcp.api.coingecko.com/mcp" },
      },
    ],
  },
  {
    slug: "convex",
    name: "Convex",
    tagline: "Convex app setup guidance",
    description:
      "Convex gives agents the Convex runbook for starting a new app or adding Convex to an existing project, plus guidance on indexes, pagination, and scaling. These guidance tools need no account and no key.",
    category: "coding",
    creatorName: "Convex",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-app", text: "Start a new Convex app for a shared to-do list with sign-in." },
      { id: "prompt-add-convex", text: "Add Convex as the backend of this existing React project." },
      {
        id: "prompt-scaling",
        text: "How should I index and paginate a messages table that grows to millions of rows?",
      },
    ],
    websiteUrl: "https://www.convex.dev",
    privacyPolicyUrl: "https://www.convex.dev/legal/privacy",
    termsUrl: "https://www.convex.dev/legal/tos",
    featured: false,
    apps: [
      {
        id: "app-convex-mcp",
        name: "Convex",
        description: "Convex app setup and scaling guidance, over the Convex MCP server with no sign-in.",
        server: { name: "convex", transport: "http", url: "https://mcp.convex.dev/mcp" },
      },
    ],
  },
  {
    slug: "craft",
    name: "Craft",
    tagline: "Notes, docs and tasks",
    description:
      "Craft lets agents read, search and update documents and tasks in the Craft space that the user approves. Each user signs in to their own Craft account through the browser.",
    category: "documents",
    creatorName: "Craft Docs",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search", text: "Find my Craft notes about the Q3 roadmap." },
      { id: "prompt-summary", text: "Summarize this week's daily notes." },
      { id: "prompt-tasks", text: "Add these action items as tasks in Craft." },
    ],
    websiteUrl: "https://www.craft.do",
    privacyPolicyUrl: "https://www.craft.do/privacy",
    termsUrl: "https://www.craft.do/terms",
    featured: false,
    apps: [
      {
        id: "app-craft-mcp",
        name: "Craft",
        description: "Documents, search, and tasks, over Craft's MCP server with browser sign-in.",
        server: {
          name: "craft",
          transport: "http",
          url: "https://mcp.craft.do/my/mcp",
          auth: [{ id: "craft-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "crustdata",
    name: "Crustdata",
    tagline: "Company and people data",
    description:
      "Crustdata lets agents search and enrich companies and people, search job listings, and track social posts. Each user signs in to their own Crustdata account through the browser, and each request uses credits of that account.",
    category: "research",
    creatorName: "Crustdata",
    version: "1.0.0",
    prompts: [
      { id: "prompt-companies", text: "Find Series A fintech companies in Berlin with 50 to 200 employees." },
      { id: "prompt-profile", text: "Give me a profile of this company: headcount, funding, and recent hires." },
      { id: "prompt-jobs", text: "Which engineering roles is this company hiring for now?" },
    ],
    websiteUrl: "https://crustdata.com",
    privacyPolicyUrl: "https://crustdata.com/privacy",
    termsUrl: "https://crustdata.com/terms",
    featured: false,
    apps: [
      {
        id: "app-crustdata-mcp",
        name: "Crustdata",
        description:
          "Company and people search, enrichment, jobs, and posts, over Crustdata's MCP server with browser sign-in.",
        server: {
          name: "crustdata",
          transport: "http",
          url: "https://mcp.crustdata.com/mcp",
          auth: [{ id: "crustdata-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "customerio",
    name: "Customer.io",
    tagline: "Customer messaging data",
    description:
      "Customer.io lets agents read people, segments, campaigns, broadcasts and message metrics in the workspaces the user chooses. Each user signs in to their own Customer.io account through the browser, and an admin must turn on MCP for the account first.",
    category: "automation",
    creatorName: "Customer.io",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaigns", text: "How did my active Customer.io campaigns perform last month?" },
      { id: "prompt-segment", text: "How many people are in the trial users segment?" },
      { id: "prompt-person", text: "Show the profile and recent messages of this customer." },
    ],
    websiteUrl: "https://customer.io",
    privacyPolicyUrl: "https://customer.io/legal/privacy-policy",
    termsUrl: "https://customer.io/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-customerio-mcp",
        name: "Customer.io",
        description:
          "People, segments, campaigns, and message metrics, over Customer.io's MCP server with browser sign-in.",
        server: {
          name: "customerio",
          transport: "http",
          url: "https://mcp.customer.io/mcp",
          auth: [{ id: "customerio-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "dart",
    name: "Dart",
    tagline: "Tasks and project docs",
    description:
      "Dart lets agents read, create and update tasks, projects and docs in the workspace of the signed-in account. Each user signs in to their own Dart account through the browser.",
    category: "productivity",
    creatorName: "Dart",
    version: "1.0.0",
    prompts: [
      { id: "prompt-mine", text: "Which Dart tasks are assigned to me this week?" },
      { id: "prompt-create", text: "Create Dart tasks for each step of this plan." },
      { id: "prompt-doc", text: "Summarize the project brief doc in Dart." },
    ],
    websiteUrl: "https://www.dartai.com",
    privacyPolicyUrl: "https://app.dartai.com/legal/privacy-policy",
    termsUrl: "https://app.dartai.com/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-dart-mcp",
        name: "Dart",
        description: "Tasks, projects, and docs, over Dart's MCP server with browser sign-in.",
        server: {
          name: "dart",
          transport: "http",
          url: "https://mcp.dartai.com/mcp",
          auth: [{ id: "dart-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "datadog",
    name: "Datadog",
    tagline: "Monitoring, logs and traces",
    description:
      "Datadog lets agents search logs, metrics, traces, monitors, dashboards and incidents in the organization of the signed-in account. Each user signs in to their own Datadog account on the US1 site through the browser.",
    category: "coding",
    creatorName: "Datadog",
    version: "1.0.0",
    prompts: [
      { id: "prompt-errors", text: "Which services had the most errors in the last hour?" },
      { id: "prompt-monitor", text: "Why is the checkout latency monitor alerting?" },
      { id: "prompt-incident", text: "Summarize the open incidents and their status." },
    ],
    websiteUrl: "https://www.datadoghq.com",
    privacyPolicyUrl: "https://www.datadoghq.com/legal/privacy/",
    termsUrl: "https://www.datadoghq.com/legal/terms/",
    featured: false,
    apps: [
      {
        id: "app-datadog-mcp",
        name: "Datadog",
        description: "Logs, metrics, traces, monitors, and incidents, over Datadog's MCP server with browser sign-in.",
        server: {
          name: "datadog",
          transport: "http",
          url: "https://mcp.datadoghq.com/v1/mcp",
          auth: [{ id: "datadog-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "dataforseo",
    name: "DataForSEO",
    tagline: "SEO and search data",
    description:
      "DataForSEO lets agents read search results, keyword volumes, backlinks, rankings and on-page data. Each user signs in to their own DataForSEO account through the browser, and each request is paid from that account's balance.",
    category: "research",
    creatorName: "DataForSEO",
    version: "1.0.0",
    prompts: [
      { id: "prompt-keywords", text: "What is the monthly search volume for these keywords in the US?" },
      { id: "prompt-serp", text: "Who ranks in the top ten on Google for this query?" },
      { id: "prompt-backlinks", text: "Summarize the backlink profile of this domain." },
    ],
    websiteUrl: "https://dataforseo.com",
    privacyPolicyUrl: "https://dataforseo.com/privacy-policy/",
    termsUrl: "https://dataforseo.com/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-dataforseo-mcp",
        name: "DataForSEO",
        description:
          "Search results, keywords, backlinks, and rankings, over DataForSEO's MCP server with browser sign-in.",
        server: {
          name: "dataforseo",
          transport: "http",
          url: "https://mcp.dataforseo.com/mcp",
          auth: [{ id: "dataforseo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "dealroom",
    name: "Dealroom",
    tagline: "Startup and investor data",
    description:
      "Dealroom lets agents search companies, investors, funding rounds and founders, and analyze investors and co-investors. Each user signs in to their own Dealroom account through the browser, and MCP access needs a Dealroom Premium seat.",
    category: "research",
    creatorName: "Dealroom.co",
    version: "1.0.0",
    prompts: [
      { id: "prompt-rounds", text: "Which climate tech startups in Europe raised a Series A this quarter?" },
      { id: "prompt-investor", text: "Which companies did this investor back in the last two years?" },
      { id: "prompt-company", text: "Give me a profile of this startup: funding, investors, and headcount." },
    ],
    websiteUrl: "https://dealroom.co",
    privacyPolicyUrl: "https://dealroom.co/privacy-policy",
    termsUrl: "https://dealroom.co/terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-dealroom-mcp",
        name: "Dealroom",
        description:
          "Companies, investors, funding rounds, and founders, over Dealroom's MCP server with browser sign-in.",
        server: {
          name: "dealroom",
          transport: "http",
          url: "https://mcp.dealroom.co/mcp",
          auth: [{ id: "dealroom-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "deepledger",
    name: "DeepLedger",
    tagline: "Bookkeeping for QuickBooks and Xero",
    description:
      "DeepLedger lets agents read and record transactions, reports, receivables and payables in QuickBooks Online, Xero and Bill.com, and help with reconciliation and month-end close. Each user signs in to their own DeepLedger account through the browser.",
    category: "other",
    creatorName: "DeepLedger",
    version: "1.0.0",
    prompts: [
      { id: "prompt-pnl", text: "Show the profit and loss report for last month." },
      { id: "prompt-uncategorized", text: "Which bank transactions are still uncategorized?" },
      { id: "prompt-receivables", text: "Which invoices are more than 30 days overdue?" },
    ],
    websiteUrl: "https://deepledger.ai",
    privacyPolicyUrl: "https://deepledger.ai/privacy",
    termsUrl: "https://deepledger.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-deepledger-mcp",
        name: "DeepLedger",
        description: "Bookkeeping, reports, and month-end close, over DeepLedger's MCP server with browser sign-in.",
        server: {
          name: "deepledger",
          transport: "http",
          url: "https://mcp.deepledger.ai/mcp",
          auth: [{ id: "deepledger-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "deepwiki",
    name: "DeepWiki",
    tagline: "Docs for public GitHub repos",
    description:
      "DeepWiki lets agents read generated documentation for public GitHub repositories and ask questions about their code. It needs no account and no key.",
    category: "coding",
    creatorName: "Cognition",
    version: "1.0.0",
    prompts: [
      { id: "prompt-architecture", text: "Explain the architecture of the facebook/react repository." },
      { id: "prompt-where-defined", text: "In vercel/next.js, where is the router cache implemented?" },
      { id: "prompt-topics", text: "List the documentation topics for the tokio-rs/tokio repository." },
    ],
    websiteUrl: "https://deepwiki.com",
    privacyPolicyUrl: "https://cognition.ai/legal/privacy-policy",
    termsUrl: "https://cognition.ai/legal/platform-terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-deepwiki-mcp",
        name: "DeepWiki",
        description: "Repository documentation and code questions, over the DeepWiki MCP server with no sign-in.",
        server: { name: "deepwiki", transport: "http", url: "https://mcp.deepwiki.com/mcp" },
      },
    ],
  },
  {
    slug: "dida365",
    name: "DIDA",
    tagline: "Tasks and lists",
    description:
      "DIDA (滴答清单) lets agents read, add and update tasks and lists. Each user signs in to their own DIDA account through the browser.",
    category: "productivity",
    creatorName: "Hangzhou Suishouji Network Technology",
    version: "1.0.0",
    prompts: [
      { id: "prompt-today", text: "Which DIDA tasks are due today?" },
      { id: "prompt-capture", text: "Add these action items to my DIDA Inbox." },
      { id: "prompt-week", text: "Which DIDA tasks did I complete last week?" },
    ],
    websiteUrl: "https://dida365.com",
    privacyPolicyUrl: "https://dida365.com/about/privacy",
    termsUrl: "https://dida365.com/about/tos",
    featured: false,
    apps: [
      {
        id: "app-dida365-mcp",
        name: "DIDA",
        description: "Tasks and lists, over DIDA's MCP server with browser sign-in.",
        server: {
          name: "dida365",
          transport: "http",
          url: "https://mcp.dida365.com",
          auth: [{ id: "dida365-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "digitalocean",
    name: "DigitalOcean",
    tagline: "Cloud resources and apps",
    description:
      "DigitalOcean lets agents find and run tools for App Platform, Droplets, databases, Kubernetes, Spaces and networking through one router address. Each user signs in to their own DigitalOcean account through the browser.",
    category: "coding",
    creatorName: "DigitalOcean",
    version: "1.0.0",
    prompts: [
      { id: "prompt-droplets", text: "List my Droplets and their regions and sizes." },
      { id: "prompt-deploy", text: "Why did the last deployment of my App Platform app fail?" },
      { id: "prompt-databases", text: "Which managed databases do I have, and what plan does each use?" },
    ],
    websiteUrl: "https://www.digitalocean.com",
    privacyPolicyUrl: "https://www.digitalocean.com/legal/privacy-policy",
    termsUrl: "https://www.digitalocean.com/legal/terms-of-service-agreement",
    featured: false,
    apps: [
      {
        id: "app-digitalocean-mcp",
        name: "DigitalOcean",
        description:
          "Apps, Droplets, databases, and other cloud resources, over DigitalOcean's MCP server with browser sign-in.",
        server: {
          name: "digitalocean",
          transport: "http",
          url: "https://mcp.digitalocean.com/mcp",
          auth: [{ id: "digitalocean-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "dropbox",
    name: "Dropbox",
    tagline: "Files and folders",
    description:
      "Dropbox lets agents list, search, read and upload files and folders, and create share links. Each user signs in to their own Dropbox account through the browser.",
    category: "documents",
    creatorName: "Dropbox",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find", text: "Find the latest version of the Q3 report in my Dropbox." },
      { id: "prompt-summary", text: "Summarize the PDFs in my Contracts folder." },
      { id: "prompt-save", text: "Save this draft to my Dropbox Drafts folder." },
    ],
    websiteUrl: "https://www.dropbox.com",
    privacyPolicyUrl: "https://www.dropbox.com/privacy",
    termsUrl: "https://www.dropbox.com/terms",
    featured: false,
    apps: [
      {
        id: "app-dropbox-mcp",
        name: "Dropbox",
        description: "File search, reading, upload, and sharing, over Dropbox's MCP server with browser sign-in.",
        server: {
          name: "dropbox",
          transport: "http",
          url: "https://mcp.dropbox.com/mcp",
          auth: [{ id: "dropbox-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "eden",
    name: "Eden",
    tagline: "Creator content and posts",
    description:
      "Eden lets agents research social posts, read cross-platform analytics, and draft and schedule posts, which wait for the user's approval. Each user signs in to their own Eden account through the browser.",
    category: "productivity",
    creatorName: "Eden",
    version: "1.0.0",
    prompts: [
      { id: "prompt-trends", text: "Which posts in my niche performed best this week?" },
      { id: "prompt-analytics", text: "How did my posts perform across platforms last month?" },
      { id: "prompt-draft", text: "Draft three post ideas from this article and save them in Eden." },
    ],
    websiteUrl: "https://eden.so",
    privacyPolicyUrl: "https://eden.so/privacy/",
    termsUrl: "https://eden.so/terms/",
    featured: false,
    apps: [
      {
        id: "app-eden-mcp",
        name: "Eden",
        description: "Post research, analytics, drafts, and scheduling, over Eden's MCP server with browser sign-in.",
        server: {
          name: "eden",
          transport: "http",
          url: "https://mcp.eden.so/mcp",
          auth: [{ id: "eden-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "era",
    name: "Era",
    tagline: "Personal finance",
    description:
      "Era lets agents read the accounts, transactions and insights of the bank accounts that the user connects to Era. Each user signs in to their own Era account through the browser.",
    category: "productivity",
    creatorName: "Era",
    version: "1.0.0",
    prompts: [
      { id: "prompt-spending", text: "How much did I spend on restaurants last month?" },
      { id: "prompt-subscriptions", text: "Which recurring subscriptions am I paying for?" },
      { id: "prompt-balances", text: "Summarize my account balances." },
    ],
    websiteUrl: "https://era.app",
    privacyPolicyUrl: "https://era.app/privacy",
    termsUrl: "https://era.app/terms",
    featured: false,
    apps: [
      {
        id: "app-era-mcp",
        name: "Era",
        description: "Accounts, transactions, and insights, over Era's MCP server with browser sign-in.",
        server: {
          name: "era",
          transport: "http",
          url: "https://context.era.app/mcp",
          auth: [{ id: "era-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "etoro",
    name: "eToro",
    tagline: "Portfolio and market data",
    description:
      "eToro lets agents read the user's portfolio, positions and market data through the eToro Public API, and look up the API's routes. Each user signs in to their own eToro account through the browser, and the server can also call API routes that change the account, such as orders.",
    category: "data-analytics",
    creatorName: "eToro",
    version: "1.0.0",
    prompts: [
      { id: "prompt-portfolio", text: "Summarize my eToro portfolio and how it moved today." },
      { id: "prompt-copied", text: "Which traders do I copy, and how are they doing?" },
      { id: "prompt-routes", text: "Which eToro Public API routes return market data?" },
    ],
    websiteUrl: "https://www.etoro.com",
    privacyPolicyUrl: "https://www.etoro.com/customer-service/privacy/",
    termsUrl: "https://www.etoro.com/customer-service/terms-conditions/",
    featured: false,
    apps: [
      {
        id: "app-etoro-mcp",
        name: "eToro",
        description: "Portfolio, positions, and Public API routes, over eToro's MCP server with browser sign-in.",
        server: {
          name: "etoro",
          transport: "http",
          url: "https://mcp.public-api.etoro.com/mcp",
          auth: [{ id: "etoro-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "evernote",
    name: "Evernote",
    tagline: "Notes and notebooks",
    description:
      "Evernote lets agents read, search and create notes. Each user signs in to their own Evernote account through the browser.",
    category: "documents",
    creatorName: "Evernote",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search", text: "Find my Evernote notes about the kitchen renovation." },
      { id: "prompt-summary", text: "Summarize the notes I saved last week." },
      { id: "prompt-create", text: "Create an Evernote note with these meeting notes." },
    ],
    websiteUrl: "https://evernote.com",
    privacyPolicyUrl: "https://evernote.com/privacy/policy",
    termsUrl: "https://evernote.com/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-evernote-mcp",
        name: "Evernote",
        description: "Note search, reading, and creation, over Evernote's MCP server with browser sign-in.",
        server: {
          name: "evernote",
          transport: "http",
          url: "https://mcp.evernote.com/mcp",
          auth: [{ id: "evernote-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "exa",
    name: "Exa",
    tagline: "Web search for agents",
    description: "Exa lets agents search the web and read pages as clean text. It needs no account and no key.",
    category: "research",
    creatorName: "Exa",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-papers", text: "Find recent papers on retrieval-augmented generation evaluation." },
      { id: "prompt-company-research", text: "Find the official documentation pages for the Stripe Billing API." },
      { id: "prompt-read-page", text: "Read this blog post and list its key points." },
    ],
    websiteUrl: "https://exa.ai",
    privacyPolicyUrl: "https://exa.ai/privacy-policy",
    termsUrl: "https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf",
    featured: false,
    apps: [
      {
        id: "app-exa-mcp",
        name: "Exa",
        description: "Web search and page reading, over the Exa MCP server with no sign-in.",
        server: { name: "exa", transport: "http", url: "https://mcp.exa.ai/mcp" },
      },
    ],
  },
  {
    slug: "excalidraw",
    name: "Excalidraw",
    tagline: "Hand-drawn diagrams",
    description:
      "Excalidraw lets agents draw hand-drawn style diagrams in the chat and export them to excalidraw.com as a shareable link. It needs no account and no key.",
    category: "design",
    creatorName: "Excalidraw",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-architecture",
        text: "Draw a diagram of a web app with a load balancer, two API servers, and a database.",
      },
      { id: "prompt-flow", text: "Sketch the sign-up flow from landing page to first login." },
      { id: "prompt-export", text: "Export this diagram to Excalidraw and give me the link." },
    ],
    websiteUrl: "https://excalidraw.com",
    privacyPolicyUrl: "https://plus.excalidraw.com/privacy-policy",
    termsUrl: "https://plus.excalidraw.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-excalidraw-mcp",
        name: "Excalidraw",
        description: "Diagram drawing and export, over the Excalidraw MCP server with no sign-in.",
        server: { name: "excalidraw", transport: "http", url: "https://mcp.excalidraw.com/mcp" },
      },
    ],
  },
  {
    slug: "extend",
    name: "Extend",
    tagline: "Virtual cards and spend",
    description:
      "Extend lets agents look up virtual cards, card transactions, and receipts in the signed-in Extend account. Each user signs in to their own Extend account through the browser.",
    category: "other",
    creatorName: "Extend",
    version: "1.0.0",
    prompts: [
      { id: "prompt-card-spend", text: "Which virtual cards had the most spend this month?" },
      { id: "prompt-missing-receipts", text: "List the transactions from last week that have no receipt." },
      { id: "prompt-card-summary", text: "Summarize the limits and remaining balance of my active virtual cards." },
    ],
    websiteUrl: "https://www.paywithextend.com",
    privacyPolicyUrl: "https://paywithextend.com/privacy",
    termsUrl: "https://paywithextend.com/terms",
    featured: false,
    apps: [
      {
        id: "app-extend-mcp",
        name: "Extend",
        description: "Virtual card, transaction, and receipt lookups, over Extend's MCP server with browser sign-in.",
        server: {
          name: "extend",
          transport: "http",
          url: "https://mcp.paywithextend.com/mcp",
          auth: [{ id: "extend-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fal",
    name: "fal",
    tagline: "Generative media models",
    description:
      "fal lets agents find image, video, and audio generation models and run them with the signed-in fal account. Each user signs in to their own fal account through the browser.",
    category: "design",
    creatorName: "fal",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-model", text: "Which fal models can turn a product photo into a short video?" },
      {
        id: "prompt-generate-image",
        text: "Generate a square image of a lighthouse at dawn in a flat illustration style.",
      },
      { id: "prompt-model-inputs", text: "What inputs and options does the FLUX image model take on fal?" },
    ],
    websiteUrl: "https://fal.ai",
    privacyPolicyUrl: "https://fal.ai/legal/privacy-policy",
    termsUrl: "https://fal.ai/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-fal-mcp",
        name: "fal",
        description: "Model search and image, video, and audio generation, over fal's MCP server with browser sign-in.",
        server: {
          name: "fal",
          transport: "http",
          url: "https://mcp.fal.ai/mcp-relay",
          auth: [{ id: "fal-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fanvue",
    name: "Fanvue",
    tagline: "Creator account insights",
    description:
      "Fanvue lets agents read earnings, subscribers, messages, and posts in the signed-in Fanvue creator account. Each user signs in to their own Fanvue account through the browser.",
    category: "other",
    creatorName: "Fanvue",
    version: "1.0.0",
    prompts: [
      { id: "prompt-earnings", text: "How did my earnings this month compare with last month?" },
      { id: "prompt-unread", text: "Which subscriber messages are still waiting for a reply?" },
      { id: "prompt-draft-post", text: "Draft a caption for a post that announces my new weekly schedule." },
    ],
    websiteUrl: "https://www.fanvue.com",
    privacyPolicyUrl: "https://legal.fanvue.com/privacy-policy",
    termsUrl: "https://legal.fanvue.com/terms-conditions",
    featured: false,
    apps: [
      {
        id: "app-fanvue-mcp",
        name: "Fanvue",
        description: "Earnings, subscriber, message, and post access, over Fanvue's MCP server with browser sign-in.",
        server: {
          name: "fanvue",
          transport: "http",
          url: "https://mcp.fanvue.com/mcp",
          auth: [{ id: "fanvue-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fastmail",
    name: "Fastmail",
    tagline: "Mail, calendar, and contacts",
    description:
      "Fastmail lets agents search and read email, check calendars, and look up contacts in the signed-in Fastmail account. Each user signs in through the browser and chooses which access to give, sending included.",
    category: "productivity",
    creatorName: "Fastmail",
    version: "1.0.0",
    prompts: [
      { id: "prompt-inbox-summary", text: "Summarize the unread email in my inbox from today." },
      { id: "prompt-calendar", text: "What is on my calendar for tomorrow?" },
      { id: "prompt-draft-reply", text: "Draft a reply to the latest email from my landlord." },
    ],
    websiteUrl: "https://www.fastmail.com",
    privacyPolicyUrl: "https://www.fastmail.com/policies/privacy/",
    termsUrl: "https://www.fastmail.com/policies/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-fastmail-mcp",
        name: "Fastmail",
        description: "Mail, calendar, and contacts access, over Fastmail's MCP server with browser sign-in.",
        server: {
          name: "fastmail",
          transport: "http",
          url: "https://api.fastmail.com/mcp",
          auth: [{ id: "fastmail-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fathom",
    name: "Fathom",
    tagline: "Meeting notes and transcripts",
    description:
      "Fathom lets agents search recorded meetings and read their summaries, transcripts, and action items in the signed-in Fathom account. Each user signs in to their own Fathom account through the browser.",
    category: "productivity",
    creatorName: "Fathom",
    version: "1.0.0",
    prompts: [
      { id: "prompt-last-call", text: "Summarize my last customer call and list the action items." },
      { id: "prompt-search-meetings", text: "Find the meetings this month where pricing came up." },
      { id: "prompt-follow-up", text: "Draft a follow-up email from yesterday's meeting with the design team." },
    ],
    websiteUrl: "https://www.fathom.ai",
    privacyPolicyUrl: "https://www.fathom.ai/privacy",
    termsUrl: "https://www.fathom.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-fathom-mcp",
        name: "Fathom",
        description:
          "Meeting search, summaries, transcripts, and action items, over Fathom's MCP server with browser sign-in.",
        server: {
          name: "fathom",
          transport: "http",
          url: "https://api.fathom.ai/mcp",
          auth: [{ id: "fathom-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "feishu",
    name: "Feishu",
    tagline: "Docs, messages, and groups",
    description:
      "Feishu lets agents read and edit cloud documents and read messages and groups in the signed-in Feishu account. Each user signs in to their own Feishu account through the browser.",
    category: "productivity",
    creatorName: "Feishu",
    version: "1.0.0",
    prompts: [
      { id: "prompt-doc-summary", text: "Summarize the Feishu document about the Q3 launch plan." },
      { id: "prompt-group-catchup", text: "What did the project group discuss today?" },
      { id: "prompt-draft-doc", text: "Draft a Feishu document with the agenda for next week's team meeting." },
    ],
    websiteUrl: "https://www.feishu.cn",
    privacyPolicyUrl: "https://www.feishu.cn/privacy",
    termsUrl: "https://www.feishu.cn/terms",
    featured: false,
    apps: [
      {
        id: "app-feishu-mcp",
        name: "Feishu",
        description: "Cloud document, message, and group access, over Feishu's MCP server with browser sign-in.",
        server: {
          name: "feishu",
          transport: "http",
          url: "https://mcp.feishu.cn/mcp",
          auth: [{ id: "feishu-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fellow",
    name: "Fellow",
    tagline: "Meeting notes and actions",
    description:
      "Fellow lets agents search meetings and read their summaries, transcripts, and action items in the signed-in Fellow workspace. A workspace admin must turn on the MCP server, and each user signs in through the browser.",
    category: "productivity",
    creatorName: "Fellow",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-actions", text: "Which action items from my meetings this week are still open?" },
      { id: "prompt-meeting-summary", text: "Summarize the last product review meeting." },
      { id: "prompt-prep", text: "Prepare talking points for my next one-on-one from our past meetings." },
    ],
    websiteUrl: "https://fellow.ai",
    privacyPolicyUrl: "https://fellow.ai/privacy-policy",
    termsUrl: "https://fellow.ai/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-fellow-mcp",
        name: "Fellow",
        description: "Meeting summaries, transcripts, and action items, over Fellow's MCP server with browser sign-in.",
        server: {
          name: "fellow",
          transport: "http",
          url: "https://fellow.app/mcp",
          auth: [{ id: "fellow-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "fireflies",
    name: "Fireflies.ai",
    tagline: "Meeting transcripts and search",
    description:
      "Fireflies.ai lets agents search meeting transcripts and read summaries and action items in the signed-in Fireflies account. Each user signs in to their own Fireflies account through the browser.",
    category: "productivity",
    creatorName: "Fireflies.ai",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recent-meetings", text: "List my meetings from this week with a one-line summary of each." },
      { id: "prompt-search-topic", text: "Find what was said about the renewal date in my calls with Acme." },
      { id: "prompt-action-items", text: "Collect the action items assigned to me in yesterday's meetings." },
    ],
    websiteUrl: "https://fireflies.ai",
    privacyPolicyUrl: "https://fireflies.ai/privacy-policy",
    termsUrl: "https://fireflies.ai/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-fireflies-mcp",
        name: "Fireflies.ai",
        description:
          "Transcript search, summaries, and action items, over Fireflies.ai's MCP server with browser sign-in.",
        server: {
          name: "fireflies",
          transport: "http",
          url: "https://api.fireflies.ai/mcp",
          auth: [{ id: "fireflies-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "floot",
    name: "Floot",
    tagline: "Build and edit web apps",
    description:
      "Floot lets agents create, edit, run, and publish Floot apps in the signed-in Floot account. Each user signs in to their own Floot account through the browser.",
    category: "coding",
    creatorName: "Floot",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-app", text: "Build a Floot app that tracks my team's weekly goals." },
      { id: "prompt-list-apps", text: "List my Floot apps and when each was last changed." },
      { id: "prompt-edit-app", text: "Add a dark mode toggle to my habit tracker app." },
    ],
    websiteUrl: "https://floot.com",
    privacyPolicyUrl: "https://floot.com/privacy",
    termsUrl: "https://floot.com/terms",
    featured: false,
    apps: [
      {
        id: "app-floot-mcp",
        name: "Floot",
        description: "App creation, edits, runs, and publishing, over Floot's MCP server with browser sign-in.",
        server: {
          name: "floot",
          transport: "http",
          url: "https://mcp.floot.com/mcp",
          auth: [{ id: "floot-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "folk",
    name: "folk",
    tagline: "Relationship CRM",
    description:
      "folk lets agents search and update people, companies, notes, and deals in the signed-in folk workspace. Each user signs in to their own folk account through the browser.",
    category: "productivity",
    creatorName: "folk",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-find-contact",
        text: "Find the people at Acme in my folk workspace and when I last talked to them.",
      },
      { id: "prompt-add-note", text: "Add a note to Jane Doe's folk profile about today's intro call." },
      { id: "prompt-stale-deals", text: "Which deals have had no activity for more than 30 days?" },
    ],
    websiteUrl: "https://www.folk.app",
    privacyPolicyUrl: "https://www.folk.app/privacy-policy",
    termsUrl: "https://www.folk.app/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-folk-mcp",
        name: "folk",
        description: "People, company, note, and deal access, over folk's MCP server with browser sign-in.",
        server: {
          name: "folk",
          transport: "http",
          url: "https://mcp.folk.app/mcp",
          auth: [{ id: "folk-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "freee",
    name: "freee",
    tagline: "Accounting, HR, and invoices",
    description:
      "freee lets agents read and update accounting, invoice, HR and payroll, and time-tracking data in the signed-in freee account. Each user signs in to their own freee account through the browser.",
    category: "other",
    creatorName: "freee",
    version: "1.0.0",
    prompts: [
      { id: "prompt-monthly-pl", text: "Summarize this month's income and expenses in freee accounting." },
      { id: "prompt-unpaid-invoices", text: "List the invoices that are past their due date." },
      { id: "prompt-draft-invoice", text: "Draft an invoice for 10 hours of consulting to Example Co." },
    ],
    websiteUrl: "https://www.freee.co.jp",
    privacyPolicyUrl: "https://corp.freee.co.jp/privacy/",
    termsUrl: "https://www.freee.co.jp/terms/",
    featured: false,
    apps: [
      {
        id: "app-freee-mcp",
        name: "freee",
        description: "Accounting, invoice, HR, and time-tracking access, over freee's MCP server with browser sign-in.",
        server: {
          name: "freee",
          transport: "http",
          url: "https://mcp.freee.co.jp/mcp",
          auth: [{ id: "freee-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "futu",
    name: "Futu",
    tagline: "Market data and portfolio",
    description:
      "Futu lets agents read stock quotes, market data, and portfolio positions in the signed-in Futu account. Each user signs in to their own Futu account through the browser.",
    category: "data-analytics",
    creatorName: "Futu",
    version: "1.0.0",
    prompts: [
      { id: "prompt-quote", text: "What is the latest quote and day range for Tencent (00700)?" },
      { id: "prompt-positions", text: "Summarize my current positions and their profit and loss." },
      { id: "prompt-watchlist", text: "Compare the 30-day performance of the stocks in my watchlist." },
    ],
    websiteUrl: "https://www.futunn.com",
    privacyPolicyUrl: "https://www.futunn.com/about/disclaimer?lang=en-us",
    termsUrl: "https://www.futunn.com/about/services?lang=en-us",
    featured: false,
    apps: [
      {
        id: "app-futu-mcp",
        name: "Futu",
        description: "Quotes, market data, and portfolio access, over Futu's MCP server with browser sign-in.",
        server: {
          name: "futu",
          transport: "http",
          url: "https://mcp.futunn.com/mcp",
          auth: [{ id: "futu-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "gitbook",
    name: "GitBook",
    tagline: "Documentation spaces",
    description:
      "GitBook lets agents search and read pages in the documentation spaces of the signed-in GitBook organization. Each user signs in to their own GitBook account through the browser.",
    category: "documents",
    creatorName: "GitBook",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search-docs", text: "Search our GitBook docs for how API keys are rotated." },
      { id: "prompt-outdated", text: "Which pages in the API reference space mention the old v1 endpoints?" },
      { id: "prompt-draft-page", text: "Draft a getting started page from the existing installation docs." },
    ],
    websiteUrl: "https://www.gitbook.com",
    privacyPolicyUrl: "https://gitbook.com/docs/policies/privacy-and-security/statement",
    termsUrl: "https://gitbook.com/docs/policies/terms",
    featured: false,
    apps: [
      {
        id: "app-gitbook-mcp",
        name: "GitBook",
        description: "Documentation search and page access, over GitBook's MCP server with browser sign-in.",
        server: {
          name: "gitbook",
          transport: "http",
          url: "https://mcp.gitbook.com/mcp",
          auth: [{ id: "gitbook-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "godaddy",
    name: "GoDaddy",
    tagline: "Domain name search",
    description:
      "GoDaddy lets agents check whether domain names are available and suggest names from keywords or a business description. It reads public domain data only and cannot buy domains or change DNS. It needs no account and no key.",
    category: "other",
    creatorName: "GoDaddy",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-availability",
        text: "Is northwind-bakery.com available? Check the .com, .co, and .shop names too.",
      },
      { id: "prompt-suggest", text: "Suggest ten short domain names for a mobile dog grooming business." },
      {
        id: "prompt-compare",
        text: "Which of these five names are still available: brightdesk, deskly, workbay, tasknest, plannr?",
      },
    ],
    websiteUrl: "https://www.godaddy.com",
    privacyPolicyUrl: "https://www.godaddy.com/legal/agreements/privacy-policy",
    termsUrl: "https://www.godaddy.com/legal/agreements/universal-terms-of-service-agreement",
    featured: false,
    apps: [
      {
        id: "app-godaddy-mcp",
        name: "GoDaddy",
        description: "Domain availability checks and name suggestions, over the GoDaddy MCP server with no sign-in.",
        server: { name: "godaddy", transport: "http", url: "https://mcp.godaddy.com" },
      },
    ],
  },
  {
    slug: "gojiberry",
    name: "Gojiberry",
    tagline: "B2B lead signals",
    description:
      "Gojiberry lets agents read B2B lead signals, enriched lead data, and campaign results in the signed-in Gojiberry account. Each user signs in to their own Gojiberry account through the browser.",
    category: "research",
    creatorName: "Gojiberry",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-leads", text: "Which leads showed buying signals this week?" },
      { id: "prompt-lead-profile", text: "Summarize what Gojiberry knows about the leads from Acme." },
      { id: "prompt-campaign-results", text: "How are my active campaigns performing on replies?" },
    ],
    websiteUrl: "https://gojiberry.ai",
    privacyPolicyUrl: "https://gojiberry.ai/privacy-policy",
    termsUrl: "https://gojiberry.ai/general-terms",
    featured: false,
    apps: [
      {
        id: "app-gojiberry-mcp",
        name: "Gojiberry",
        description: "Lead signal, enrichment, and campaign access, over Gojiberry's MCP server with browser sign-in.",
        server: {
          name: "gojiberry",
          transport: "http",
          url: "https://mcp.gojiberry.ai",
          auth: [{ id: "gojiberry-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "grafana",
    name: "Grafana Cloud",
    tagline: "Dashboards, metrics, and logs",
    description:
      "Grafana Cloud lets agents search dashboards, query metrics and logs, and read alerts and incidents in the signed-in Grafana Cloud stack. The user needs the Cloud MCP User role and signs in through the browser.",
    category: "coding",
    creatorName: "Grafana Labs",
    version: "1.0.0",
    prompts: [
      { id: "prompt-firing-alerts", text: "Which alerts are firing right now and since when?" },
      { id: "prompt-error-logs", text: "Show the error logs for the checkout service from the last hour." },
      { id: "prompt-find-dashboard", text: "Find the dashboard for API latency and summarize the last 24 hours." },
    ],
    websiteUrl: "https://grafana.com",
    privacyPolicyUrl: "https://grafana.com/legal/privacy-policy/",
    termsUrl: "https://grafana.com/legal/terms/",
    featured: false,
    apps: [
      {
        id: "app-grafana-mcp",
        name: "Grafana Cloud",
        description: "Dashboard, metric, log, and alert access, over Grafana Labs' MCP server with browser sign-in.",
        server: {
          name: "grafana",
          transport: "http",
          url: "https://mcp.grafana.com/mcp",
          auth: [{ id: "grafana-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "granola",
    name: "Granola",
    tagline: "Meeting notes search",
    description:
      "Granola lets agents search and read meeting notes and transcripts in the signed-in Granola account. Each user signs in to their own Granola account through the browser.",
    category: "productivity",
    creatorName: "Granola",
    version: "1.0.0",
    prompts: [
      { id: "prompt-week-recap", text: "Recap my meetings this week and the decisions we made." },
      { id: "prompt-find-note", text: "Find my notes from the call where we discussed the hiring plan." },
      { id: "prompt-follow-up", text: "Draft a follow-up email from my last meeting notes." },
    ],
    websiteUrl: "https://www.granola.ai",
    privacyPolicyUrl: "https://docs.granola.ai/help-center/policies/privacy-policy",
    termsUrl: "https://docs.granola.ai/help-center/policies/terms-of-service/application-terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-granola-mcp",
        name: "Granola",
        description: "Meeting note and transcript search, over Granola's MCP server with browser sign-in.",
        server: {
          name: "granola",
          transport: "http",
          url: "https://mcp.granola.ai/mcp",
          auth: [{ id: "granola-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "greenhouse",
    name: "Greenhouse",
    tagline: "Recruiting and candidates",
    description:
      "Greenhouse lets agents read jobs, candidates, applications, and interview feedback in the signed-in Greenhouse account. Each user signs in to their own Greenhouse account through the browser.",
    category: "productivity",
    creatorName: "Greenhouse",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-jobs", text: "List my open jobs and how many active candidates each has." },
      {
        id: "prompt-candidate-summary",
        text: "Summarize the interview feedback for the latest backend engineer candidate.",
      },
      { id: "prompt-stuck", text: "Which applications have stayed in the same stage for more than two weeks?" },
    ],
    websiteUrl: "https://www.greenhouse.com",
    privacyPolicyUrl: "https://www.greenhouse.com/privacy-policy",
    termsUrl: "https://www.greenhouse.com/legal",
    featured: false,
    apps: [
      {
        id: "app-greenhouse-mcp",
        name: "Greenhouse",
        description:
          "Job, candidate, application, and feedback access, over Greenhouse's MCP server with browser sign-in.",
        server: {
          name: "greenhouse",
          transport: "http",
          url: "https://mcp.greenhouse.io/mcp",
          auth: [{ id: "greenhouse-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "guru",
    name: "Guru",
    tagline: "Company knowledge search",
    description:
      "Guru lets agents search verified company knowledge, answer questions from it, and draft new cards in the signed-in Guru workspace. Each user signs in to their own Guru account through the browser.",
    category: "documents",
    creatorName: "Guru",
    version: "1.0.0",
    prompts: [
      { id: "prompt-policy", text: "What is our travel expense policy according to Guru?" },
      { id: "prompt-onboarding", text: "Find the Guru cards a new support agent should read first." },
      { id: "prompt-draft-card", text: "Draft a Guru card that explains how to reset a customer's password." },
    ],
    websiteUrl: "https://www.getguru.com",
    privacyPolicyUrl: "https://www.getguru.com/privacy",
    termsUrl: "https://www.getguru.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-guru-mcp",
        name: "Guru",
        description: "Knowledge search, answers, and card drafts, over Guru's MCP server with browser sign-in.",
        server: {
          name: "guru",
          transport: "http",
          url: "https://mcp.api.getguru.com/mcp",
          auth: [{ id: "guru-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "harmonic",
    name: "Harmonic",
    tagline: "Company and investor data",
    description:
      "Harmonic lets agents search companies, people, and investors and read their funding and headcount data with the signed-in Harmonic account. Each user signs in to their own Harmonic account through the browser.",
    category: "research",
    creatorName: "Harmonic",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-find-startups",
        text: "Find seed-stage climate startups in Europe that raised in the last six months.",
      },
      { id: "prompt-company-profile", text: "Summarize the funding history and headcount growth of Acme Robotics." },
      { id: "prompt-founders", text: "Who are the founders of Acme Robotics and where did they work before?" },
    ],
    websiteUrl: "https://harmonic.ai",
    privacyPolicyUrl: "https://harmonic.ai/legal/privacy-policy",
    termsUrl: "https://harmonic.ai/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-harmonic-mcp",
        name: "Harmonic",
        description: "Company, people, and investor search, over Harmonic's MCP server with browser sign-in.",
        server: {
          name: "harmonic",
          transport: "http",
          url: "https://mcp.api.harmonic.ai",
          auth: [{ id: "harmonic-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "helium10",
    name: "Helium 10",
    tagline: "Amazon seller research",
    description:
      "Helium 10 lets agents research Amazon products and keywords and read seller data with the signed-in Helium 10 account. Each user signs in to their own Helium 10 account through the browser.",
    category: "data-analytics",
    creatorName: "Helium 10",
    version: "1.0.0",
    prompts: [
      { id: "prompt-keywords", text: "Find high-volume keywords for a stainless steel water bottle on Amazon US." },
      { id: "prompt-product-research", text: "Compare the top 10 listings for yoga mats by sales and reviews." },
      { id: "prompt-listing-draft", text: "Draft a product title and five bullet points for my bamboo cutting board." },
    ],
    websiteUrl: "https://www.helium10.com",
    privacyPolicyUrl: "https://www.helium10.com/privacy-policy/",
    termsUrl: "https://www.helium10.com/terms-and-conditions/",
    featured: false,
    apps: [
      {
        id: "app-helium10-mcp",
        name: "Helium 10",
        description: "Product, keyword, and seller data access, over Helium 10's MCP server with browser sign-in.",
        server: {
          name: "helium10",
          transport: "http",
          url: "https://mcp.helium10.com/mcp",
          auth: [{ id: "helium10-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "helpscout",
    name: "Help Scout",
    tagline: "Support conversations and reports",
    description:
      "Help Scout lets agents search support conversations, pull reports, and search Docs articles in the signed-in Help Scout account. Access is read-only, and each user signs in through the browser.",
    category: "productivity",
    creatorName: "Help Scout",
    version: "1.0.0",
    prompts: [
      { id: "prompt-top-issues", text: "What were the most common customer issues this week?" },
      { id: "prompt-report", text: "Pull the response time report for last month." },
      {
        id: "prompt-find-conversation",
        text: "Find the conversations where customers asked about refunds for annual plans.",
      },
    ],
    websiteUrl: "https://www.helpscout.com",
    privacyPolicyUrl: "https://www.helpscout.com/company/legal/privacy/",
    termsUrl: "https://www.helpscout.com/company/legal/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-helpscout-mcp",
        name: "Help Scout",
        description:
          "Conversation search, reports, and Docs search, over Help Scout's MCP server with browser sign-in.",
        server: {
          name: "helpscout",
          transport: "http",
          url: "https://mcp.helpscout.net/mcp",
          auth: [{ id: "helpscout-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "hex",
    name: "Hex",
    tagline: "Data projects and analysis",
    description:
      "Hex lets agents search projects, read their results, and ask data questions in the signed-in Hex workspace. It needs a Team or Enterprise plan, and each user signs in through the browser.",
    category: "data-analytics",
    creatorName: "Hex Technologies",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-project", text: "Find the Hex project that tracks weekly active users." },
      { id: "prompt-question", text: "How did revenue by region change last quarter?" },
      { id: "prompt-explain", text: "Explain what the churn analysis project calculates and which tables it uses." },
    ],
    websiteUrl: "https://hex.tech",
    privacyPolicyUrl: "https://learn.hex.tech/docs/legal/privacy",
    termsUrl: "https://learn.hex.tech/docs/legal/terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-hex-mcp",
        name: "Hex",
        description: "Project search, results, and data questions, over Hex's MCP server with browser sign-in.",
        server: {
          name: "hex",
          transport: "http",
          url: "https://app.hex.tech/mcp",
          auth: [{ id: "hex-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "heyreach",
    name: "HeyReach",
    tagline: "LinkedIn outreach campaigns",
    description:
      "HeyReach lets agents read LinkedIn outreach campaigns, lead lists, and conversations in the signed-in HeyReach workspace. Each user signs in to their own HeyReach account through the browser.",
    category: "automation",
    creatorName: "HeyReach",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaign-stats", text: "How are my active campaigns doing on acceptance and reply rates?" },
      { id: "prompt-replies", text: "List the leads who replied this week and what they said." },
      {
        id: "prompt-draft-message",
        text: "Draft a short LinkedIn follow-up for a lead who accepted but did not reply.",
      },
    ],
    websiteUrl: "https://www.heyreach.io",
    privacyPolicyUrl: "https://www.heyreach.io/privacy-policy",
    termsUrl: "https://www.heyreach.io/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-heyreach-mcp",
        name: "HeyReach",
        description: "Campaign, lead list, and conversation access, over HeyReach's MCP server with browser sign-in.",
        server: {
          name: "heyreach",
          transport: "http",
          url: "https://mcp.heyreach.io/mcp",
          auth: [{ id: "heyreach-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "highlevel",
    name: "HighLevel",
    tagline: "CRM and marketing workspace",
    description:
      "HighLevel lets agents read and update contacts, conversations, opportunities, and calendars in the signed-in HighLevel sub-account. Each user signs in to their own HighLevel account through the browser.",
    category: "productivity",
    creatorName: "HighLevel",
    version: "1.0.0",
    prompts: [
      { id: "prompt-new-leads", text: "List the contacts that were added this week." },
      { id: "prompt-pipeline", text: "Summarize the opportunities in my sales pipeline by stage." },
      { id: "prompt-appointments", text: "What appointments are booked on my calendar tomorrow?" },
    ],
    websiteUrl: "https://www.gohighlevel.com",
    privacyPolicyUrl: "https://www.gohighlevel.com/privacy-policy",
    termsUrl: "https://www.gohighlevel.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-highlevel-mcp",
        name: "HighLevel",
        description:
          "Contact, conversation, opportunity, and calendar access, over HighLevel's MCP server with browser sign-in.",
        server: {
          name: "highlevel",
          transport: "http",
          url: "https://services.leadconnectorhq.com/mcp",
          auth: [{ id: "highlevel-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "hospitable",
    name: "Hospitable",
    tagline: "Short-term rental operations",
    description:
      "Hospitable lets agents read properties, reservations, calendars, and transactions, and draft replies to guest messages in the signed-in host account. Each user signs in to their own Hospitable account through the browser.",
    category: "productivity",
    creatorName: "Hospitable",
    version: "1.0.0",
    prompts: [
      { id: "prompt-check-ins", text: "Which guests check in this week, and at which properties?" },
      { id: "prompt-guest-inbox", text: "Summarize the guest messages that still need a reply." },
      { id: "prompt-draft-reply", text: "Draft a reply to the latest guest question about parking." },
    ],
    websiteUrl: "https://hospitable.com",
    privacyPolicyUrl: "https://hospitable.com/legal/privacy-policy",
    termsUrl: "https://hospitable.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-hospitable-mcp",
        name: "Hospitable",
        description:
          "Properties, reservations, calendars, and guest messages, over Hospitable's MCP server with browser sign-in.",
        server: {
          name: "hospitable",
          transport: "http",
          url: "https://mcp.hospitable.com/mcp",
          auth: [{ id: "hospitable-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "hostinger",
    name: "Hostinger",
    tagline: "Hosting, domains and DNS",
    description:
      "Hostinger lets agents read and manage websites, domains, DNS records, and VPS instances in the signed-in Hostinger account. Each user signs in to their own Hostinger account through the browser.",
    category: "coding",
    creatorName: "Hostinger",
    version: "1.0.0",
    prompts: [
      { id: "prompt-domains", text: "List my domains and show which ones expire in the next 60 days." },
      { id: "prompt-dns", text: "Show the DNS records for my main domain." },
      { id: "prompt-vps", text: "What is the status and plan of each of my VPS instances?" },
    ],
    websiteUrl: "https://www.hostinger.com",
    privacyPolicyUrl: "https://www.hostinger.com/legal/privacy-policy",
    termsUrl: "https://www.hostinger.com/legal/universal-terms-of-service-agreement",
    featured: false,
    apps: [
      {
        id: "app-hostinger-mcp",
        name: "Hostinger",
        description: "Hosting, domains, DNS, and VPS management, over Hostinger's MCP server with browser sign-in.",
        server: {
          name: "hostinger",
          transport: "http",
          url: "https://mcp.hostinger.com",
          auth: [{ id: "hostinger-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ibkr",
    name: "IBKR",
    tagline: "Brokerage account data",
    description:
      "IBKR lets agents read positions, balances, orders, and market data for the signed-in Interactive Brokers account. Each user signs in to their own Interactive Brokers account through the browser.",
    category: "data-analytics",
    creatorName: "Interactive Brokers",
    version: "1.0.0",
    prompts: [
      { id: "prompt-positions", text: "Summarize my current positions and their unrealized profit and loss." },
      { id: "prompt-balances", text: "What are my cash balance and buying power?" },
      { id: "prompt-quote", text: "Show the latest quote and daily range for AAPL." },
    ],
    websiteUrl: "https://www.interactivebrokers.com",
    privacyPolicyUrl: "https://www.interactivebrokers.com/en/accounts/legalDocuments/privacy.php",
    termsUrl: "https://www.interactivebrokers.com/en/accounts/forms-and-disclosures-client-agreements.php",
    featured: false,
    apps: [
      {
        id: "app-ibkr-mcp",
        name: "IBKR",
        description:
          "Positions, balances, orders, and market data, over Interactive Brokers' MCP server with browser sign-in.",
        server: {
          name: "ibkr",
          transport: "http",
          url: "https://api.ibkr.com/v1/api/mcp-public",
          auth: [{ id: "ibkr-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ifttt",
    name: "IFTTT",
    tagline: "Connect apps and devices",
    description:
      "IFTTT lets agents run actions in the services and devices connected to the signed-in IFTTT account, such as a Slack message or smart lights, and create applets. Each user signs in to their own IFTTT account through the browser.",
    category: "automation",
    creatorName: "IFTTT",
    version: "1.0.0",
    prompts: [
      { id: "prompt-services", text: "Which of my connected services can you use through IFTTT?" },
      { id: "prompt-ideas", text: "Suggest applets that save new email attachments to cloud storage." },
      { id: "prompt-draft-applet", text: "Set up an applet that turns on my porch light at sunset." },
    ],
    websiteUrl: "https://ifttt.com",
    privacyPolicyUrl: "https://ifttt.com/privacy",
    termsUrl: "https://ifttt.com/terms",
    featured: false,
    apps: [
      {
        id: "app-ifttt-mcp",
        name: "IFTTT",
        description: "Actions in connected services and applet creation, over IFTTT's MCP server with browser sign-in.",
        server: {
          name: "ifttt",
          transport: "http",
          url: "https://ifttt.com/mcp",
          auth: [{ id: "ifttt-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "incidentio",
    name: "incident.io",
    tagline: "Incidents and on-call",
    description:
      "incident.io lets agents read incidents, alerts, on-call schedules, and catalog entries, and update incidents in the signed-in organization. An admin must turn on the MCP server in Settings, and each user signs in through the browser.",
    category: "coding",
    creatorName: "incident.io",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-incidents", text: "List the open incidents and their severity." },
      { id: "prompt-on-call", text: "Who is on call for the platform team right now?" },
      { id: "prompt-incident-summary", text: "Draft a summary of yesterday's database incident for the postmortem." },
    ],
    websiteUrl: "https://incident.io",
    privacyPolicyUrl: "https://incident.io/legal/privacy",
    termsUrl: "https://incident.io/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-incidentio-mcp",
        name: "incident.io",
        description:
          "Incidents, alerts, on-call schedules, and catalog, over incident.io's MCP server with browser sign-in.",
        server: {
          name: "incidentio",
          transport: "http",
          url: "https://mcp.incident.io/mcp",
          auth: [{ id: "incidentio-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "instantly",
    name: "Instantly",
    tagline: "Cold email campaigns",
    description:
      "Instantly lets agents read campaigns, leads, and analytics, and draft campaigns and lead lists in the signed-in workspace. Each user signs in to their own Instantly account through the browser.",
    category: "productivity",
    creatorName: "Instantly",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaign-stats", text: "Compare the open and reply rates of my active campaigns." },
      { id: "prompt-leads", text: "Which leads replied this week, and to which campaign?" },
      {
        id: "prompt-draft-sequence",
        text: "Draft a three-step follow-up sequence for the new SaaS lead list, but do not launch it.",
      },
    ],
    websiteUrl: "https://instantly.ai",
    privacyPolicyUrl: "https://instantly.ai/privacy",
    termsUrl: "https://instantly.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-instantly-mcp",
        name: "Instantly",
        description: "Campaigns, leads, and analytics, over Instantly's MCP server with browser sign-in.",
        server: {
          name: "instantly",
          transport: "http",
          url: "https://mcp.instantly.ai/mcp",
          auth: [{ id: "instantly-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "intercom",
    name: "Intercom",
    tagline: "Customer support conversations",
    description:
      "Intercom lets agents search and read conversations, tickets, and contacts in the signed-in workspace. Each user signs in to their own Intercom account through the browser; this address is for US-hosted workspaces.",
    category: "productivity",
    creatorName: "Intercom",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-conversations", text: "Summarize the open conversations from the last 24 hours." },
      { id: "prompt-customer", text: "Show the recent conversations and tickets for this customer email." },
      { id: "prompt-themes", text: "What are the most common topics in this week's support conversations?" },
    ],
    websiteUrl: "https://www.intercom.com",
    privacyPolicyUrl: "https://www.intercom.com/legal/privacy",
    termsUrl: "https://www.intercom.com/legal/terms-and-policies",
    featured: false,
    apps: [
      {
        id: "app-intercom-mcp",
        name: "Intercom",
        description: "Conversation, ticket, and contact search, over Intercom's MCP server with browser sign-in.",
        server: {
          name: "intercom",
          transport: "http",
          url: "https://mcp.intercom.com/mcp",
          auth: [{ id: "intercom-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "invideo",
    name: "invideo",
    tagline: "AI video generation",
    description:
      "invideo lets agents generate videos from a script or a prompt in the signed-in invideo account. Each user signs in to their own invideo account through the browser.",
    category: "design",
    creatorName: "invideo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-explainer", text: "Make a 60-second explainer video about how our app syncs files." },
      { id: "prompt-script", text: "Turn this blog post into a short video with voiceover." },
      { id: "prompt-social", text: "Create a 30-second vertical video that announces our spring sale." },
    ],
    websiteUrl: "https://invideo.io",
    privacyPolicyUrl: "https://invideo.io/privacy-policy/",
    termsUrl: "https://invideo.io/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-invideo-mcp",
        name: "invideo",
        description: "Video generation from scripts and prompts, over invideo's MCP server with browser sign-in.",
        server: {
          name: "invideo",
          transport: "http",
          url: "https://mcp.invideo.io/mcp",
          auth: [{ id: "invideo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "jobtread",
    name: "JobTread",
    tagline: "Construction job management",
    description:
      "JobTread lets agents read and update jobs, budgets, daily logs, tasks, and documents in the signed-in JobTread organization. Each user signs in to their own JobTread account through the browser.",
    category: "productivity",
    creatorName: "JobTread",
    version: "1.0.0",
    prompts: [
      { id: "prompt-active-jobs", text: "List my active jobs and their current status." },
      { id: "prompt-budget", text: "Compare the budget and actual costs for the Smith kitchen remodel." },
      { id: "prompt-daily-log", text: "Draft today's daily log for the Main Street job from these notes." },
    ],
    websiteUrl: "https://www.jobtread.com",
    privacyPolicyUrl: "https://www.jobtread.com/privacy-policy",
    termsUrl: "https://www.jobtread.com/terms",
    featured: false,
    apps: [
      {
        id: "app-jobtread-mcp",
        name: "JobTread",
        description: "Jobs, budgets, daily logs, and tasks, over JobTread's MCP server with browser sign-in.",
        server: {
          name: "jobtread",
          transport: "http",
          url: "https://api.jobtread.com/mcp",
          auth: [{ id: "jobtread-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "kajabi",
    name: "Kajabi",
    tagline: "Courses and creator business",
    description:
      "Kajabi lets agents read and manage products, courses, contacts, and offers in the signed-in Kajabi site. It cannot take payments or send email broadcasts.",
    category: "productivity",
    creatorName: "Kajabi",
    version: "1.0.0",
    prompts: [
      { id: "prompt-products", text: "List my products and courses and how many members each one has." },
      { id: "prompt-contacts", text: "Which contacts joined in the last 30 days?" },
      { id: "prompt-course-outline", text: "Draft an outline for a new course module about pricing." },
    ],
    websiteUrl: "https://www.kajabi.com",
    privacyPolicyUrl: "https://www.kajabi.com/policies/privacy",
    termsUrl: "https://www.kajabi.com/policies/terms",
    featured: false,
    apps: [
      {
        id: "app-kajabi-mcp",
        name: "Kajabi",
        description: "Products, courses, contacts, and offers, over Kajabi's MCP server with browser sign-in.",
        server: {
          name: "kajabi",
          transport: "http",
          url: "https://mcp.kajabi.com/mcp",
          auth: [{ id: "kajabi-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "kensho",
    name: "Kensho",
    tagline: "S&P Global financial data",
    description:
      "Kensho lets agents read S&P Global company financials, earnings call transcripts, and market data through the Kensho LLM-ready API. It needs an S&P Global or Kensho subscription, and each user signs in through the browser.",
    category: "data-analytics",
    creatorName: "Kensho Technologies",
    version: "1.0.0",
    prompts: [
      { id: "prompt-financials", text: "Show the revenue and operating margin of Microsoft for the last five years." },
      { id: "prompt-transcript", text: "Summarize the latest earnings call of Nvidia." },
      { id: "prompt-compare", text: "Compare the net debt of the three largest US airlines." },
    ],
    websiteUrl: "https://kensho.com",
    privacyPolicyUrl: "https://www.spglobal.com/en/privacy/privacy-policy-english",
    termsUrl: "https://www.spglobal.com/en/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-kensho-mcp",
        name: "Kensho",
        description: "Company financials, transcripts, and market data, over Kensho's MCP server with browser sign-in.",
        server: {
          name: "kensho",
          transport: "http",
          url: "https://kfinance.kensho.com/integrations/mcp",
          auth: [{ id: "kensho-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "kit",
    name: "Kit",
    tagline: "Email newsletters for creators",
    description:
      "Kit lets agents read subscribers, tags, segments, sequences, and broadcasts, manage subscribers, and draft broadcasts in the signed-in Kit account. It never sends a broadcast, and it needs a paid Kit plan.",
    category: "productivity",
    creatorName: "Kit",
    version: "1.0.0",
    prompts: [
      { id: "prompt-growth", text: "How many subscribers did I gain this month, and from which forms?" },
      { id: "prompt-broadcast-stats", text: "Compare the open and click rates of my last five broadcasts." },
      { id: "prompt-draft-broadcast", text: "Draft a broadcast that announces my new workshop." },
    ],
    websiteUrl: "https://kit.com",
    privacyPolicyUrl: "https://kit.com/privacy",
    termsUrl: "https://kit.com/terms",
    featured: false,
    apps: [
      {
        id: "app-kit-mcp",
        name: "Kit",
        description: "Subscribers, tags, sequences, and broadcast drafts, over Kit's MCP server with browser sign-in.",
        server: {
          name: "kit",
          transport: "http",
          url: "https://app.kit.com/mcp",
          auth: [{ id: "kit-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "klaviyo",
    name: "Klaviyo",
    tagline: "Email and SMS marketing",
    description:
      "Klaviyo lets agents read campaigns, flows, lists, segments, profiles, and performance reports, and draft campaigns in the signed-in Klaviyo account. Each user signs in through the browser with an Owner, Admin, or Manager role.",
    category: "productivity",
    creatorName: "Klaviyo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaign-report", text: "Which email campaigns had the highest revenue last month?" },
      { id: "prompt-flows", text: "Summarize the performance of my welcome and abandoned cart flows." },
      {
        id: "prompt-draft-campaign",
        text: "Draft an email campaign for the new summer collection, but do not schedule it.",
      },
    ],
    websiteUrl: "https://www.klaviyo.com",
    privacyPolicyUrl: "https://www.klaviyo.com/legal/privacy-notice",
    termsUrl: "https://www.klaviyo.com/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-klaviyo-mcp",
        name: "Klaviyo",
        description: "Campaigns, flows, segments, and reports, over Klaviyo's MCP server with browser sign-in.",
        server: {
          name: "klaviyo",
          transport: "http",
          url: "https://mcp.klaviyo.com/mcp",
          auth: [{ id: "klaviyo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "knowify",
    name: "Knowify",
    tagline: "Contractor job management",
    description:
      "Knowify lets agents read jobs, clients, estimates, invoices, and time entries in the signed-in Knowify account. Each user signs in to their own Knowify account through the browser.",
    category: "productivity",
    creatorName: "Knowify",
    version: "1.0.0",
    prompts: [
      { id: "prompt-active-jobs", text: "List my active jobs and how much of each budget is used." },
      { id: "prompt-unpaid", text: "Which invoices are past due, and for which clients?" },
      { id: "prompt-estimate", text: "Draft an estimate for a bathroom remodel from these notes." },
    ],
    websiteUrl: "https://knowify.com",
    privacyPolicyUrl: "https://knowify.com/privacy-policy/",
    termsUrl: "https://knowify.com/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-knowify-mcp",
        name: "Knowify",
        description: "Jobs, clients, estimates, and invoices, over Knowify's MCP server with browser sign-in.",
        server: {
          name: "knowify",
          transport: "http",
          url: "https://assistant.knowify.com/api/v2/mcp",
          auth: [{ id: "knowify-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "krisp",
    name: "Krisp",
    tagline: "Meeting notes and transcripts",
    description:
      "Krisp lets agents search and read meeting transcripts, summaries, action items, and upcoming meetings in the signed-in Krisp account. Each user signs in to their own Krisp account through the browser.",
    category: "productivity",
    creatorName: "Krisp",
    version: "1.0.0",
    prompts: [
      { id: "prompt-action-items", text: "List the action items from my meetings this week." },
      { id: "prompt-meeting-summary", text: "Summarize yesterday's call with the design team." },
      {
        id: "prompt-upcoming",
        text: "What meetings do I have tomorrow, and what did we discuss last time with each group?",
      },
    ],
    websiteUrl: "https://krisp.ai",
    privacyPolicyUrl: "https://krisp.ai/privacy-policy/",
    termsUrl: "https://krisp.ai/terms-of-use/",
    featured: false,
    apps: [
      {
        id: "app-krisp-mcp",
        name: "Krisp",
        description: "Meeting transcripts, summaries, and action items, over Krisp's MCP server with browser sign-in.",
        server: {
          name: "krisp",
          transport: "http",
          url: "https://mcp.krisp.ai/mcp",
          auth: [{ id: "krisp-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "lark",
    name: "Lark",
    tagline: "Docs and team messaging",
    description:
      "Lark lets agents search, read, create, and comment on docs, read group chats and messages, and find users in the signed-in Lark workspace. Each user signs in to their own Lark account through the browser.",
    category: "documents",
    creatorName: "Lark Technologies",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-doc", text: "Find the latest product roadmap doc and summarize it." },
      { id: "prompt-chat-summary", text: "Summarize today's messages in the project group chat." },
      { id: "prompt-draft-doc", text: "Create a doc with meeting notes from these bullet points." },
    ],
    websiteUrl: "https://www.larksuite.com",
    privacyPolicyUrl: "https://www.larksuite.com/en_us/privacy-policy",
    termsUrl: "https://www.larksuite.com/en_us/user-terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-lark-mcp",
        name: "Lark",
        description: "Docs, group chats, and user search, over Lark's MCP server with browser sign-in.",
        server: {
          name: "lark",
          transport: "http",
          url: "https://mcp.larksuite.com/mcp",
          auth: [{ id: "lark-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "launchdarkly",
    name: "LaunchDarkly",
    tagline: "Feature flags and experiments",
    description:
      "LaunchDarkly lets agents read, create, and update feature flags, segments, and AI configs in the signed-in LaunchDarkly account. Each user signs in through the browser; EU and Federal instances are not supported.",
    category: "coding",
    creatorName: "LaunchDarkly",
    version: "1.0.0",
    prompts: [
      { id: "prompt-stale-flags", text: "Which feature flags have not changed in 90 days and are safe to clean up?" },
      { id: "prompt-flag-status", text: "Show the targeting rules of the new-checkout flag in production." },
      {
        id: "prompt-new-flag",
        text: "Create a boolean flag for the dark mode rollout, turned off in every environment.",
      },
    ],
    websiteUrl: "https://launchdarkly.com",
    privacyPolicyUrl: "https://launchdarkly.com/policies/privacy/",
    termsUrl: "https://launchdarkly.com/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-launchdarkly-mcp",
        name: "LaunchDarkly",
        description: "Feature flags, segments, and AI configs, over LaunchDarkly's MCP server with browser sign-in.",
        server: {
          name: "launchdarkly",
          transport: "http",
          url: "https://mcp.launchdarkly.com/mcp",
          auth: [{ id: "launchdarkly-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "lemlist",
    name: "lemlist",
    tagline: "Sales outreach campaigns",
    description:
      "lemlist lets agents read campaigns, leads, and campaign statistics, and draft sequences and lead lists in the signed-in team. Each user signs in to their own lemlist account through the browser.",
    category: "productivity",
    creatorName: "lemlist",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaign-stats", text: "Compare the reply rates of my active campaigns." },
      { id: "prompt-interested", text: "Which leads were marked as interested this week?" },
      { id: "prompt-draft-sequence", text: "Draft a four-step sequence for agency founders, but do not launch it." },
    ],
    websiteUrl: "https://www.lemlist.com",
    privacyPolicyUrl: "https://www.lemlist.com/legal/privacy-policy",
    termsUrl: "https://www.lemlist.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-lemlist-mcp",
        name: "lemlist",
        description: "Campaigns, leads, and statistics, over lemlist's MCP server with browser sign-in.",
        server: {
          name: "lemlist",
          transport: "http",
          url: "https://app.lemlist.com/mcp",
          auth: [{ id: "lemlist-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "littlebird",
    name: "Littlebird",
    tagline: "Personal work memory",
    description:
      "Littlebird lets agents search the signed-in user's Littlebird memory of meetings, decisions, and past work. It needs a Littlebird Power plan or higher, and each user signs in through the browser.",
    category: "productivity",
    creatorName: "Littlebird",
    version: "1.0.0",
    prompts: [
      { id: "prompt-decisions", text: "What did we decide about the pricing change last week?" },
      { id: "prompt-recap", text: "Summarize what I worked on yesterday." },
      { id: "prompt-context", text: "Find what I discussed with Anna about the launch plan." },
    ],
    websiteUrl: "https://littlebird.ai",
    privacyPolicyUrl: "https://littlebird.ai/privacy-policy",
    termsUrl: "https://littlebird.ai/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-littlebird-mcp",
        name: "Littlebird",
        description: "Search of meetings, decisions, and past work, over Littlebird's MCP server with browser sign-in.",
        server: {
          name: "littlebird",
          transport: "http",
          url: "https://mcp.littlebird.ai/mcp",
          auth: [{ id: "littlebird-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "localmcp",
    name: "LMCP",
    tagline: "Apps on your computer",
    description:
      "LMCP lets agents use mail, calendar, files, and other apps on the user's own Mac or Windows computer through the LMCP relay. The user must install the LMCP app and turn on Cloud Data Forwarding, then sign in through the browser.",
    category: "productivity",
    creatorName: "Colibird",
    version: "1.0.0",
    prompts: [
      { id: "prompt-calendar", text: "What is on my calendar tomorrow?" },
      { id: "prompt-unread-mail", text: "Summarize my unread emails from today." },
      { id: "prompt-draft-mail", text: "Draft a reply to the last email from my manager, but do not send it." },
    ],
    websiteUrl: "https://www.local-mcp.com",
    privacyPolicyUrl: "https://www.local-mcp.com/en/privacy",
    termsUrl: "https://www.local-mcp.com/en/tos",
    featured: false,
    apps: [
      {
        id: "app-localmcp-mcp",
        name: "LMCP",
        description:
          "Mail, calendar, and files on the user's computer, over Colibird's MCP server with browser sign-in.",
        server: {
          name: "localmcp",
          transport: "http",
          url: "https://www.local-mcp.com/mcp",
          auth: [{ id: "localmcp-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "longbridge",
    name: "Longbridge",
    tagline: "Brokerage and market data",
    description:
      "Longbridge lets agents read quotes, market data, positions, and account balances for the signed-in Longbridge account. Each user signs in to their own Longbridge account through the browser.",
    category: "data-analytics",
    creatorName: "Longbridge",
    version: "1.0.0",
    prompts: [
      { id: "prompt-positions", text: "Summarize my positions and their profit and loss today." },
      { id: "prompt-quote", text: "Show the latest quote and trading volume for TSLA." },
      { id: "prompt-watch", text: "Compare the price change this month for AAPL, MSFT, and NVDA." },
    ],
    websiteUrl: "https://longbridge.com",
    privacyPolicyUrl: "https://longbridge.com/sg/support/topics/Other/privacy-policy",
    termsUrl: "https://open.longbridge.com/docs/legal",
    featured: false,
    apps: [
      {
        id: "app-longbridge-mcp",
        name: "Longbridge",
        description: "Quotes, market data, positions, and balances, over Longbridge's MCP server with browser sign-in.",
        server: {
          name: "longbridge",
          transport: "http",
          url: "https://mcp.longbridge.com",
          auth: [{ id: "longbridge-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "lovable",
    name: "Lovable",
    tagline: "Build apps from prompts",
    description:
      "Lovable lets agents create projects, send build requests, read project analytics, and publish projects in the signed-in Lovable workspace. Each user signs in to their own Lovable account through the browser.",
    category: "coding",
    creatorName: "Lovable",
    version: "1.0.0",
    prompts: [
      { id: "prompt-projects", text: "List my Lovable projects and when each one was last changed." },
      { id: "prompt-new-app", text: "Start a new project for a simple habit tracker with a login page." },
      { id: "prompt-change", text: "In my landing page project, add a pricing section with three plans." },
    ],
    websiteUrl: "https://lovable.dev",
    privacyPolicyUrl: "https://lovable.dev/privacy",
    termsUrl: "https://lovable.dev/terms",
    featured: false,
    apps: [
      {
        id: "app-lovable-mcp",
        name: "Lovable",
        description: "Project creation, build requests, and analytics, over Lovable's MCP server with browser sign-in.",
        server: {
          name: "lovable",
          transport: "http",
          url: "https://mcp.lovable.dev",
          auth: [{ id: "lovable-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "lusha",
    name: "Lusha",
    tagline: "B2B contact and company data",
    description:
      "Lusha lets agents search and enrich contacts and companies with B2B data from the signed-in Lusha account. Enrichment uses the account's Lusha credits.",
    category: "research",
    creatorName: "Lusha",
    version: "1.0.0",
    prompts: [
      { id: "prompt-company", text: "Find the size, industry, and location of the company Acme Robotics." },
      {
        id: "prompt-prospects",
        text: "Find heads of marketing at software companies in Berlin with 50 to 200 employees.",
      },
      { id: "prompt-enrich", text: "Enrich this list of five contacts with job titles and companies." },
    ],
    websiteUrl: "https://www.lusha.com",
    privacyPolicyUrl: "https://www.lusha.com/legal/privacy-notice/",
    termsUrl: "https://www.lusha.com/legal/terms_and_conditions-2/",
    featured: false,
    apps: [
      {
        id: "app-lusha-mcp",
        name: "Lusha",
        description: "Contact and company search and enrichment, over Lusha's MCP server with browser sign-in.",
        server: {
          name: "lusha",
          transport: "http",
          url: "https://mcp.lusha.com",
          auth: [{ id: "lusha-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "magicpatterns",
    name: "Magic Patterns",
    tagline: "AI UI prototypes",
    description:
      "Magic Patterns lets agents create and read UI designs and prototypes in the signed-in Magic Patterns account. Each user signs in to their own Magic Patterns account through the browser.",
    category: "design",
    creatorName: "Magic Patterns",
    version: "1.0.0",
    prompts: [
      { id: "prompt-dashboard", text: "Design a settings page for a project management app." },
      { id: "prompt-iterate", text: "Make the onboarding design simpler and use fewer steps." },
      { id: "prompt-code", text: "Get the code of my latest design so I can add it to the app." },
    ],
    websiteUrl: "https://www.magicpatterns.com",
    privacyPolicyUrl: "https://www.magicpatterns.com/docs/documentation/legal/privacy",
    termsUrl: "https://www.magicpatterns.com/docs/documentation/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-magicpatterns-mcp",
        name: "Magic Patterns",
        description: "UI design and prototype generation, over Magic Patterns' MCP server with browser sign-in.",
        server: {
          name: "magicpatterns",
          transport: "http",
          url: "https://mcp.magicpatterns.com/mcp",
          auth: [{ id: "magicpatterns-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "magnific",
    name: "Magnific",
    tagline: "AI image and video tools",
    description:
      "Magnific lets agents generate, upscale, and edit images and videos with the signed-in Magnific account. It needs a paid Magnific plan and uses the account's credits.",
    category: "design",
    creatorName: "Magnific",
    version: "1.0.0",
    prompts: [
      { id: "prompt-hero-image", text: "Generate a hero image of a calm workspace at sunrise." },
      { id: "prompt-upscale", text: "Upscale this product photo to 4K." },
      { id: "prompt-variations", text: "Make three style variations of this logo sketch." },
    ],
    websiteUrl: "https://www.magnific.com",
    privacyPolicyUrl: "https://www.magnific.com/legal/privacy",
    termsUrl: "https://www.magnific.com/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-magnific-mcp",
        name: "Magnific",
        description: "Image and video generation and upscaling, over Magnific's MCP server with browser sign-in.",
        server: {
          name: "magnific",
          transport: "http",
          url: "https://mcp.magnific.com",
          auth: [{ id: "magnific-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mailerlite",
    name: "MailerLite",
    tagline: "Email marketing",
    description:
      "MailerLite lets agents read subscribers, groups, campaigns, and automations, and draft campaigns in the signed-in MailerLite account. Each user signs in to their own MailerLite account through the browser.",
    category: "productivity",
    creatorName: "MailerLite",
    version: "1.0.0",
    prompts: [
      { id: "prompt-campaign-stats", text: "Compare the open and click rates of my last five campaigns." },
      { id: "prompt-groups", text: "How many active subscribers are in each group?" },
      { id: "prompt-draft-campaign", text: "Draft a newsletter about our new features, but do not send it." },
    ],
    websiteUrl: "https://www.mailerlite.com",
    privacyPolicyUrl: "https://www.mailerlite.com/legal/privacy-policy",
    termsUrl: "https://www.mailerlite.com/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-mailerlite-mcp",
        name: "MailerLite",
        description:
          "Subscribers, groups, campaigns, and automations, over MailerLite's MCP server with browser sign-in.",
        server: {
          name: "mailerlite",
          transport: "http",
          url: "https://mcp.mailerlite.com/mcp",
          auth: [{ id: "mailerlite-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "make",
    name: "Make",
    tagline: "Visual workflow automation",
    description:
      "Make lets agents list, read, and run the scenarios in the signed-in Make organization. Each user signs in to their own Make account through the browser.",
    category: "automation",
    creatorName: "Make",
    version: "1.0.0",
    prompts: [
      { id: "prompt-scenarios", text: "List my active scenarios and which ones failed this week." },
      { id: "prompt-explain", text: "Explain what my lead intake scenario does, step by step." },
      { id: "prompt-inputs", text: "Which inputs does my weekly report scenario need?" },
    ],
    websiteUrl: "https://www.make.com",
    privacyPolicyUrl: "https://www.make.com/privacy-notice",
    termsUrl: "https://www.make.com/terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-make-mcp",
        name: "Make",
        description: "Scenario search and runs, over Make's MCP server with browser sign-in.",
        server: {
          name: "make",
          transport: "http",
          url: "https://mcp.make.com/v2",
          auth: [{ id: "make-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "massive",
    name: "Massive",
    tagline: "Stock and crypto market data",
    description:
      "Massive lets agents read stock, options, forex, and crypto market data, such as prices, aggregates, and company details, with the signed-in Massive account. Each user signs in to their own Massive account through the browser.",
    category: "data-analytics",
    creatorName: "Massive",
    version: "1.0.0",
    prompts: [
      { id: "prompt-daily-bars", text: "Show the daily closing prices of AAPL for the last month." },
      { id: "prompt-compare", text: "Compare the year-to-date returns of SPY, QQQ, and IWM." },
      { id: "prompt-crypto", text: "What are the current price and 24-hour volume of Bitcoin?" },
    ],
    websiteUrl: "https://massive.com",
    privacyPolicyUrl: "https://massive.com/legal/privacy",
    termsUrl: "https://massive.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-massive-mcp",
        name: "Massive",
        description: "Stock, options, forex, and crypto market data, over Massive's MCP server with browser sign-in.",
        server: {
          name: "massive",
          transport: "http",
          url: "https://mcp.massive.com",
          auth: [{ id: "massive-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mem",
    name: "Mem",
    tagline: "Notes and collections",
    description:
      "Mem lets agents search, read, and create notes and organize them in collections. Each user signs in to their own Mem account through the browser.",
    category: "productivity",
    creatorName: "Mem",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-notes", text: "Find my notes about the Q3 planning meeting and summarize them." },
      { id: "prompt-new-note", text: "Create a note with the action items from this conversation." },
      { id: "prompt-collection", text: "List the notes in my Research collection from the last month." },
    ],
    websiteUrl: "https://mem.ai",
    privacyPolicyUrl: "https://mem.ai/privacy",
    termsUrl: "https://mem.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-mem-mcp",
        name: "Mem",
        description:
          "Note search, reading, note creation, and collections, over Mem's MCP server with browser sign-in.",
        server: {
          name: "mem",
          transport: "http",
          url: "https://mcp.mem.ai/mcp",
          auth: [{ id: "mem-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mercury",
    name: "Mercury",
    tagline: "Business bank accounts and transactions",
    description:
      "Mercury lets agents read account balances, transactions, cards, and recipients, and draft payment requests that need approval in Mercury. Each user signs in to their own Mercury account through the browser.",
    category: "other",
    creatorName: "Mercury",
    version: "1.0.0",
    prompts: [
      { id: "prompt-balances", text: "What are the current balances of my Mercury accounts?" },
      { id: "prompt-spend", text: "Summarize last month's card spending by category." },
      { id: "prompt-receipts", text: "Which transactions this month are missing a receipt or a note?" },
    ],
    websiteUrl: "https://mercury.com",
    privacyPolicyUrl: "https://mercury.com/legal/privacy",
    termsUrl: "https://mercury.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-mercury-mcp",
        name: "Mercury",
        description:
          "Balances, transactions, cards, and payment requests, over Mercury's MCP server with browser sign-in.",
        server: {
          name: "mercury",
          transport: "http",
          url: "https://mcp.mercury.com/mcp",
          auth: [{ id: "mercury-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "meta-ads",
    name: "Meta Ads",
    tagline: "Facebook and Instagram ad campaigns",
    description:
      "Meta Ads lets agents read campaign, ad set, and ad performance and draft changes to campaigns in the ad accounts the user can manage. Each user signs in to their own Meta account through the browser.",
    category: "data-analytics",
    creatorName: "Meta",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-performance",
        text: "How did my campaigns perform last week? Show spend, results, and cost per result.",
      },
      { id: "prompt-underperform", text: "Which ad sets have the highest cost per result this month?" },
      { id: "prompt-draft-ad", text: "Draft three headline and primary text options for a new spring sale ad." },
    ],
    websiteUrl: "https://www.facebook.com/business",
    privacyPolicyUrl: "https://www.facebook.com/privacy/policy/",
    termsUrl: "https://www.facebook.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-meta-ads-mcp",
        name: "Meta Ads",
        description: "Campaign reporting and campaign management, over Meta's MCP server with browser sign-in.",
        server: {
          name: "meta-ads",
          transport: "http",
          url: "https://mcp.facebook.com/ads",
          auth: [{ id: "meta-ads-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "metricool",
    name: "Metricool",
    tagline: "Social media analytics and planning",
    description:
      "Metricool lets agents read social media and ads analytics for connected brands and plan posts in the content calendar. Each user signs in to their own Metricool account through the browser.",
    category: "data-analytics",
    creatorName: "Metricool",
    version: "1.0.0",
    prompts: [
      { id: "prompt-best-posts", text: "Which of my Instagram posts had the most engagement last month?" },
      { id: "prompt-best-time", text: "What are the best times to post on LinkedIn for my brand?" },
      {
        id: "prompt-draft-post",
        text: "Draft a post for next Tuesday about our product update, but do not schedule it.",
      },
    ],
    websiteUrl: "https://metricool.com",
    privacyPolicyUrl: "https://metricool.com/privacy-policy/",
    termsUrl: "https://metricool.com/legal-terms/",
    featured: false,
    apps: [
      {
        id: "app-metricool-mcp",
        name: "Metricool",
        description: "Social analytics and post planning, over Metricool's MCP server with browser sign-in.",
        server: {
          name: "metricool",
          transport: "http",
          url: "https://ai.metricool.com/mcp",
          auth: [{ id: "metricool-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "miro",
    name: "Miro",
    tagline: "Boards, diagrams and docs",
    description:
      "Miro lets agents read board content and create diagrams, documents, and tables on boards the user can access. Each user signs in to their own Miro account through the browser.",
    category: "design",
    creatorName: "Miro",
    version: "1.0.0",
    prompts: [
      { id: "prompt-summarize-board", text: "Summarize the sticky notes on my retrospective board." },
      { id: "prompt-flowchart", text: "Create a flowchart of the user sign-up process on a new board." },
      { id: "prompt-board-to-spec", text: "Turn the ideas on this board into a short product spec." },
    ],
    websiteUrl: "https://miro.com",
    privacyPolicyUrl: "https://miro.com/legal/privacy-policy/",
    termsUrl: "https://miro.com/legal/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-miro-mcp",
        name: "Miro",
        description: "Board reading and diagram creation, over Miro's MCP server with browser sign-in.",
        server: {
          name: "miro",
          transport: "http",
          url: "https://mcp.miro.com/",
          auth: [{ id: "miro-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mixpanel",
    name: "Mixpanel",
    tagline: "Product analytics and reports",
    description:
      "Mixpanel lets agents query events, funnels, retention, and saved reports in the projects the user can access. Each user signs in to their own Mixpanel account through the browser.",
    category: "data-analytics",
    creatorName: "Mixpanel",
    version: "1.0.0",
    prompts: [
      { id: "prompt-signups", text: "How many sign-ups did we get each week this quarter?" },
      { id: "prompt-funnel", text: "Where do users drop off in the onboarding funnel?" },
      { id: "prompt-retention", text: "Compare 30-day retention for users from the last two releases." },
    ],
    websiteUrl: "https://mixpanel.com",
    privacyPolicyUrl: "https://mixpanel.com/legal/privacy-policy/",
    termsUrl: "https://mixpanel.com/legal/terms-of-use/",
    featured: false,
    apps: [
      {
        id: "app-mixpanel-mcp",
        name: "Mixpanel",
        description: "Event, funnel, and retention queries, over Mixpanel's MCP server with browser sign-in.",
        server: {
          name: "mixpanel",
          transport: "http",
          url: "https://mcp.mixpanel.com/mcp",
          auth: [{ id: "mixpanel-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mobbin",
    name: "Mobbin",
    tagline: "Real app UI references",
    description:
      "Mobbin lets agents search screens, flows, and UI elements from real mobile and web apps for design reference. Each user signs in to their own Mobbin account through the browser.",
    category: "design",
    creatorName: "Mobbin",
    version: "1.0.0",
    prompts: [
      { id: "prompt-onboarding", text: "Show me onboarding flows from popular finance apps." },
      { id: "prompt-paywall", text: "Find examples of paywall screens on iOS." },
      { id: "prompt-compare", text: "Compare how three travel apps design their search screen." },
    ],
    websiteUrl: "https://mobbin.com",
    privacyPolicyUrl: "https://mobbin.com/privacy",
    termsUrl: "https://mobbin.com/terms",
    featured: false,
    apps: [
      {
        id: "app-mobbin-mcp",
        name: "Mobbin",
        description: "Screen, flow, and UI element search, over Mobbin's MCP server with browser sign-in.",
        server: {
          name: "mobbin",
          transport: "http",
          url: "https://api.mobbin.com/mcp",
          auth: [{ id: "mobbin-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "monarch",
    name: "Monarch",
    tagline: "Personal finances and budgets",
    description:
      "Monarch lets agents read accounts, transactions, budgets, and cash flow in the user's Monarch account. Each user signs in to their own Monarch account through the browser.",
    category: "other",
    creatorName: "Monarch",
    version: "1.0.0",
    prompts: [
      { id: "prompt-spending", text: "How much did I spend on dining out last month?" },
      { id: "prompt-budget", text: "Which budget categories am I over this month?" },
      { id: "prompt-cash-flow", text: "Summarize my income and expenses for the last three months." },
    ],
    websiteUrl: "https://www.monarch.com",
    privacyPolicyUrl: "https://www.monarch.com/privacy",
    termsUrl: "https://www.monarch.com/terms",
    featured: false,
    apps: [
      {
        id: "app-monarch-mcp",
        name: "Monarch",
        description: "Accounts, transactions, budgets, and cash flow, over Monarch's MCP server with browser sign-in.",
        server: {
          name: "monarch",
          transport: "http",
          url: "https://api.monarch.com/mcp",
          auth: [{ id: "monarch-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "monday",
    name: "monday.com",
    tagline: "Boards, items and updates",
    description:
      "monday.com lets agents read boards and items, create and update items, and post updates in the workspaces the user can access. An account admin may need to install the monday MCP app first.",
    category: "productivity",
    creatorName: "monday.com",
    version: "1.0.0",
    prompts: [
      { id: "prompt-my-items", text: "What items are assigned to me and due this week?" },
      { id: "prompt-stuck", text: "Which items on the product roadmap board are stuck?" },
      {
        id: "prompt-new-item",
        text: "Create an item on the marketing board for the newsletter launch with a due date of Friday.",
      },
    ],
    websiteUrl: "https://monday.com",
    privacyPolicyUrl: "https://monday.com/l/privacy/privacy-policy/",
    termsUrl: "https://monday.com/l/legal/tos/",
    featured: false,
    apps: [
      {
        id: "app-monday-mcp",
        name: "monday.com",
        description:
          "Board and item reading, item creation, and updates, over monday.com's MCP server with browser sign-in.",
        server: {
          name: "monday",
          transport: "http",
          url: "https://mcp.monday.com/mcp",
          auth: [{ id: "monday-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mongodb",
    name: "MongoDB Atlas",
    tagline: "Atlas clusters and databases",
    description:
      "MongoDB Atlas lets agents list projects and clusters, inspect databases and collections, and run queries, in read-only or read-write mode as the organization owner allows. Each user signs in to their own MongoDB Atlas account through the browser.",
    category: "coding",
    creatorName: "MongoDB",
    version: "1.0.0",
    prompts: [
      { id: "prompt-clusters", text: "List the clusters in my Atlas projects and their status." },
      { id: "prompt-schema", text: "Describe the schema of the orders collection." },
      { id: "prompt-query", text: "Find the ten most recent orders with a status of pending." },
    ],
    websiteUrl: "https://www.mongodb.com",
    privacyPolicyUrl: "https://www.mongodb.com/legal/privacy/privacy-policy",
    termsUrl: "https://www.mongodb.com/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-mongodb-mcp",
        name: "MongoDB Atlas",
        description: "Cluster, database, and collection access, over MongoDB's MCP server with browser sign-in.",
        server: {
          name: "mongodb",
          transport: "http",
          url: "https://mcp.mongodb.com",
          auth: [{ id: "mongodb-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "moomoo",
    name: "moomoo",
    tagline: "Market quotes and brokerage account",
    description:
      "moomoo lets agents read market quotes, positions, and orders, and place orders in the signed-in brokerage account. Orders use real funds.",
    category: "data-analytics",
    creatorName: "moomoo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-quote", text: "What is the latest quote for AAPL and how did it move today?" },
      { id: "prompt-positions", text: "Summarize my current positions and their unrealized profit and loss." },
      { id: "prompt-orders", text: "List my open orders and recent fills." },
    ],
    websiteUrl: "https://www.moomoo.com",
    privacyPolicyUrl: "https://www.moomoo.com/privacy",
    termsUrl: "https://www.moomoo.com/terms",
    featured: false,
    apps: [
      {
        id: "app-moomoo-mcp",
        name: "moomoo",
        description: "Market data, positions, and orders, over moomoo's MCP server with browser sign-in.",
        server: {
          name: "moomoo",
          transport: "http",
          url: "https://mcp.moomoo.com/mcp",
          auth: [{ id: "moomoo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "mural",
    name: "Mural",
    tagline: "Canvases, stickies and diagrams",
    description:
      "Mural lets agents read murals and add sticky notes, text, and diagrams to them in the workspaces the user can access. Each user signs in to their own Mural account through the browser.",
    category: "design",
    creatorName: "Mural",
    version: "1.0.0",
    prompts: [
      { id: "prompt-summarize", text: "Summarize the ideas on my brainstorming mural." },
      { id: "prompt-cluster", text: "Group the sticky notes on this mural into themes." },
      { id: "prompt-journey", text: "Create a customer journey map for our checkout on a new mural." },
    ],
    websiteUrl: "https://www.mural.co",
    privacyPolicyUrl: "https://www.mural.co/terms/privacy-statement",
    termsUrl: "https://www.mural.co/terms/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-mural-mcp",
        name: "Mural",
        description: "Mural reading and canvas editing, over Mural's MCP server with browser sign-in.",
        server: {
          name: "mural",
          transport: "http",
          url: "https://mcp-canvas.mural.co/mcp",
          auth: [{ id: "mural-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "navan",
    name: "Navan",
    tagline: "Travel and expense data",
    description:
      "Navan lets agents read travel and expense data such as spend summaries, transactions, and policy details. Each user signs in to their own Navan account through the browser.",
    category: "data-analytics",
    creatorName: "Navan",
    version: "1.0.0",
    prompts: [
      { id: "prompt-travel-spend", text: "What did our team spend on travel last quarter?" },
      { id: "prompt-out-of-policy", text: "List expenses from last month that are out of policy." },
      { id: "prompt-top-vendors", text: "Which hotels and airlines did we spend the most on this year?" },
    ],
    websiteUrl: "https://navan.com",
    privacyPolicyUrl: "https://navan.com/privacy",
    termsUrl: "https://navan.com/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-navan-mcp",
        name: "Navan",
        description: "Travel and expense reporting, over Navan's MCP server with browser sign-in.",
        server: {
          name: "navan",
          transport: "http",
          url: "https://mcp.navan.com/mcp",
          auth: [{ id: "navan-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "northbeam",
    name: "Northbeam",
    tagline: "Marketing attribution data",
    description:
      "Northbeam lets agents read attributed revenue, spend, and return on ad spend across marketing channels and campaigns. Each user signs in to their own Northbeam account through the browser.",
    category: "data-analytics",
    creatorName: "Northbeam",
    version: "1.0.0",
    prompts: [
      { id: "prompt-roas", text: "What was ROAS by channel over the last 30 days?" },
      { id: "prompt-campaigns", text: "Which Meta campaigns drove the most attributed revenue last week?" },
      { id: "prompt-spend-trend", text: "Compare spend and revenue this month with last month." },
    ],
    websiteUrl: "https://www.northbeam.io",
    privacyPolicyUrl: "https://www.northbeam.io/privacy",
    termsUrl: "https://www.northbeam.io/terms-conditions",
    featured: false,
    apps: [
      {
        id: "app-northbeam-mcp",
        name: "Northbeam",
        description: "Attribution and channel performance reporting, over Northbeam's MCP server with browser sign-in.",
        server: {
          name: "northbeam",
          transport: "http",
          url: "https://mcp.northbeam.io",
          auth: [{ id: "northbeam-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "omneky",
    name: "Omneky",
    tagline: "AI ad creative generation",
    description:
      "Omneky lets agents read brand data and generate image and video ad creatives. Generation uses Omneky credits.",
    category: "design",
    creatorName: "Omneky",
    version: "1.0.0",
    prompts: [
      { id: "prompt-brand", text: "Summarize the brand guidelines saved in my Omneky account." },
      { id: "prompt-image-ads", text: "Generate three image ad options for our summer sale." },
      { id: "prompt-ad-copy", text: "Draft headlines for a video ad about our new product." },
    ],
    websiteUrl: "https://www.omneky.com",
    privacyPolicyUrl: "https://www.omneky.com/privacy-policy",
    termsUrl: "https://www.omneky.com/terms",
    featured: false,
    apps: [
      {
        id: "app-omneky-mcp",
        name: "Omneky",
        description: "Brand data and ad creative generation, over Omneky's MCP server with browser sign-in.",
        server: {
          name: "omneky",
          transport: "http",
          url: "https://mcp.omneky.com/mcp",
          auth: [{ id: "omneky-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "openart",
    name: "OpenArt",
    tagline: "AI images and videos",
    description:
      "OpenArt lets agents generate and edit images and videos with AI models. Generation uses OpenArt credits.",
    category: "design",
    creatorName: "OpenArt",
    version: "1.0.0",
    prompts: [
      { id: "prompt-image", text: "Generate a watercolor illustration of a lighthouse at sunset." },
      { id: "prompt-video", text: "Make a short video of this product photo rotating slowly." },
      { id: "prompt-variations", text: "Create three style variations of my last image." },
    ],
    websiteUrl: "https://openart.ai",
    privacyPolicyUrl: "https://openart.ai/privacy/",
    termsUrl: "https://openart.ai/terms/",
    featured: false,
    apps: [
      {
        id: "app-openart-mcp",
        name: "OpenArt",
        description: "Image and video generation, over OpenArt's MCP server with browser sign-in.",
        server: {
          name: "openart",
          transport: "http",
          url: "https://mcp.openart.ai/mcp",
          auth: [{ id: "openart-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "opusclip",
    name: "OpusClip",
    tagline: "Short clips from long videos",
    description:
      "OpusClip lets agents turn long videos into short clips and read the clips and projects in the user's account. Each user signs in to their own OpusClip account through the browser.",
    category: "design",
    creatorName: "OpusClip",
    version: "1.0.0",
    prompts: [
      { id: "prompt-clip", text: "Make short clips from this podcast episode link." },
      { id: "prompt-projects", text: "List my recent projects and their status." },
      { id: "prompt-best-clips", text: "Which clips from my last project have the highest virality score?" },
    ],
    websiteUrl: "https://www.opus.pro",
    privacyPolicyUrl: "https://www.opus.pro/privacy-policy",
    termsUrl: "https://www.opus.pro/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-opusclip-mcp",
        name: "OpusClip",
        description: "Clip generation and project access, over OpusClip's MCP server with browser sign-in.",
        server: {
          name: "opusclip",
          transport: "http",
          url: "https://mcp.opus.pro/mcp",
          auth: [{ id: "opusclip-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "otter",
    name: "Otter.ai",
    tagline: "Meeting transcripts and notes",
    description:
      "Otter.ai lets agents search and read meeting transcripts and summaries in the user's Otter account. Access is read-only.",
    category: "productivity",
    creatorName: "Otter.ai",
    version: "1.0.0",
    prompts: [
      { id: "prompt-last-meeting", text: "Summarize my last meeting and list the action items." },
      { id: "prompt-search", text: "Find meetings this month where pricing was discussed." },
      { id: "prompt-follow-up", text: "Draft a follow-up email from yesterday's customer call." },
    ],
    websiteUrl: "https://otter.ai",
    privacyPolicyUrl: "https://otter.ai/privacy-policy",
    termsUrl: "https://otter.ai/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-otter-mcp",
        name: "Otter.ai",
        description: "Meeting search and transcript reading, over Otter.ai's MCP server with browser sign-in.",
        server: {
          name: "otter",
          transport: "http",
          url: "https://mcp.otter.ai/mcp",
          auth: [{ id: "otter-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "pandadoc",
    name: "PandaDoc",
    tagline: "Documents, proposals and e-signatures",
    description:
      "PandaDoc lets agents list documents and templates, check document status, and create documents from templates. Each user signs in to their own PandaDoc account through the browser.",
    category: "documents",
    creatorName: "PandaDoc",
    version: "1.0.0",
    prompts: [
      { id: "prompt-status", text: "Which of my documents are waiting for a signature?" },
      { id: "prompt-templates", text: "List my proposal templates." },
      { id: "prompt-draft", text: "Create a draft proposal for Acme Corp from my standard template." },
    ],
    websiteUrl: "https://www.pandadoc.com",
    privacyPolicyUrl: "https://www.pandadoc.com/legal/privacy-notice/",
    termsUrl: "https://www.pandadoc.com/legal/master-services-agreement/",
    featured: false,
    apps: [
      {
        id: "app-pandadoc-mcp",
        name: "PandaDoc",
        description:
          "Document and template access and document creation, over PandaDoc's MCP server with browser sign-in.",
        server: {
          name: "pandadoc",
          transport: "http",
          url: "https://mcp.pandadoc.com/v1/mcp",
          auth: [{ id: "pandadoc-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "parallel",
    name: "Parallel",
    tagline: "Web search and extraction",
    description:
      "Parallel lets agents search the web, extract content from pages, and answer questions from current web evidence. Search and page extraction need no account and no key.",
    category: "research",
    creatorName: "Parallel Web Systems",
    version: "1.0.0",
    prompts: [
      { id: "prompt-search", text: "Find the latest release notes for PostgreSQL and summarize the new features." },
      { id: "prompt-extract", text: "Extract the pricing table from this page." },
      {
        id: "prompt-question",
        text: "Which European countries have adopted the eIDAS 2.0 digital wallet so far? Cite sources.",
      },
    ],
    websiteUrl: "https://parallel.ai",
    privacyPolicyUrl: "https://parallel.ai/privacy-policy",
    termsUrl: "https://parallel.ai/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-parallel-mcp",
        name: "Parallel",
        description:
          "Web search, page extraction, and web-grounded answers, over the Parallel MCP server with no sign-in.",
        server: { name: "parallel", transport: "http", url: "https://mcp.parallel.ai/mcp" },
      },
    ],
  },
  {
    slug: "pennylane",
    name: "Pennylane",
    tagline: "Accounting and invoices",
    description:
      "Pennylane lets agents read accounting data such as invoices, transactions, and ledger entries. Access is read-only.",
    category: "other",
    creatorName: "Pennylane",
    version: "1.0.0",
    prompts: [
      { id: "prompt-unpaid", text: "List customer invoices that are overdue." },
      { id: "prompt-expenses", text: "Summarize supplier expenses by category for last quarter." },
      { id: "prompt-revenue", text: "How did revenue this month compare with the same month last year?" },
    ],
    websiteUrl: "https://www.pennylane.com",
    privacyPolicyUrl: "https://www.pennylane.com/fr/legal/privacy",
    termsUrl: "https://www.pennylane.com/fr/conditions-generales",
    featured: false,
    apps: [
      {
        id: "app-pennylane-mcp",
        name: "Pennylane",
        description: "Invoice, transaction, and ledger reading, over Pennylane's MCP server with browser sign-in.",
        server: {
          name: "pennylane",
          transport: "http",
          url: "https://mcp.pennylane.com/mcp",
          auth: [{ id: "pennylane-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "picsart",
    name: "Picsart",
    tagline: "AI image, video and audio tools",
    description:
      "Picsart lets agents generate and edit images, videos, and audio with AI tools such as background removal and upscaling. Some tools use Picsart credits.",
    category: "design",
    creatorName: "Picsart",
    version: "1.0.0",
    prompts: [
      { id: "prompt-remove-bg", text: "Remove the background from this product photo." },
      { id: "prompt-upscale", text: "Upscale this image to twice its size." },
      { id: "prompt-generate", text: "Generate a banner image for a coffee shop opening." },
    ],
    websiteUrl: "https://picsart.com",
    privacyPolicyUrl: "https://picsart.com/privacy-policy/",
    termsUrl: "https://picsart.com/terms-of-use/",
    featured: false,
    apps: [
      {
        id: "app-picsart-mcp",
        name: "Picsart",
        description: "Image, video, and audio generation and editing, over Picsart's MCP server with browser sign-in.",
        server: {
          name: "picsart",
          transport: "http",
          url: "https://api.picsart.com/gen-ai/mcp",
          auth: [{ id: "picsart-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "pipedrive",
    name: "Pipedrive",
    tagline: "Sales CRM deals and contacts",
    description:
      "Pipedrive lets agents search and read deals, contacts, and activities, and create and update records in the user's CRM. Each user signs in to their own Pipedrive account through the browser.",
    category: "productivity",
    creatorName: "Pipedrive",
    version: "1.0.0",
    prompts: [
      { id: "prompt-pipeline", text: "Summarize my open deals by stage and value." },
      { id: "prompt-stale", text: "Which deals have had no activity in the last two weeks?" },
      { id: "prompt-activity", text: "Add a follow-up call activity for the Acme deal next Monday." },
    ],
    websiteUrl: "https://www.pipedrive.com",
    privacyPolicyUrl: "https://www.pipedrive.com/en/privacy",
    termsUrl: "https://www.pipedrive.com/en/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-pipedrive-mcp",
        name: "Pipedrive",
        description: "Deal, contact, and activity management, over Pipedrive's MCP server with browser sign-in.",
        server: {
          name: "pipedrive",
          transport: "http",
          url: "https://mcp.pipedrive.ai/mcp",
          auth: [{ id: "pipedrive-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "planetscale",
    name: "PlanetScale",
    tagline: "Databases, branches and query insights",
    description:
      "PlanetScale lets agents list databases and branches, read schemas and query insights, and run queries as the organization admin allows. Each user signs in to their own PlanetScale account through the browser.",
    category: "coding",
    creatorName: "PlanetScale",
    version: "1.0.0",
    prompts: [
      { id: "prompt-databases", text: "List my databases and their branches." },
      { id: "prompt-slow-queries", text: "Which queries were the slowest on the main branch this week?" },
      { id: "prompt-schema", text: "Show the schema of the users table on the main branch." },
    ],
    websiteUrl: "https://planetscale.com",
    privacyPolicyUrl: "https://planetscale.com/legal/privacy",
    termsUrl: "https://planetscale.com/legal/agreement",
    featured: false,
    apps: [
      {
        id: "app-planetscale-mcp",
        name: "PlanetScale",
        description:
          "Database, branch, schema, and query insight access, over PlanetScale's MCP server with browser sign-in.",
        server: {
          name: "planetscale",
          transport: "http",
          url: "https://mcp.pscale.dev/mcp/planetscale",
          auth: [{ id: "planetscale-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "planningcenter",
    name: "Planning Center",
    tagline: "Church people, services and groups",
    description:
      "Planning Center lets agents read people, service plans, groups, registrations, check-ins, calendar, and giving data in the user's organization. Each user signs in to their own Planning Center account through the browser.",
    category: "productivity",
    creatorName: "Planning Center",
    version: "1.0.0",
    prompts: [
      { id: "prompt-sunday", text: "Who is scheduled to serve this Sunday, and who has not confirmed?" },
      { id: "prompt-checkins", text: "How did check-in attendance change over the last two months?" },
      { id: "prompt-groups", text: "List the groups that meet on weekday evenings." },
    ],
    websiteUrl: "https://www.planningcenter.com",
    privacyPolicyUrl: "https://www.planningcenter.com/privacy",
    termsUrl: "https://www.planningcenter.com/terms",
    featured: false,
    apps: [
      {
        id: "app-planningcenter-mcp",
        name: "Planning Center",
        description:
          "People, services, groups, and giving data, over Planning Center's MCP server with browser sign-in.",
        server: {
          name: "planningcenter",
          transport: "http",
          url: "https://mcp.planningcenteronline.com/mcp",
          auth: [{ id: "planningcenter-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "plaud",
    name: "Plaud",
    tagline: "Recordings, transcripts and summaries",
    description:
      "Plaud lets agents search recordings and read transcripts and AI summaries from the user's Plaud account. Each user signs in to their own Plaud account through the browser.",
    category: "productivity",
    creatorName: "Plaud",
    version: "1.0.0",
    prompts: [
      { id: "prompt-latest", text: "Summarize my most recent recording." },
      { id: "prompt-search", text: "Find recordings from this week that mention the budget." },
      { id: "prompt-notes", text: "Draft meeting notes from yesterday's recording with decisions and action items." },
    ],
    websiteUrl: "https://www.plaud.ai",
    privacyPolicyUrl: "https://www.plaud.ai/policies/privacy-policy",
    termsUrl: "https://www.plaud.ai/policies/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-plaud-mcp",
        name: "Plaud",
        description: "Recording search, transcripts, and summaries, over Plaud's MCP server with browser sign-in.",
        server: {
          name: "plaud",
          transport: "http",
          url: "https://mcp.plaud.ai/mcp",
          auth: [{ id: "plaud-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "postman",
    name: "Postman",
    tagline: "API collections and workspaces",
    description:
      "Postman lets agents read and update workspaces, collections, environments, and API specifications in the user's Postman account. Each user signs in to their own Postman account through the browser.",
    category: "coding",
    creatorName: "Postman",
    version: "1.0.0",
    prompts: [
      { id: "prompt-collections", text: "List the collections in my team workspace." },
      { id: "prompt-document", text: "Write documentation for the requests in my Payments API collection." },
      { id: "prompt-new-request", text: "Add a GET request for /users/{id} to my Users collection." },
    ],
    websiteUrl: "https://www.postman.com",
    privacyPolicyUrl: "https://www.postman.com/legal/privacy-policy/",
    termsUrl: "https://www.postman.com/legal/terms/",
    featured: false,
    apps: [
      {
        id: "app-postman-mcp",
        name: "Postman",
        description:
          "Workspace, collection, environment, and spec access, over Postman's MCP server with browser sign-in.",
        server: {
          name: "postman",
          transport: "http",
          url: "https://mcp.postman.com/mcp",
          auth: [{ id: "postman-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "profound",
    name: "Profound",
    tagline: "AI search visibility analytics",
    description:
      "Profound lets agents read how a brand appears in AI answer engines, including visibility, citations, and prompt data. Each user signs in to their own Profound account through the browser.",
    category: "data-analytics",
    creatorName: "Profound",
    version: "1.0.0",
    prompts: [
      { id: "prompt-visibility", text: "How did our brand visibility in AI answers change this month?" },
      { id: "prompt-citations", text: "Which domains are cited most often in answers about our category?" },
      { id: "prompt-competitors", text: "Compare our visibility with our top three competitors." },
    ],
    websiteUrl: "https://www.tryprofound.com",
    privacyPolicyUrl: "https://www.tryprofound.com/legal/privacy-policy",
    termsUrl: "https://www.tryprofound.com/legal/master-subscription-agreement",
    featured: false,
    apps: [
      {
        id: "app-profound-mcp",
        name: "Profound",
        description: "Visibility, citation, and prompt reporting, over Profound's MCP server with browser sign-in.",
        server: {
          name: "profound",
          transport: "http",
          url: "https://mcp.tryprofound.com/mcp",
          auth: [{ id: "profound-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "public",
    name: "Public",
    tagline: "Brokerage accounts and trading",
    description:
      "Public lets agents read the accounts, portfolio, order history and market quotes of a Public customer, and preview and place orders. Each user signs in to their own Public account through the browser, and an order placed through it is a real order with real money.",
    category: "data-analytics",
    creatorName: "Public",
    version: "1.0.0",
    prompts: [
      { id: "prompt-portfolio", text: "Summarize my Public portfolio and how it moved today." },
      { id: "prompt-quotes", text: "What are the latest quotes for AAPL and MSFT?" },
      { id: "prompt-orders", text: "Which of my orders filled this week?" },
    ],
    websiteUrl: "https://public.com",
    privacyPolicyUrl: "https://public.com/privacy-policy",
    termsUrl: "https://public.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-public-mcp",
        name: "Public",
        description: "Accounts, portfolio, market data and orders, over Public's MCP server with browser sign-in.",
        server: {
          name: "public",
          transport: "http",
          url: "https://mcp.public.com/mcp",
          auth: [{ id: "public-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "pylon",
    name: "Pylon",
    tagline: "Customer support issues",
    description:
      "Pylon lets agents look up and update support issues, accounts, and contacts in the signed-in user's Pylon workspace. A Pylon admin must turn on MCP access for the workspace first.",
    category: "productivity",
    creatorName: "Pylon",
    version: "1.0.0",
    prompts: [
      { id: "prompt-waiting", text: "Which high-priority issues are still waiting on our reply?" },
      { id: "prompt-account-issues", text: "Summarize the open issues for the Acme account." },
      { id: "prompt-draft-reply", text: "Draft a reply to the newest issue about login errors." },
    ],
    websiteUrl: "https://www.usepylon.com",
    privacyPolicyUrl: "https://www.usepylon.com/legal/privacy",
    termsUrl: "https://www.usepylon.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-pylon-mcp",
        name: "Pylon",
        description: "Support issues, accounts, and contacts, over Pylon's MCP server with browser sign-in.",
        server: {
          name: "pylon",
          transport: "http",
          url: "https://mcp.usepylon.com",
          auth: [{ id: "pylon-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "qonto",
    name: "Qonto",
    tagline: "Business banking and cards",
    description:
      "Qonto lets agents read business accounts, balances, cards, and transactions, and act on Qonto data within the permissions of the signed-in user. Each user signs in to their own Qonto account through the browser.",
    category: "other",
    creatorName: "Qonto",
    version: "1.0.0",
    prompts: [
      { id: "prompt-balances", text: "What is the balance of each of my Qonto accounts?" },
      { id: "prompt-missing-receipts", text: "List last month's card transactions that have no receipt." },
      { id: "prompt-spend-categories", text: "Summarize our spending by category this quarter." },
    ],
    websiteUrl: "https://qonto.com",
    privacyPolicyUrl: "https://legal.qonto.com/en#template-6uiwuhdde",
    termsUrl: "https://legal.qonto.com/en",
    featured: false,
    apps: [
      {
        id: "app-qonto-mcp",
        name: "Qonto",
        description: "Accounts, cards, and transactions, over Qonto's MCP server with browser sign-in.",
        server: {
          name: "qonto",
          transport: "http",
          url: "https://mcp.qonto.com/mcp",
          auth: [{ id: "qonto-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "quo",
    name: "Quo",
    tagline: "Business phone calls and texts",
    description:
      "Quo (formerly OpenPhone) lets agents read calls, texts, call transcripts, and contacts in the signed-in user's Quo workspace, and send messages. Each user signs in to their own Quo account through the browser.",
    category: "productivity",
    creatorName: "Quo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-missed-calls", text: "Summarize the calls I missed yesterday." },
      { id: "prompt-last-call", text: "What did the customer say in my last call with Jordan?" },
      { id: "prompt-draft-text", text: "Draft a text reply to the newest unread message." },
    ],
    websiteUrl: "https://www.quo.com",
    privacyPolicyUrl: "https://www.quo.com/privacy",
    termsUrl: "https://www.quo.com/terms",
    featured: false,
    apps: [
      {
        id: "app-quo-mcp",
        name: "Quo",
        description: "Calls, messages, transcripts, and contacts, over Quo's MCP server with browser sign-in.",
        server: {
          name: "quo",
          transport: "http",
          url: "https://mcp.quo.com/mcp",
          auth: [{ id: "quo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "raindrop",
    name: "Raindrop.io",
    tagline: "Bookmarks and highlights",
    description:
      "Raindrop.io lets agents search, save, and organize the bookmarks, collections, tags, and highlights of the signed-in user. The MCP server is in beta and needs a Raindrop.io Pro plan.",
    category: "productivity",
    creatorName: "Raindrop.io",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-saved", text: "Find my saved articles about TypeScript performance." },
      { id: "prompt-untagged", text: "Which bookmarks in my Unsorted collection have no tags?" },
      { id: "prompt-highlights", text: "Summarize the highlights I saved this month." },
    ],
    websiteUrl: "https://raindrop.io",
    privacyPolicyUrl: "https://help.raindrop.io/privacy",
    termsUrl: "https://help.raindrop.io/terms",
    featured: false,
    apps: [
      {
        id: "app-raindrop-mcp",
        name: "Raindrop.io",
        description:
          "Bookmarks, collections, tags, and highlights, over Raindrop.io's MCP server with browser sign-in.",
        server: {
          name: "raindrop",
          transport: "http",
          url: "https://api.raindrop.io/rest/v2/ai/mcp",
          auth: [{ id: "raindrop-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ramp",
    name: "Ramp",
    tagline: "Spend, cards, and bills",
    description:
      "Ramp lets agents work with spend data such as transactions, cards, and bills as the signed-in user, within that user's permissions. At sign-in the user chooses full or read-only access.",
    category: "other",
    creatorName: "Ramp",
    version: "1.0.0",
    prompts: [
      { id: "prompt-missing-receipts", text: "Which of my card transactions this month are missing receipts?" },
      { id: "prompt-department-spend", text: "Summarize company card spend by department for last quarter." },
      { id: "prompt-bills", text: "Which bills are due in the next two weeks?" },
    ],
    websiteUrl: "https://ramp.com",
    privacyPolicyUrl: "https://ramp.com/legal/privacy-policy",
    termsUrl: "https://ramp.com/legal/platform-agreement",
    featured: false,
    apps: [
      {
        id: "app-ramp-mcp",
        name: "Ramp",
        description: "Transactions, cards, and bills, over Ramp's MCP server with browser sign-in.",
        server: {
          name: "ramp",
          transport: "http",
          url: "https://mcp.ramp.com/mcp",
          auth: [{ id: "ramp-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "readai",
    name: "Read AI",
    tagline: "Meeting reports and transcripts",
    description:
      "Read AI lets agents search and read the meeting reports, summaries, transcripts, and action items of the signed-in user. Each user signs in to their own Read AI account through the browser.",
    category: "productivity",
    creatorName: "Read AI",
    version: "1.0.0",
    prompts: [
      { id: "prompt-yesterday", text: "Summarize my meetings from yesterday." },
      { id: "prompt-action-items", text: "What action items were assigned to me this week?" },
      { id: "prompt-decision", text: "What did we decide about the launch date in the last product sync?" },
    ],
    websiteUrl: "https://www.read.ai",
    privacyPolicyUrl: "https://www.read.ai/privacy-policy",
    termsUrl: "https://www.read.ai/termsofservice",
    featured: false,
    apps: [
      {
        id: "app-readai-mcp",
        name: "Read AI",
        description: "Meeting reports, transcripts, and action items, over Read AI's MCP server with browser sign-in.",
        server: {
          name: "readai",
          transport: "http",
          url: "https://api.read.ai/mcp",
          auth: [{ id: "readai-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "readwise",
    name: "Readwise",
    tagline: "Highlights and saved reading",
    description:
      "Readwise lets agents search the highlights of the signed-in user and read the documents saved in Readwise Reader. Each user signs in to their own Readwise account through the browser.",
    category: "research",
    creatorName: "Readwise",
    version: "1.0.0",
    prompts: [
      { id: "prompt-topic-highlights", text: "Find my highlights about habit formation." },
      { id: "prompt-unread", text: "What did I save to Reader this week that I have not read yet?" },
      { id: "prompt-book-summary", text: "Summarize the highlights from the last book I finished." },
    ],
    websiteUrl: "https://readwise.io",
    privacyPolicyUrl: "https://readwise.io/privacy-policy",
    termsUrl: "https://readwise.io/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-readwise-mcp",
        name: "Readwise",
        description: "Highlights and Reader documents, over Readwise's MCP server with browser sign-in.",
        server: {
          name: "readwise",
          transport: "http",
          url: "https://mcp2.readwise.io/mcp",
          auth: [{ id: "readwise-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "refero",
    name: "Refero",
    tagline: "UI design references",
    description:
      "Refero lets agents search a library of screens, flows, and styles from real apps and websites for design reference. It needs a Refero Pro subscription.",
    category: "design",
    creatorName: "Refero",
    version: "1.0.0",
    prompts: [
      { id: "prompt-onboarding", text: "Find onboarding screens from fintech apps." },
      { id: "prompt-pricing", text: "Show me pricing pages that have a monthly and yearly toggle." },
      { id: "prompt-empty-states", text: "Find empty state designs for a task manager." },
    ],
    websiteUrl: "https://refero.design",
    privacyPolicyUrl: "https://doc.refero.design/legal/privacy-policy",
    termsUrl: "https://doc.refero.design/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-refero-mcp",
        name: "Refero",
        description: "Design reference search, over Refero's MCP server with browser sign-in.",
        server: {
          name: "refero",
          transport: "http",
          url: "https://api.refero.design/mcp",
          auth: [{ id: "refero-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "restream",
    name: "Restream",
    tagline: "Live streams and recordings",
    description:
      "Restream lets agents read and manage streaming events, destinations, recordings, clips, and stream analytics in the account of the signed-in user. Each user signs in to their own Restream account through the browser.",
    category: "productivity",
    creatorName: "Restream",
    version: "1.0.0",
    prompts: [
      { id: "prompt-upcoming", text: "List my upcoming scheduled streams." },
      { id: "prompt-viewers", text: "Which of my destinations had the most viewers on my last stream?" },
      { id: "prompt-recordings", text: "Find the recordings of my streams from last week." },
    ],
    websiteUrl: "https://restream.io",
    privacyPolicyUrl: "https://restream.io/privacy-policy",
    termsUrl: "https://restream.io/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-restream-mcp",
        name: "Restream",
        description:
          "Events, destinations, recordings, and analytics, over Restream's MCP server with browser sign-in.",
        server: {
          name: "restream",
          transport: "http",
          url: "https://mcp.restream.io/mcp",
          auth: [{ id: "restream-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "riverside",
    name: "Riverside",
    tagline: "Recordings, clips, and transcripts",
    description:
      "Riverside lets agents search recording transcripts, make clips, and edit recordings in the studios of the signed-in user. It needs a Riverside Grow plan or higher.",
    category: "design",
    creatorName: "Riverside",
    version: "1.0.0",
    prompts: [
      { id: "prompt-find-topic", text: "Find where my guest talked about pricing in last week's episode." },
      { id: "prompt-clip-ideas", text: "Suggest three short clips from my latest recording." },
      { id: "prompt-transcript-summary", text: "Summarize the transcript of my most recent recording." },
    ],
    websiteUrl: "https://riverside.com",
    privacyPolicyUrl: "https://riverside.com/privacy-policy",
    termsUrl: "https://riverside.com/terms-conditions",
    featured: false,
    apps: [
      {
        id: "app-riverside-mcp",
        name: "Riverside",
        description: "Recordings, clips, and transcripts, over Riverside's MCP server with browser sign-in.",
        server: {
          name: "riverside",
          transport: "http",
          url: "https://mcp.riverside.com/mcp",
          auth: [{ id: "riverside-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "roam",
    name: "Roam Research",
    tagline: "Graph notes and pages",
    description:
      "Roam Research lets agents search, read, and add blocks and pages in the Roam graphs of the signed-in user. Each user signs in to their own Roam account through the browser.",
    category: "productivity",
    creatorName: "Roam Research",
    version: "1.0.0",
    prompts: [
      { id: "prompt-daily-notes", text: "What did I write in my daily notes this week?" },
      { id: "prompt-backlinks", text: "Find all blocks that link to [[Project Atlas]]." },
      { id: "prompt-add-notes", text: "Add a block with today's meeting notes to my daily page." },
    ],
    websiteUrl: "https://roamresearch.com",
    privacyPolicyUrl: "https://roamresearch.com/#/app/help/page/bnQcAUM0i",
    termsUrl: "https://roamresearch.com/#/app/help/page/MHRK1dgTE",
    featured: false,
    apps: [
      {
        id: "app-roam-mcp",
        name: "Roam Research",
        description: "Graph search, pages, and blocks, over Roam Research's MCP server with browser sign-in.",
        server: {
          name: "roam",
          transport: "http",
          url: "https://mcp.roamresearch.com/mcp",
          auth: [{ id: "roam-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "runpod",
    name: "Runpod",
    tagline: "GPU pods and serverless",
    description:
      "Runpod lets agents list and manage pods, serverless endpoints, templates, and network volumes in the account of the signed-in user. Pods and endpoints that an agent creates use account credit.",
    category: "coding",
    creatorName: "Runpod",
    version: "1.0.0",
    prompts: [
      { id: "prompt-running-pods", text: "List my running pods and their GPU types." },
      { id: "prompt-volumes", text: "Which network volumes do I have, and in which data centers?" },
      { id: "prompt-templates", text: "Show the templates I have created." },
    ],
    websiteUrl: "https://www.runpod.io",
    privacyPolicyUrl: "https://www.runpod.io/legal/privacy-policy",
    termsUrl: "https://www.runpod.io/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-runpod-mcp",
        name: "Runpod",
        description:
          "Pods, serverless endpoints, templates, and volumes, over Runpod's MCP server with browser sign-in.",
        server: {
          name: "runpod",
          transport: "http",
          url: "https://mcp.runpod.io/",
          auth: [{ id: "runpod-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "runway",
    name: "Runway",
    tagline: "AI image and video generation",
    description:
      "Runway lets agents generate images and videos with Runway models in the account of the signed-in user. Each generation uses account credits.",
    category: "design",
    creatorName: "Runway",
    version: "1.0.0",
    prompts: [
      { id: "prompt-product-image", text: "Generate a square product image of a ceramic mug on a wooden table." },
      { id: "prompt-short-video", text: "Make a 5-second video of a paper boat in the rain." },
      { id: "prompt-image-to-video", text: "Turn this image into a short video with a slow camera pan." },
    ],
    websiteUrl: "https://runway.com",
    privacyPolicyUrl: "https://runway.com/privacy-policy",
    termsUrl: "https://runway.com/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-runway-mcp",
        name: "Runway",
        description: "Image and video generation, over Runway's MCP server with browser sign-in.",
        server: {
          name: "runway",
          transport: "http",
          url: "https://mcp.runwayml.com/mcp",
          auth: [{ id: "runway-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ryze",
    name: "Ryze AI",
    tagline: "Ad campaign analytics",
    description:
      "Ryze AI lets agents read and analyze Google Ads and Meta Ads campaign performance in the ad accounts that the signed-in user connects to Ryze AI.",
    category: "data-analytics",
    creatorName: "Ryze AI",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-cost-per-conversion",
        text: "Which Google Ads campaigns had the highest cost per conversion last week?",
      },
      { id: "prompt-meta-roas", text: "Compare Meta Ads spend and ROAS for the last 30 days." },
      { id: "prompt-low-performers", text: "Which ad sets perform poorly enough that I should review them?" },
    ],
    websiteUrl: "https://www.get-ryze.ai",
    privacyPolicyUrl: "https://www.get-ryze.ai/privacy",
    termsUrl: "https://www.get-ryze.ai/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-ryze-mcp",
        name: "Ryze AI",
        description: "Google Ads and Meta Ads analytics, over Ryze AI's MCP server with browser sign-in.",
        server: {
          name: "ryze",
          transport: "http",
          url: "https://connector.get-ryze.ai/mcp",
          auth: [{ id: "ryze-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "salesloft",
    name: "Salesloft",
    tagline: "Sales pipeline and cadences",
    description:
      "Salesloft lets agents read people, accounts, cadences, calls, and deals in the Salesloft workspace of the signed-in user. Each user signs in to their own Salesloft account through the browser.",
    category: "productivity",
    creatorName: "Salesloft",
    version: "1.0.0",
    prompts: [
      { id: "prompt-stale-deals", text: "Which of my deals have had no activity in two weeks?" },
      { id: "prompt-call-summary", text: "Summarize my last call with the Acme account." },
      { id: "prompt-replies", text: "Which people in my cadences replied this week?" },
    ],
    websiteUrl: "https://www.salesloft.com",
    privacyPolicyUrl: "https://www.salesloft.com/legal/privacy-policies",
    termsUrl: "https://www.salesloft.com/legal/msa",
    featured: false,
    apps: [
      {
        id: "app-salesloft-mcp",
        name: "Salesloft",
        description: "People, accounts, cadences, calls, and deals, over Salesloft's MCP server with browser sign-in.",
        server: {
          name: "salesloft",
          transport: "http",
          url: "https://mcp.salesloft.com/mcp",
          auth: [{ id: "salesloft-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "sanity",
    name: "Sanity",
    tagline: "Content queries and documents",
    description:
      "Sanity lets agents run GROQ queries, read and edit documents, and search the Sanity docs in the projects of the signed-in user. Each user signs in to their own Sanity account through the browser.",
    category: "coding",
    creatorName: "Sanity",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recent-posts", text: "List the blog posts published this month in my production dataset." },
      { id: "prompt-groq", text: "Write a GROQ query for all products that have no image." },
      { id: "prompt-draft-doc", text: 'Draft a new article document titled "Spring release notes".' },
    ],
    websiteUrl: "https://www.sanity.io",
    privacyPolicyUrl: "https://www.sanity.io/legal/privacy",
    termsUrl: "https://www.sanity.io/legal/tos",
    featured: false,
    apps: [
      {
        id: "app-sanity-mcp",
        name: "Sanity",
        description: "GROQ queries, documents, and docs search, over Sanity's MCP server with browser sign-in.",
        server: {
          name: "sanity",
          transport: "http",
          url: "https://mcp.sanity.io",
          auth: [{ id: "sanity-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "scrapecreators",
    name: "Scrape Creators",
    tagline: "Public social media data",
    description:
      "Scrape Creators lets agents read public profiles, posts, and comments from social platforms such as TikTok, Instagram, and YouTube. At sign-in the user enters a Scrape Creators API key in the browser, and each request uses account credits.",
    category: "research",
    creatorName: "Scrape Creators",
    version: "1.0.0",
    prompts: [
      { id: "prompt-latest-posts", text: "Get the latest 10 posts from the @nasa Instagram account." },
      { id: "prompt-followers", text: "Compare the TikTok follower counts of @nike and @adidas." },
      { id: "prompt-channel-videos", text: "Summarize the latest videos on the MKBHD YouTube channel." },
    ],
    websiteUrl: "https://scrapecreators.com",
    privacyPolicyUrl: "https://scrapecreators.com/privacy",
    termsUrl: "https://scrapecreators.com/terms",
    featured: false,
    apps: [
      {
        id: "app-scrapecreators-mcp",
        name: "Scrape Creators",
        description: "Public social media profiles and posts, over Scrape Creators' MCP server with browser sign-in.",
        server: {
          name: "scrapecreators",
          transport: "http",
          url: "https://api.scrapecreators.com/mcp",
          auth: [{ id: "scrapecreators-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "searchatlas",
    name: "Search Atlas",
    tagline: "SEO, content, and ads data",
    description:
      "Search Atlas lets agents read SEO, site audit, content, and PPC data in the Search Atlas account of the signed-in user.",
    category: "research",
    creatorName: "Search Atlas",
    version: "1.0.0",
    prompts: [
      { id: "prompt-lost-rank", text: "Which keywords for my site lost rank this week?" },
      { id: "prompt-audit", text: "Summarize the top issues from my latest site audit." },
      { id: "prompt-outline", text: "Draft an outline for a blog post about local SEO." },
    ],
    websiteUrl: "https://searchatlas.com",
    privacyPolicyUrl: "https://searchatlas.com/privacy-policy/",
    termsUrl: "https://searchatlas.com/terms-of-use/",
    featured: false,
    apps: [
      {
        id: "app-searchatlas-mcp",
        name: "Search Atlas",
        description: "SEO, site audit, content, and PPC data, over Search Atlas' MCP server with browser sign-in.",
        server: {
          name: "searchatlas",
          transport: "http",
          url: "https://mcp.searchatlas.com/mcp",
          auth: [{ id: "searchatlas-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "semrush",
    name: "Semrush",
    tagline: "SEO and traffic data",
    description:
      "Semrush lets agents read keyword, domain, backlink, and traffic data with the Semrush account of the signed-in user. Requests use the API units of that account.",
    category: "research",
    creatorName: "Semrush",
    version: "1.0.0",
    prompts: [
      { id: "prompt-competitors", text: "Which domains compete with notion.so in organic search?" },
      { id: "prompt-long-tail", text: "Find long-tail keywords about running shoes that have low difficulty." },
      { id: "prompt-backlinks", text: "Compare the backlink profiles of asana.com and monday.com." },
    ],
    websiteUrl: "https://www.semrush.com",
    privacyPolicyUrl: "https://www.semrush.com/company/legal/privacy-policy/",
    termsUrl: "https://www.semrush.com/company/legal/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-semrush-mcp",
        name: "Semrush",
        description: "Keyword, domain, backlink, and traffic data, over Semrush's MCP server with browser sign-in.",
        server: {
          name: "semrush",
          transport: "http",
          url: "https://mcp.semrush.com/v2/mcp",
          auth: [{ id: "semrush-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "seranking",
    name: "SE Ranking",
    tagline: "SEO data and site audits",
    description:
      "SE Ranking lets agents read keyword, backlink, competitor, and site audit data with the SE Ranking account of the signed-in user.",
    category: "research",
    creatorName: "SE Ranking",
    version: "1.0.0",
    prompts: [
      { id: "prompt-rankings", text: "How did my tracked keywords move this week?" },
      { id: "prompt-competitor-keywords", text: "Which keywords does my top competitor rank for that I do not?" },
      { id: "prompt-audit-errors", text: "List the most serious errors from my latest site audit." },
    ],
    websiteUrl: "https://seranking.com",
    privacyPolicyUrl: "https://seranking.com/legal/privacy-statement.html",
    termsUrl: "https://seranking.com/legal/terms-of-service.html",
    featured: false,
    apps: [
      {
        id: "app-seranking-mcp",
        name: "SE Ranking",
        description:
          "Keyword, backlink, competitor, and audit data, over SE Ranking's MCP server with browser sign-in.",
        server: {
          name: "seranking",
          transport: "http",
          url: "https://api.seranking.com/mcp",
          auth: [{ id: "seranking-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "servicem8",
    name: "ServiceM8",
    tagline: "Field service jobs",
    description:
      "ServiceM8 lets agents look up and update jobs, clients, quotes, and schedules in the ServiceM8 account of the signed-in user.",
    category: "productivity",
    creatorName: "ServiceM8",
    version: "1.0.0",
    prompts: [
      { id: "prompt-tomorrow", text: "Which jobs are scheduled for tomorrow?" },
      { id: "prompt-open-quotes", text: "List the quotes sent this month that are not accepted yet." },
      { id: "prompt-job-note", text: "Draft a job note for the plumbing repair at 12 King Street." },
    ],
    websiteUrl: "https://www.servicem8.com",
    privacyPolicyUrl: "https://www.servicem8.com/privacy-policy",
    termsUrl: "https://www.servicem8.com/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-servicem8-mcp",
        name: "ServiceM8",
        description: "Jobs, clients, quotes, and scheduling, over ServiceM8's MCP server with browser sign-in.",
        server: {
          name: "servicem8",
          transport: "http",
          url: "https://api.servicem8.com/mcp",
          auth: [{ id: "servicem8-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "smartlead",
    name: "Smartlead",
    tagline: "Cold email campaigns",
    description:
      "Smartlead lets agents read and manage email campaigns, leads, and sending accounts, and check campaign statistics and deliverability, in the Smartlead account of the signed-in user.",
    category: "automation",
    creatorName: "Smartlead",
    version: "1.0.0",
    prompts: [
      { id: "prompt-reply-rates", text: "Which campaigns had the highest reply rate last week?" },
      { id: "prompt-warmup", text: "Which of my email accounts have warmup problems?" },
      {
        id: "prompt-draft-sequence",
        text: "Draft a three-step follow-up sequence for a new campaign, but do not start it.",
      },
    ],
    websiteUrl: "https://www.smartlead.ai",
    privacyPolicyUrl: "https://www.smartlead.ai/privacy-policy",
    termsUrl: "https://www.smartlead.ai/new-terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-smartlead-mcp",
        name: "Smartlead",
        description: "Campaigns, leads, and deliverability, over Smartlead's MCP server with browser sign-in.",
        server: {
          name: "smartlead",
          transport: "http",
          url: "https://mcp.smartlead.ai/mcp",
          auth: [{ id: "smartlead-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "snaptrade",
    name: "SnapTrade",
    tagline: "Brokerage portfolio data",
    description:
      "SnapTrade lets agents read balances, positions, orders, and account activity from the brokerage accounts that the signed-in user connects to SnapTrade. This server is read-only and cannot place trades.",
    category: "data-analytics",
    creatorName: "SnapTrade",
    version: "1.0.0",
    prompts: [
      { id: "prompt-positions", text: "Summarize my positions across all my connected brokerage accounts." },
      { id: "prompt-balances", text: "How much cash is in each of my brokerage accounts?" },
      { id: "prompt-activity", text: "What dividends did I receive last month?" },
    ],
    websiteUrl: "https://snaptrade.com",
    privacyPolicyUrl: "https://snaptrade.com/privacy-policy",
    termsUrl: "https://snaptrade.com/terms-and-conditions",
    featured: false,
    apps: [
      {
        id: "app-snaptrade-mcp",
        name: "SnapTrade",
        description: "Balances, positions, orders, and activity, over SnapTrade's MCP server with browser sign-in.",
        server: {
          name: "snaptrade",
          transport: "http",
          url: "https://agent.snaptrade.com/mcp/portfolio",
          auth: [{ id: "snaptrade-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "sonarqube",
    name: "SonarQube Cloud",
    tagline: "Code quality and security issues",
    description:
      "SonarQube Cloud lets agents read issues, security hotspots, quality gate status, and metrics for projects in the organizations of the signed-in user. This address is for the EU region of SonarQube Cloud.",
    category: "coding",
    creatorName: "SonarSource",
    version: "1.0.0",
    prompts: [
      { id: "prompt-quality-gate", text: "Did the quality gate pass on the main branch of my project?" },
      { id: "prompt-critical-issues", text: "List the critical issues in my project that are still open." },
      { id: "prompt-hotspot", text: "Explain the newest security hotspot in my project and suggest a fix." },
    ],
    websiteUrl: "https://www.sonarsource.com/products/sonarqube/cloud/",
    privacyPolicyUrl: "https://www.sonarsource.com/company/privacy/",
    termsUrl: "https://www.sonarsource.com/legal/sonarcloud/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-sonarqube-mcp",
        name: "SonarQube Cloud",
        description:
          "Issues, security hotspots, and quality gates, over SonarQube Cloud's MCP server with browser sign-in.",
        server: {
          name: "sonarqube",
          transport: "http",
          url: "https://api.sonarcloud.io/mcp",
          auth: [{ id: "sonarqube-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "spacefast",
    name: "Spacefast",
    tagline: "Publish pages as Spaces",
    description:
      "Spacefast lets agents publish websites, reports, and dashboards as Spaces, and list and update the Spaces of the signed-in user.",
    category: "productivity",
    creatorName: "Automattic",
    version: "1.0.0",
    prompts: [
      { id: "prompt-publish-report", text: "Publish this report as a Space." },
      { id: "prompt-list-spaces", text: "List my Spaces and when each was last updated." },
      { id: "prompt-bakery-site", text: "Make a one-page website for my bakery and publish it as a Space." },
    ],
    websiteUrl: "https://spacefast.com",
    privacyPolicyUrl: "https://automattic.com/privacy/",
    termsUrl: "https://automattic.com/tos/",
    featured: false,
    apps: [
      {
        id: "app-spacefast-mcp",
        name: "Spacefast",
        description: "Space publishing and updates, over Spacefast's MCP server with browser sign-in.",
        server: {
          name: "spacefast",
          transport: "http",
          url: "https://mcp.spacefast.com",
          auth: [{ id: "spacefast-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "speko",
    name: "Speko",
    tagline: "Voice AI agents",
    description:
      "Speko lets agents build and manage voice AI agents, and read their calls, sessions, knowledge bases, and evaluations, in the Speko account of the signed-in user.",
    category: "automation",
    creatorName: "Speko",
    version: "1.0.0",
    prompts: [
      { id: "prompt-list-agents", text: "List my voice agents and their phone numbers." },
      { id: "prompt-today-calls", text: "Summarize the calls my support agent handled today." },
      { id: "prompt-draft-prompt", text: "Draft a system prompt for a voice agent that books dental appointments." },
    ],
    websiteUrl: "https://speko.ai",
    privacyPolicyUrl: "https://speko.ai/privacy-policy",
    termsUrl: "https://speko.ai/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-speko-mcp",
        name: "Speko",
        description: "Voice agents, calls, and knowledge bases, over Speko's MCP server with browser sign-in.",
        server: {
          name: "speko",
          transport: "http",
          url: "https://mcp.speko.ai/mcp",
          auth: [{ id: "speko-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "square",
    name: "Square",
    tagline: "Payments, orders, and catalog",
    description:
      "Square lets agents read and manage payments, orders, catalog items, customers, and inventory in the Square account of the signed-in seller.",
    category: "other",
    creatorName: "Block",
    version: "1.0.0",
    prompts: [
      { id: "prompt-sales", text: "What were my total sales yesterday?" },
      { id: "prompt-low-stock", text: "Which catalog items are low in stock?" },
      { id: "prompt-regulars", text: "Which customers visited more than five times this month?" },
    ],
    websiteUrl: "https://squareup.com",
    privacyPolicyUrl: "https://squareup.com/us/en/legal/general/privacy",
    termsUrl: "https://squareup.com/us/en/legal/general/ua",
    featured: false,
    apps: [
      {
        id: "app-square-mcp",
        name: "Square",
        description: "Payments, orders, catalog, and customers, over Square's MCP server with browser sign-in.",
        server: {
          name: "square",
          transport: "http",
          url: "https://mcp.squareup.com/mcp",
          auth: [{ id: "square-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "statsig",
    name: "Statsig",
    tagline: "Feature gates and experiments",
    description:
      "Statsig lets agents look up feature gates, dynamic configs, experiments, and metrics in a Statsig project, and draft changes that the project's review rules still apply to. Each user signs in to their own Statsig account through the browser.",
    category: "coding",
    creatorName: "Statsig",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-stale-gates",
        text: "Which feature gates have been fully rolled out for more than a month and can be cleaned up?",
      },
      { id: "prompt-experiment-results", text: "Summarize the results of the checkout experiment so far." },
      {
        id: "prompt-gate-draft",
        text: "Draft a new feature gate for the beta search page that targets internal users only.",
      },
    ],
    websiteUrl: "https://statsig.com",
    privacyPolicyUrl: "https://statsig.com/privacy",
    termsUrl: "https://statsig.com/terms",
    featured: false,
    apps: [
      {
        id: "app-statsig-mcp",
        name: "Statsig",
        description:
          "Feature gate, experiment, and metric lookup and edits, over Statsig's MCP server with browser sign-in.",
        server: {
          name: "statsig",
          transport: "http",
          url: "https://api.statsig.com/v3/mcp",
          auth: [{ id: "statsig-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "sunsama",
    name: "Sunsama",
    tagline: "Daily planning and tasks",
    description:
      "Sunsama lets agents read the daily plan, create and update tasks and subtasks, and organize them into channels. Each user signs in to their own Sunsama account through the browser.",
    category: "productivity",
    creatorName: "Sunsama",
    version: "1.0.0",
    prompts: [
      { id: "prompt-today", text: "What is on my plan for today, and how much time is planned?" },
      { id: "prompt-backlog", text: "Which tasks in my backlog have no time estimate?" },
      {
        id: "prompt-add-task",
        text: "Add a task for tomorrow to review the quarterly budget, with a 30 minute estimate.",
      },
    ],
    websiteUrl: "https://www.sunsama.com",
    privacyPolicyUrl: "https://www.sunsama.com/privacy",
    termsUrl: "https://www.sunsama.com/terms",
    featured: false,
    apps: [
      {
        id: "app-sunsama-mcp",
        name: "Sunsama",
        description: "Daily plan, task, and subtask management, over Sunsama's MCP server with browser sign-in.",
        server: {
          name: "sunsama",
          transport: "http",
          url: "https://api.sunsama.com/mcp",
          auth: [{ id: "sunsama-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "superhuman",
    name: "Superhuman Mail",
    tagline: "Email and calendar",
    description:
      "Superhuman Mail lets agents search the inbox, read threads, draft replies, and look up calendar events in the signed-in Superhuman account. Drafts appear in Superhuman Mail for the user to review.",
    category: "productivity",
    creatorName: "Superhuman",
    version: "1.0.0",
    prompts: [
      { id: "prompt-inbox-summary", text: "Summarize the unread emails from this morning that need a reply." },
      { id: "prompt-find-thread", text: "Find the latest thread with the design agency about the launch date." },
      { id: "prompt-draft-reply", text: "Draft a reply to Anna that proposes a meeting on Thursday afternoon." },
    ],
    websiteUrl: "https://superhuman.com",
    privacyPolicyUrl: "https://superhuman.com/legal/privacy-policy",
    termsUrl: "https://superhuman.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-superhuman-mcp",
        name: "Superhuman Mail",
        description:
          "Inbox search, thread reading, reply drafts, and calendar lookup, over Superhuman's MCP server with browser sign-in.",
        server: {
          name: "superhuman",
          transport: "http",
          url: "https://mcp.mail.superhuman.com/mcp",
          auth: [{ id: "superhuman-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "superme",
    name: "SuperMe",
    tagline: "Advice from experienced people",
    description:
      "SuperMe lets agents ask questions to AI profiles that professionals train on their own writing and work, and get answers based on their experience. Each user signs in to their own SuperMe account through the browser.",
    category: "research",
    creatorName: "SuperMe",
    version: "1.0.0",
    prompts: [
      { id: "prompt-pricing-advice", text: "Ask people who have run B2B startups how they set their first prices." },
      {
        id: "prompt-hiring",
        text: "What do experienced engineering managers say about hiring the first platform engineer?",
      },
      {
        id: "prompt-fundraise",
        text: "Find people who have raised a seed round and summarize their advice on investor updates.",
      },
    ],
    websiteUrl: "https://www.superme.ai",
    privacyPolicyUrl: "https://www.superme.ai/privacy",
    termsUrl: "https://www.superme.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-superme-mcp",
        name: "SuperMe",
        description: "Questions to experts' AI profiles, over SuperMe's MCP server with browser sign-in.",
        server: {
          name: "superme",
          transport: "http",
          url: "https://mcp.superme.ai/mcp",
          auth: [{ id: "superme-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "supermemory",
    name: "Supermemory",
    tagline: "Memory across conversations",
    description:
      "Supermemory lets agents save facts and preferences, and recall them later in other conversations and tools. Each user signs in to their own Supermemory account through the browser.",
    category: "productivity",
    creatorName: "Supermemory",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recall", text: "What do you remember about my preferences for code reviews?" },
      { id: "prompt-save", text: "Remember that the staging database moves to the new region next week." },
      { id: "prompt-project", text: "What did we decide about the onboarding project last month?" },
    ],
    websiteUrl: "https://supermemory.ai",
    privacyPolicyUrl: "https://supermemory.ai/privacy/",
    termsUrl: "https://supermemory.ai/terms/",
    featured: false,
    apps: [
      {
        id: "app-supermemory-mcp",
        name: "Supermemory",
        description: "Memory save and recall, over Supermemory's MCP server with browser sign-in.",
        server: {
          name: "supermemory",
          transport: "http",
          url: "https://mcp.supermemory.ai/mcp",
          auth: [{ id: "supermemory-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "svelte",
    name: "Svelte",
    tagline: "Svelte and SvelteKit docs",
    description:
      "Svelte gives agents the current Svelte 5 and SvelteKit documentation, checks Svelte components for issues, and makes Playground links. It needs no account and no key.",
    category: "coding",
    creatorName: "Svelte",
    version: "1.0.0",
    prompts: [
      { id: "prompt-runes", text: "How do I migrate this component from stores to runes?" },
      { id: "prompt-autofix", text: "Check this Svelte component for problems and suggest fixes." },
      { id: "prompt-load", text: "How do I load data on the server in a SvelteKit page?" },
    ],
    websiteUrl: "https://svelte.dev",
    privacyPolicyUrl: null,
    termsUrl: null,
    featured: false,
    apps: [
      {
        id: "app-svelte-mcp",
        name: "Svelte",
        description:
          "Svelte documentation, component checks, and Playground links, over the Svelte MCP server with no sign-in.",
        server: { name: "svelte", transport: "http", url: "https://mcp.svelte.dev/mcp" },
      },
    ],
  },
  {
    slug: "syncro",
    name: "Syncro",
    tagline: "MSP tickets and assets",
    description:
      "Syncro lets agents read and update tickets, customers, assets, and invoices in the Syncro PSA and RMM account. Each user signs in to their own Syncro account through the browser.",
    category: "productivity",
    creatorName: "Syncro",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-tickets", text: "Which open tickets have had no update for three days?" },
      { id: "prompt-customer-assets", text: "List the assets for the customer Acme Dental and their last check-in." },
      { id: "prompt-ticket-note", text: "Draft a note on the printer ticket that summarizes the steps taken so far." },
    ],
    websiteUrl: "https://syncrosecure.com",
    privacyPolicyUrl: "https://syncrosecure.com/privacy-policy/",
    termsUrl: "https://syncrosecure.com/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-syncro-mcp",
        name: "Syncro",
        description: "Ticket, customer, asset, and invoice access, over Syncro's MCP server with browser sign-in.",
        server: {
          name: "syncro",
          transport: "http",
          url: "https://mcp.services.syncromsp.com/mcp/stream",
          auth: [{ id: "syncro-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "tableau",
    name: "Tableau",
    tagline: "Tableau Cloud analytics",
    description:
      "Tableau lets agents find published data sources, query them, and read workbooks, views, and Pulse metrics on Tableau Cloud with the permissions of the signed-in user. Each user signs in to their own Tableau Cloud site through the browser.",
    category: "data-analytics",
    creatorName: "Tableau",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-sales-region",
        text: "Which region had the highest sales last quarter in the Superstore data source?",
      },
      { id: "prompt-find-dashboard", text: "Find the dashboards about customer churn and tell me who owns them." },
      { id: "prompt-metric-trend", text: "How did the weekly active users metric change over the last month?" },
    ],
    websiteUrl: "https://www.tableau.com",
    privacyPolicyUrl: "https://www.salesforce.com/company/privacy/",
    termsUrl: "https://www.tableau.com/legal",
    featured: false,
    apps: [
      {
        id: "app-tableau-mcp",
        name: "Tableau",
        description:
          "Data source queries, workbook and view lookup, and Pulse metrics, over Tableau's MCP server with browser sign-in.",
        server: {
          name: "tableau",
          transport: "http",
          url: "https://mcp.tableau.com",
          auth: [{ id: "tableau-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "tavily",
    name: "Tavily",
    tagline: "Web search for agents",
    description:
      "Tavily lets agents search the web, extract the content of pages, and crawl or map a site. Each user signs in to their own Tavily account through the browser, and searches use that account's credits.",
    category: "research",
    creatorName: "Tavily",
    version: "1.0.0",
    prompts: [
      { id: "prompt-news", text: "Search for this week's news about EU AI regulation and summarize it with sources." },
      { id: "prompt-extract", text: "Extract the pricing table from the vendor's pricing page." },
      { id: "prompt-site-map", text: "Map the documentation site and list the pages about authentication." },
    ],
    websiteUrl: "https://www.tavily.com",
    privacyPolicyUrl: "https://www.tavily.com/privacy",
    termsUrl: "https://www.tavily.com/terms",
    featured: false,
    apps: [
      {
        id: "app-tavily-mcp",
        name: "Tavily",
        description: "Web search, page extraction, and site crawling, over Tavily's MCP server with browser sign-in.",
        server: {
          name: "tavily",
          transport: "http",
          url: "https://mcp.tavily.com/mcp",
          auth: [{ id: "tavily-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "tessie",
    name: "Tessie",
    tagline: "Tesla vehicle data",
    description:
      "Tessie lets agents read the state of the user's Tesla vehicles, such as battery, charging, location, and drive history, and send vehicle commands that the account allows. Each user signs in to their own Tessie account through the browser.",
    category: "other",
    creatorName: "Tessie",
    version: "1.0.0",
    prompts: [
      { id: "prompt-battery", text: "What is my car's battery level and range right now?" },
      { id: "prompt-drives", text: "Summarize my drives from last week, with distance and energy used." },
      { id: "prompt-charging", text: "How much did I charge at home this month?" },
    ],
    websiteUrl: "https://www.tessie.com",
    privacyPolicyUrl: "https://www.tessie.com/privacy",
    termsUrl: "https://www.tessie.com/terms",
    featured: false,
    apps: [
      {
        id: "app-tessie-mcp",
        name: "Tessie",
        description:
          "Vehicle state, drive history, and vehicle commands, over Tessie's MCP server with browser sign-in.",
        server: {
          name: "tessie",
          transport: "http",
          url: "https://mcp.tessie.com",
          auth: [{ id: "tessie-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "tinyfish",
    name: "TinyFish",
    tagline: "Web search and browsing",
    description:
      "TinyFish lets agents search the web, fetch pages, and run browser agents that navigate sites and extract data. Each user signs in to their own TinyFish account through the browser, and browser and agent runs use that account's credits.",
    category: "automation",
    creatorName: "TinyFish",
    version: "1.0.0",
    prompts: [
      { id: "prompt-compare-prices", text: "Compare the listed prices for this laptop model on three retail sites." },
      { id: "prompt-extract-list", text: "Collect the names and dates of upcoming events from this conference site." },
      { id: "prompt-search", text: "Search for recent reviews of standing desks and summarize them." },
    ],
    websiteUrl: "https://www.tinyfish.ai",
    privacyPolicyUrl: "https://www.tinyfish.ai/privacy-policy",
    termsUrl: "https://www.tinyfish.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-tinyfish-mcp",
        name: "TinyFish",
        description: "Web search, page fetch, and browser agents, over TinyFish's MCP server with browser sign-in.",
        server: {
          name: "tinyfish",
          transport: "http",
          url: "https://agent.tinyfish.ai/mcp",
          auth: [{ id: "tinyfish-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "tradingview",
    name: "TradingView",
    tagline: "Market data and analytics",
    description:
      "TradingView lets agents read market data and analytics for symbols, such as prices and technical indicators, with the signed-in TradingView account. It does not place trades.",
    category: "data-analytics",
    creatorName: "TradingView",
    version: "1.0.0",
    prompts: [
      { id: "prompt-symbol-overview", text: "Give me an overview of AAPL's price action over the last month." },
      { id: "prompt-indicators", text: "What do the RSI and moving averages show for BTCUSD on the daily chart?" },
      { id: "prompt-compare", text: "Compare the year-to-date performance of the S&P 500 and the Nasdaq 100." },
    ],
    websiteUrl: "https://www.tradingview.com",
    privacyPolicyUrl: "https://www.tradingview.com/privacy-policy/",
    termsUrl: "https://www.tradingview.com/policies/",
    featured: false,
    apps: [
      {
        id: "app-tradingview-mcp",
        name: "TradingView",
        description: "Market data and technical analysis, over TradingView's MCP server with browser sign-in.",
        server: {
          name: "tradingview",
          transport: "http",
          url: "https://mcp.tradingview.com/mcp",
          auth: [{ id: "tradingview-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "transcriptapi",
    name: "TranscriptAPI",
    tagline: "YouTube transcripts",
    description:
      "TranscriptAPI lets agents get the transcripts of YouTube videos and search YouTube videos and channels. Each user signs in to their own TranscriptAPI account through the browser, and requests use that account's credits.",
    category: "research",
    creatorName: "TranscriptAPI",
    version: "1.0.0",
    prompts: [
      { id: "prompt-summarize-video", text: "Get the transcript of this YouTube video and summarize the main points." },
      { id: "prompt-quotes", text: "Find what the speaker says about pricing in this talk, with timestamps." },
      { id: "prompt-channel-videos", text: "List the latest videos from this channel and their topics." },
    ],
    websiteUrl: "https://transcriptapi.com",
    privacyPolicyUrl: "https://transcriptapi.com/privacy",
    termsUrl: "https://transcriptapi.com/terms",
    featured: false,
    apps: [
      {
        id: "app-transcriptapi-mcp",
        name: "TranscriptAPI",
        description: "YouTube transcripts and video search, over TranscriptAPI's MCP server with browser sign-in.",
        server: {
          name: "transcriptapi",
          transport: "http",
          url: "https://transcriptapi.com/mcp",
          auth: [{ id: "transcriptapi-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "truthifi",
    name: "Truthifi",
    tagline: "Investment account insights",
    description:
      "Truthifi lets agents read the user's linked investment accounts, holdings, fees, and performance. Access is read-only, and each user signs in to their own Truthifi account through the browser.",
    category: "data-analytics",
    creatorName: "Truthifi",
    version: "1.0.0",
    prompts: [
      { id: "prompt-allocation", text: "What is my current asset allocation across all accounts?" },
      { id: "prompt-fees", text: "Which of my funds have the highest fees?" },
      { id: "prompt-performance", text: "How did my portfolio perform this year compared with last year?" },
    ],
    websiteUrl: "https://truthifi.com",
    privacyPolicyUrl: "https://truthifi.com/privacy",
    termsUrl: "https://truthifi.com/terms",
    featured: false,
    apps: [
      {
        id: "app-truthifi-mcp",
        name: "Truthifi",
        description: "Read-only investment account data, over Truthifi's MCP server with browser sign-in.",
        server: {
          name: "truthifi",
          transport: "http",
          url: "https://api.truthifi.com/mcp",
          auth: [{ id: "truthifi-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "turso",
    name: "Turso",
    tagline: "Turso Cloud databases",
    description:
      "Turso lets agents list and manage databases in a Turso Cloud account and run SQL against them. Each user signs in to their own Turso account through the browser.",
    category: "coding",
    creatorName: "Turso",
    version: "1.0.0",
    prompts: [
      { id: "prompt-list-dbs", text: "List my Turso databases and the regions they run in." },
      { id: "prompt-schema", text: "Show the schema of the tables in the app database." },
      { id: "prompt-query", text: "How many users signed up in the last seven days, from the users table?" },
    ],
    websiteUrl: "https://turso.tech",
    privacyPolicyUrl: "https://turso.tech/privacy-policy",
    termsUrl: "https://turso.tech/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-turso-mcp",
        name: "Turso",
        description: "Database management and SQL queries, over Turso's MCP server with browser sign-in.",
        server: {
          name: "turso",
          transport: "http",
          url: "https://mcp.turso.ai/mcp",
          auth: [{ id: "turso-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "twilio-docs",
    name: "Twilio Docs",
    tagline: "Twilio API documentation",
    description:
      "Twilio Docs lets agents search the Twilio documentation and read full parameter schemas for Twilio API operations, such as Messaging, Voice, and Verify. It needs no account and no key.",
    category: "coding",
    creatorName: "Twilio",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-send-sms",
        text: "What parameters does the Twilio API need to send an SMS with a status callback?",
      },
      { id: "prompt-verify", text: "How do I start and check a phone verification with Twilio Verify?" },
      { id: "prompt-a2p", text: "What do I need to register for A2P 10DLC messaging in the US?" },
    ],
    websiteUrl: "https://www.twilio.com",
    privacyPolicyUrl: "https://www.twilio.com/en-us/legal/privacy",
    termsUrl: "https://www.twilio.com/en-us/legal/tos",
    featured: false,
    apps: [
      {
        id: "app-twilio-docs-mcp",
        name: "Twilio Docs",
        description: "Twilio documentation and API schema lookup, over the Twilio MCP server with no sign-in.",
        server: { name: "twilio-docs", transport: "http", url: "https://mcp.twilio.com/docs" },
      },
    ],
  },
  {
    slug: "typeform",
    name: "Typeform",
    tagline: "Forms and responses",
    description:
      "Typeform lets agents create and edit forms, and read and analyze form responses in the signed-in account. Each user signs in to their own Typeform account through the browser.",
    category: "productivity",
    creatorName: "Typeform",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-summarize-responses",
        text: "Summarize the responses to the customer feedback form from this month.",
      },
      { id: "prompt-draft-form", text: "Draft a five-question event registration form." },
      { id: "prompt-low-scores", text: "Which respondents gave a score below 6, and what did they say?" },
    ],
    websiteUrl: "https://www.typeform.com",
    privacyPolicyUrl: "https://www.typeform.com/legal/privacy-policy/",
    termsUrl: "https://www.typeform.com/legal/service-terms-and-conditions/",
    featured: false,
    apps: [
      {
        id: "app-typeform-mcp",
        name: "Typeform",
        description: "Form creation and response analysis, over Typeform's MCP server with browser sign-in.",
        server: {
          name: "typeform",
          transport: "http",
          url: "https://api.typeform.com/mcp",
          auth: [{ id: "typeform-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "typefully",
    name: "Typefully",
    tagline: "Social post drafts",
    description:
      "Typefully lets agents write and edit drafts, manage the posting queue, and schedule posts for the signed-in user's social accounts. Each user signs in to their own Typefully account through the browser.",
    category: "productivity",
    creatorName: "Typefully",
    version: "1.0.0",
    prompts: [
      { id: "prompt-thread-draft", text: "Draft a thread about what we shipped this week from these release notes." },
      { id: "prompt-queue", text: "What posts are in my queue for the next seven days?" },
      { id: "prompt-rewrite", text: "Rewrite my latest draft to be shorter and clearer." },
    ],
    websiteUrl: "https://typefully.com",
    privacyPolicyUrl: "https://typefully.com/privacy",
    termsUrl: "https://typefully.com/terms",
    featured: false,
    apps: [
      {
        id: "app-typefully-mcp",
        name: "Typefully",
        description:
          "Draft writing, queue management, and scheduling, over Typefully's MCP server with browser sign-in.",
        server: {
          name: "typefully",
          transport: "http",
          url: "https://mcp.typefully.com/mcp",
          auth: [{ id: "typefully-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ubersuggest",
    name: "Ubersuggest",
    tagline: "SEO keyword research",
    description:
      "Ubersuggest lets agents read keyword ideas, search volume, domain traffic, backlinks, and site audit data. Access is read-only, and each user signs in to their own Ubersuggest account through the browser.",
    category: "data-analytics",
    creatorName: "NP Digital",
    version: "1.0.0",
    prompts: [
      { id: "prompt-keywords", text: "Find keyword ideas for project management software with their search volume." },
      { id: "prompt-competitor", text: "What are the top pages of a competitor's domain by estimated traffic?" },
      { id: "prompt-backlinks", text: "Summarize the backlinks of my site and the strongest referring domains." },
    ],
    websiteUrl: "https://ubersuggest.com",
    privacyPolicyUrl: "https://npdigital.com/privacy-notice/",
    termsUrl: "https://neilpatel.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-ubersuggest-mcp",
        name: "Ubersuggest",
        description:
          "Keyword, traffic, backlink, and site audit data, over NP Digital's MCP server with browser sign-in.",
        server: {
          name: "ubersuggest",
          transport: "http",
          url: "https://ubersuggest-mcp.neilpatelapi.com/mcp",
          auth: [{ id: "ubersuggest-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "upwork",
    name: "Upwork",
    tagline: "Freelance jobs and talent",
    description:
      "Upwork lets agents search jobs and freelancers, draft job posts, and review proposals and contracts in the signed-in Upwork account. Each user signs in to their own Upwork account through the browser.",
    category: "other",
    creatorName: "Upwork",
    version: "1.0.0",
    prompts: [
      {
        id: "prompt-find-talent",
        text: "Find freelance React developers with strong reviews and a rate under $80 per hour.",
      },
      { id: "prompt-draft-job", text: "Draft a job post for a two-week logo design project." },
      { id: "prompt-proposals", text: "Summarize the proposals on my data entry job and rank them." },
    ],
    websiteUrl: "https://www.upwork.com",
    privacyPolicyUrl: "https://www.upwork.com/legal#privacy",
    termsUrl: "https://www.upwork.com/legal#terms",
    featured: false,
    apps: [
      {
        id: "app-upwork-mcp",
        name: "Upwork",
        description:
          "Job and talent search, job post drafts, and proposal review, over Upwork's MCP server with browser sign-in.",
        server: {
          name: "upwork",
          transport: "http",
          url: "https://mcp.upwork.com/mcp",
          auth: [{ id: "upwork-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "videogen",
    name: "VideoGen",
    tagline: "AI video creation",
    description:
      "VideoGen lets agents create videos, images, voiceovers, and music from a script or prompt in the signed-in VideoGen account. Each user signs in to their own VideoGen account through the browser.",
    category: "design",
    creatorName: "VideoGen",
    version: "1.0.0",
    prompts: [
      { id: "prompt-explainer", text: "Make a 60-second explainer video from this product description." },
      { id: "prompt-voiceover", text: "Create a voiceover for this script in a calm, clear voice." },
      { id: "prompt-social-clip", text: "Turn this blog post into a short vertical video for social media." },
    ],
    websiteUrl: "https://videogen.io",
    privacyPolicyUrl: "https://videogen.io/privacy-policy",
    termsUrl: "https://videogen.io/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-videogen-mcp",
        name: "VideoGen",
        description: "Video, image, and voiceover generation, over VideoGen's MCP server with browser sign-in.",
        server: {
          name: "videogen",
          transport: "http",
          url: "https://mcp.videogen.io/mcp",
          auth: [{ id: "videogen-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "vidiq",
    name: "vidIQ",
    tagline: "YouTube research and analytics",
    description:
      "vidIQ lets agents read YouTube channel and video statistics, keyword data, and trends. Access is read-only, and each user signs in to their own vidIQ account through the browser.",
    category: "data-analytics",
    creatorName: "vidIQ",
    version: "1.0.0",
    prompts: [
      { id: "prompt-top-videos", text: "Which of my videos got the most views in the last 90 days?" },
      { id: "prompt-keywords", text: "Find keyword ideas for a video about home espresso with their competition." },
      { id: "prompt-competitors", text: "Compare my channel's growth with two similar channels." },
    ],
    websiteUrl: "https://vidiq.com",
    privacyPolicyUrl: "https://vidiq.com/privacy/",
    termsUrl: "https://vidiq.com/terms/",
    featured: false,
    apps: [
      {
        id: "app-vidiq-mcp",
        name: "vidIQ",
        description: "YouTube channel analytics and keyword research, over vidIQ's MCP server with browser sign-in.",
        server: {
          name: "vidiq",
          transport: "http",
          url: "https://mcp.vidiq.com/mcp",
          auth: [{ id: "vidiq-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "webflow",
    name: "Webflow",
    tagline: "Sites and CMS content",
    description:
      "Webflow lets agents read and update sites, pages, and CMS collections in the Webflow workspaces the signed-in user authorizes. Each user signs in to their own Webflow account through the browser.",
    category: "design",
    creatorName: "Webflow",
    version: "1.0.0",
    prompts: [
      { id: "prompt-cms-items", text: "List the draft items in the blog collection and when they were last edited." },
      { id: "prompt-seo-check", text: "Which pages on my site have no meta description?" },
      { id: "prompt-draft-post", text: "Create a draft blog post in the CMS from these notes." },
    ],
    websiteUrl: "https://webflow.com",
    privacyPolicyUrl: "https://webflow.com/legal/privacy",
    termsUrl: "https://webflow.com/legal/terms",
    featured: false,
    apps: [
      {
        id: "app-webflow-mcp",
        name: "Webflow",
        description: "Site, page, and CMS management, over Webflow's MCP server with browser sign-in.",
        server: {
          name: "webflow",
          transport: "http",
          url: "https://mcp.webflow.com/mcp",
          auth: [{ id: "webflow-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "wellnessproject",
    name: "Wellness Project",
    tagline: "Fitness and health data",
    description:
      "Wellness Project lets agents read and log workouts, nutrition, sleep, body metrics, and wearable data in the signed-in account. Each user signs in to their own Wellness Project account through the browser.",
    category: "other",
    creatorName: "Wellness Project",
    version: "1.0.0",
    prompts: [
      { id: "prompt-training-week", text: "Summarize my training volume this week compared with last week." },
      { id: "prompt-sleep-trend", text: "How has my sleep changed over the last month?" },
      { id: "prompt-log-workout", text: "Log today's workout: 5 sets of 5 squats at 100 kg." },
    ],
    websiteUrl: "https://wellnessproject.ai",
    privacyPolicyUrl: "https://wellnessproject.ai/privacy",
    termsUrl: "https://wellnessproject.ai/terms",
    featured: false,
    apps: [
      {
        id: "app-wellnessproject-mcp",
        name: "Wellness Project",
        description:
          "Workout, nutrition, sleep, and wearable data, over Wellness Project's MCP server with browser sign-in.",
        server: {
          name: "wellnessproject",
          transport: "http",
          url: "https://wellnessproject.ai/api/mcp",
          auth: [{ id: "wellnessproject-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "whop",
    name: "Whop",
    tagline: "Digital products and memberships",
    description:
      "Whop lets agents read and change live data in the signed-in Whop account, such as products, memberships, and payments, and search the Whop developer documentation. Each user signs in to their own Whop account through the browser.",
    category: "other",
    creatorName: "Whop",
    version: "1.0.0",
    prompts: [
      { id: "prompt-members", text: "How many active memberships does each of my products have?" },
      { id: "prompt-revenue", text: "Summarize payments from the last 30 days by product." },
      { id: "prompt-api-docs", text: "How do I verify a Whop webhook in my app? Check the docs." },
    ],
    websiteUrl: "https://whop.com",
    privacyPolicyUrl: "https://whop.com/privacy/",
    termsUrl: "https://whop.com/tos/",
    featured: false,
    apps: [
      {
        id: "app-whop-mcp",
        name: "Whop",
        description: "Live Whop data and documentation search, over Whop's MCP server with browser sign-in.",
        server: {
          name: "whop",
          transport: "http",
          url: "https://mcp.whop.com/mcp",
          auth: [{ id: "whop-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "windsor",
    name: "Windsor.ai",
    tagline: "Marketing data from many sources",
    description:
      "Windsor.ai lets agents query marketing and analytics data from the sources connected to the user's Windsor.ai account, such as Google Ads, Meta Ads, GA4, and HubSpot. Each user signs in to their own Windsor.ai account through the browser.",
    category: "data-analytics",
    creatorName: "Windsor.ai",
    version: "1.0.0",
    prompts: [
      { id: "prompt-ad-spend", text: "Compare ad spend and conversions across Google Ads and Meta Ads last month." },
      { id: "prompt-campaigns", text: "Which campaigns had the highest cost per acquisition this quarter?" },
      { id: "prompt-traffic", text: "Summarize GA4 sessions by channel for the last 30 days." },
    ],
    websiteUrl: "https://windsor.ai",
    privacyPolicyUrl: "https://windsor.ai/privacy-statement/",
    termsUrl: "https://windsor.ai/terms-of-service/",
    featured: false,
    apps: [
      {
        id: "app-windsor-mcp",
        name: "Windsor.ai",
        description: "Marketing and analytics data queries, over Windsor.ai's MCP server with browser sign-in.",
        server: {
          name: "windsor",
          transport: "http",
          url: "https://mcp.windsor.ai",
          auth: [{ id: "windsor-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "withings",
    name: "Withings",
    tagline: "Health measurements",
    description:
      "Withings lets agents read the user's weight, body composition, blood pressure, sleep, and activity data, and log measurements after the user approves. It needs an active Withings+ membership, and each user signs in to their own Withings account through the browser.",
    category: "other",
    creatorName: "Withings",
    version: "1.0.0",
    prompts: [
      { id: "prompt-weight-trend", text: "How has my weight changed over the last three months?" },
      { id: "prompt-blood-pressure", text: "Summarize my blood pressure readings from the last month for my doctor." },
      { id: "prompt-sleep-steps", text: "Did I sleep better on days when I walked more than 8,000 steps?" },
    ],
    websiteUrl: "https://www.withings.com",
    privacyPolicyUrl: "https://www.withings.com/en-us/policies/privacy-policy",
    termsUrl: "https://www.withings.com/en-us/policies/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-withings-mcp",
        name: "Withings",
        description:
          "Weight, blood pressure, sleep, and activity data, over Withings's MCP server with browser sign-in.",
        server: {
          name: "withings",
          transport: "http",
          url: "https://mcp.withings.com/mcp",
          auth: [{ id: "withings-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "wix",
    name: "Wix",
    tagline: "Wix sites and developer docs",
    description:
      "Wix lets agents search the Wix developer documentation, list the sites in the signed-in account, and call Wix APIs on a selected site. Each user signs in to their own Wix account through the browser.",
    category: "coding",
    creatorName: "Wix",
    version: "1.0.0",
    prompts: [
      { id: "prompt-list-sites", text: "List the sites in my Wix account and when each one was last published." },
      { id: "prompt-api-docs", text: "How do I query store products with the Wix REST API? Show an example request." },
      { id: "prompt-bookings", text: "Which Bookings services does my site offer, and what does each one cost?" },
    ],
    websiteUrl: "https://www.wix.com",
    privacyPolicyUrl: "https://www.wix.com/about/privacy",
    termsUrl: "https://www.wix.com/about/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-wix-mcp",
        name: "Wix",
        description:
          "Wix documentation search, site lookup, and site API calls, over Wix's MCP server with browser sign-in.",
        server: {
          name: "wix",
          transport: "http",
          url: "https://mcp.wix.com/mcp",
          auth: [{ id: "wix-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "wordpress",
    name: "WordPress.com",
    tagline: "WordPress.com sites and posts",
    description:
      "WordPress.com lets agents read posts, pages, comments, and site settings, and draft content on the sites of the signed-in account. Each user signs in to their own WordPress.com account through the browser and chooses full or read-only access.",
    category: "productivity",
    creatorName: "Automattic",
    version: "1.0.0",
    prompts: [
      { id: "prompt-recent-posts", text: "List my ten most recent posts and their publish status." },
      { id: "prompt-comments", text: "Which comments on my site are waiting for moderation?" },
      { id: "prompt-draft-post", text: "Draft a post about our spring opening hours, but do not publish it." },
    ],
    websiteUrl: "https://wordpress.com",
    privacyPolicyUrl: "https://automattic.com/privacy/",
    termsUrl: "https://wordpress.com/tos/",
    featured: false,
    apps: [
      {
        id: "app-wordpress-mcp",
        name: "WordPress.com",
        description: "Site, post, and comment access, over WordPress.com's MCP server with browser sign-in.",
        server: {
          name: "wordpress",
          transport: "http",
          url: "https://public-api.wordpress.com/wpcom/v2/mcp/v1",
          auth: [{ id: "wordpress-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "workable",
    name: "Workable",
    tagline: "Hiring pipeline and HR",
    description:
      "Workable lets agents look up jobs, candidates, and pipeline stages, and read employee and time-off records in the signed-in account. The signed-in user's Workable permissions limit what the agent can see and do.",
    category: "productivity",
    creatorName: "Workable",
    version: "1.0.0",
    prompts: [
      { id: "prompt-open-jobs", text: "List our open jobs and how many candidates are in each stage." },
      {
        id: "prompt-candidate-summary",
        text: "Summarize the candidates in the interview stage for the backend engineer job.",
      },
      { id: "prompt-time-off", text: "Who on the team is on time off next week?" },
    ],
    websiteUrl: "https://www.workable.com",
    privacyPolicyUrl: "https://www.workable.com/privacy",
    termsUrl: "https://www.workable.com/terms",
    featured: false,
    apps: [
      {
        id: "app-workable-mcp",
        name: "Workable",
        description: "Job, candidate, and HR record access, over Workable's MCP server with browser sign-in.",
        server: {
          name: "workable",
          transport: "http",
          url: "https://mcp.workable.com/mcp",
          auth: [{ id: "workable-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "workos",
    name: "WorkOS",
    tagline: "Auth and SSO administration",
    description:
      "WorkOS lets agents manage organizations, users, SSO connections, and directories, and review recent sign-in activity in the signed-in WorkOS workspace. The agent acts with the user's own dashboard role and uses the sandbox environment by default.",
    category: "coding",
    creatorName: "WorkOS",
    version: "1.0.0",
    prompts: [
      { id: "prompt-draft-sso", text: "Which SSO connections are still in draft, and for which organizations?" },
      { id: "prompt-directory-sync", text: "Which directories have not synced in the last week?" },
      { id: "prompt-sign-in-activity", text: "Show suspicious sign-in attempts from the last 24 hours." },
    ],
    websiteUrl: "https://workos.com",
    privacyPolicyUrl: "https://workos.com/legal/privacy",
    termsUrl: "https://workos.com/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-workos-mcp",
        name: "WorkOS",
        description:
          "Organization, user, SSO, and directory management, over WorkOS's MCP server with browser sign-in.",
        server: {
          name: "workos",
          transport: "http",
          url: "https://mcp.workos.com/mcp",
          auth: [{ id: "workos-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "wpvibe",
    name: "WPVibe",
    tagline: "Self-hosted WordPress management",
    description:
      "WPVibe lets agents read and edit posts, media, SEO fields, WooCommerce data, and theme files on a self-hosted WordPress site that runs the WPVibe plugin. Each user signs in to their WPVibe account through the browser and authorizes their site.",
    category: "productivity",
    creatorName: "SeedProd",
    version: "1.0.0",
    prompts: [
      { id: "prompt-seo-audit", text: "Which published posts have no meta description?" },
      { id: "prompt-draft-page", text: "Draft an About page from these notes and save it as a draft." },
      { id: "prompt-low-stock", text: "List WooCommerce products with fewer than five items in stock." },
    ],
    websiteUrl: "https://wpvibe.ai",
    privacyPolicyUrl: "https://wpvibe.ai/privacy/",
    termsUrl: "https://wpvibe.ai/terms/",
    featured: false,
    apps: [
      {
        id: "app-wpvibe-mcp",
        name: "WPVibe",
        description: "WordPress content, media, and store access, over WPVibe's MCP server with browser sign-in.",
        server: {
          name: "wpvibe",
          transport: "http",
          url: "https://mcp.wpvibe.ai/mcp",
          auth: [{ id: "wpvibe-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "ynab",
    name: "YNAB",
    tagline: "Budget and spending review",
    description:
      "YNAB lets agents read the budgets, categories, accounts, and transactions of the signed-in account, so they can answer questions about spending and plans. Each user signs in to their own YNAB account through the browser.",
    category: "productivity",
    creatorName: "YNAB",
    version: "1.0.0",
    prompts: [
      { id: "prompt-overspent", text: "Which categories are overspent this month?" },
      { id: "prompt-dining", text: "How much did I spend on dining out in each of the last three months?" },
      { id: "prompt-uncategorized", text: "List transactions from the last two weeks that have no category." },
    ],
    websiteUrl: "https://www.ynab.com",
    privacyPolicyUrl: "https://www.ynab.com/privacy-policy",
    termsUrl: "https://www.ynab.com/terms",
    featured: false,
    apps: [
      {
        id: "app-ynab-mcp",
        name: "YNAB",
        description: "Budget, category, and transaction lookup, over YNAB's MCP server with browser sign-in.",
        server: {
          name: "ynab",
          transport: "http",
          url: "https://api.ynab.com/mcp",
          auth: [{ id: "ynab-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "you",
    name: "You.com",
    tagline: "Web search and research",
    description:
      "You.com lets agents search the web, read page contents, and run multi-step research with cited sources. Each user signs in to their own You.com account through the browser.",
    category: "research",
    creatorName: "You.com",
    version: "1.0.0",
    prompts: [
      { id: "prompt-news", text: "What changed in EU AI regulation this month? Cite the sources." },
      { id: "prompt-compare", text: "Compare the current pricing of the three largest managed Postgres providers." },
      { id: "prompt-read-page", text: "Read this article and summarize its main claims." },
    ],
    websiteUrl: "https://you.com",
    privacyPolicyUrl: "https://you.com/privacy",
    termsUrl: "https://you.com/terms",
    featured: false,
    apps: [
      {
        id: "app-you-mcp",
        name: "You.com",
        description: "Web search, page contents, and research, over You.com's MCP server with browser sign-in.",
        server: {
          name: "you",
          transport: "http",
          url: "https://api.you.com/mcp",
          auth: [{ id: "you-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "zapier",
    name: "Zapier",
    tagline: "Actions across connected apps",
    description:
      "Zapier lets agents run actions in the apps that the signed-in user connected in Zapier, such as finding a spreadsheet row or drafting an email. Each user signs in to their own Zapier account through the browser and picks the actions the agent can use.",
    category: "automation",
    creatorName: "Zapier",
    version: "1.0.0",
    prompts: [
      { id: "prompt-list-actions", text: "Which Zapier actions can you use for me right now?" },
      { id: "prompt-find-row", text: "Find the row for order 1042 in my orders spreadsheet." },
      {
        id: "prompt-draft-email",
        text: "Draft a Gmail reply to the latest message from the design team, but do not send it.",
      },
    ],
    websiteUrl: "https://zapier.com",
    privacyPolicyUrl: "https://zapier.com/privacy",
    termsUrl: "https://zapier.com/legal/terms-of-service",
    featured: false,
    apps: [
      {
        id: "app-zapier-mcp",
        name: "Zapier",
        description: "Actions in connected apps, over Zapier's MCP server with browser sign-in.",
        server: {
          name: "zapier",
          transport: "http",
          url: "https://mcp.zapier.com/api/v1/connect",
          auth: [{ id: "zapier-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
  {
    slug: "zoominfo",
    name: "ZoomInfo",
    tagline: "B2B company and contact data",
    description:
      "ZoomInfo lets agents look up companies and contacts, enrich account records, and find buying signals in ZoomInfo data. Each user signs in to their own ZoomInfo account through the browser, and the account's plan and entitlements limit the data.",
    category: "research",
    creatorName: "ZoomInfo",
    version: "1.0.0",
    prompts: [
      { id: "prompt-company-profile", text: "Give me a profile of Acme Robotics: size, industry, and recent funding." },
      {
        id: "prompt-find-contacts",
        text: "Find the heads of IT at logistics companies in Poland with more than 500 employees.",
      },
      { id: "prompt-intent", text: "Which accounts on my list show intent for data warehouse tools?" },
    ],
    websiteUrl: "https://www.zoominfo.com",
    privacyPolicyUrl: "https://www.zoominfo.com/legal/privacy-policy",
    termsUrl: "https://www.zoominfo.com/legal/terms-of-use",
    featured: false,
    apps: [
      {
        id: "app-zoominfo-mcp",
        name: "ZoomInfo",
        description: "Company and contact search and enrichment, over ZoomInfo's MCP server with browser sign-in.",
        server: {
          name: "zoominfo",
          transport: "http",
          url: "https://mcp.zoominfo.com/mcp",
          auth: [{ id: "zoominfo-oauth", kind: "link", label: "Sign in" }],
        },
      },
    ],
  },
];
