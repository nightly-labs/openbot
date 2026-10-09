export const EXTERNAL_LINK_REL = "noopener noreferrer";

/** The installer each platform's download button starts: Apple silicon on macOS, x64 elsewhere. */
export const OPENBOT_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest",
  windows: "/download/windows/latest",
  linux: "/download/linux/latest",
} as const;

/** The other installer of a platform that ships two architectures. Windows ships x64 only. */
export const OPENBOT_ALTERNATE_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest?arch=x64",
  linux: "/download/linux/latest?arch=arm64",
} as const;

/** The pages that describe each installer: requirements, install steps and known limits. */
export const OPENBOT_DOWNLOAD_PAGE_LINKS = {
  hub: "/download",
  macos: "/download/macos",
  windows: "/download/windows",
  linux: "/download/linux",
  ios: "/download/ios",
  android: "/download/android",
} as const;

export const OPENBOT_LINKS = {
  contact: "https://x.com/OpenBot_",
  download: "#download",
  /** The same anchor from a page that is not the landing page. */
  downloadFromOtherPage: "/#download",
  news: "/news",
  guides: "/guides",
  plugins: "/plugins",
  changelog: "/changelog",
  releases: "https://github.com/nightly-labs/openbot/releases",
  repository: "https://github.com/nightly-labs/openbot",
  license: "https://github.com/nightly-labs/openbot/blob/main/LICENSE",
  privacy: "https://github.com/nightly-labs/openbot/blob/main/PRIVACY.md",
  documentation: "https://github.com/nightly-labs/openbot#readme",
  troubleshooting: "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md",
  selfHostedServer: "https://github.com/nightly-labs/openbot/blob/main/docs/self-hosted-server.md",
  architecture: "https://github.com/nightly-labs/openbot#architecture",
  contributing: "https://github.com/nightly-labs/openbot/blob/main/CONTRIBUTING.md",
  codex: "https://learn.chatgpt.com/docs/app-server",
  claude: "https://code.claude.com/docs/en/overview",
  anthropicAgents: "https://www.anthropic.com/engineering/building-effective-agents",
  productHunt: "https://www.producthunt.com/products/openbot-3?launch=openbot-4",
} as const;

/** The Product Hunt launch pill. Set to `false` when the launch ends. */
export const PRODUCT_HUNT_LAUNCH_LIVE = true;

/**
 * One entry in a footer column. An internal entry carries a route, not a string,
 * so the footer can render it as a client navigation. It also fixes a link that
 * only worked on one page: "#download" on its own finds nothing on /news, because
 * there is no download section there for it to scroll to.
 */
export type FooterLink =
  | { readonly label: string; readonly external: true; readonly href: string }
  | {
      readonly label: string;
      readonly external: false;
      readonly to: "/" | "/download" | "/news" | "/guides" | "/plugins" | "/changelog" | "/compare" | "/providers";
      readonly hash?: string;
    }
  | {
      readonly label: string;
      readonly external: false;
      readonly to: "/compare/$slug" | "/providers/$slug";
      readonly slug: string;
    };

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly FooterLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Download", external: false, to: "/download" },
      { label: "News", external: false, to: "/news" },
      { label: "Guides", external: false, to: "/guides" },
      { label: "Plugins", external: false, to: "/plugins" },
      { label: "Changelog", external: false, to: "/changelog" },
      { label: "Source code", external: true, href: OPENBOT_LINKS.repository },
      { label: "License", external: true, href: OPENBOT_LINKS.license },
      { label: "Privacy", external: true, href: OPENBOT_LINKS.privacy },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", external: true, href: OPENBOT_LINKS.documentation },
      { label: "Troubleshooting", external: true, href: OPENBOT_LINKS.troubleshooting },
      { label: "Self-hosted server", external: true, href: OPENBOT_LINKS.selfHostedServer },
      { label: "Architecture", external: true, href: OPENBOT_LINKS.architecture },
      { label: "Contributing", external: true, href: OPENBOT_LINKS.contributing },
      { label: "Codex", external: true, href: OPENBOT_LINKS.codex },
      { label: "Claude Code", external: true, href: OPENBOT_LINKS.claude },
    ],
  },
  {
    title: "Providers",
    links: [
      { label: "Claude Code", external: false, to: "/providers/$slug", slug: "claude-code" },
      { label: "Codex", external: false, to: "/providers/$slug", slug: "codex" },
      { label: "Gemini", external: false, to: "/providers/$slug", slug: "gemini" },
      { label: "Grok", external: false, to: "/providers/$slug", slug: "grok" },
      { label: "Cursor", external: false, to: "/providers/$slug", slug: "cursor" },
      { label: "OpenCode", external: false, to: "/providers/$slug", slug: "opencode" },
      { label: "Cline", external: false, to: "/providers/$slug", slug: "cline" },
      { label: "Ollama and LM Studio", external: false, to: "/providers/$slug", slug: "local-models" },
      { label: "All providers", external: false, to: "/providers" },
    ],
  },
  {
    title: "Compare",
    links: [
      { label: "OpenBot vs ChatGPT dots", external: false, to: "/compare/$slug", slug: "chatgpt-dots" },
      { label: "OpenBot vs Grok Bot", external: false, to: "/compare/$slug", slug: "grok-bot" },
      { label: "OpenBot vs Muse", external: false, to: "/compare/$slug", slug: "muse" },
      { label: "OpenBot vs Hermes Agent", external: false, to: "/compare/$slug", slug: "hermes-agent" },
      { label: "OpenBot vs OpenClaw", external: false, to: "/compare/$slug", slug: "openclaw" },
      { label: "OpenBot vs Manus", external: false, to: "/compare/$slug", slug: "manus" },
      { label: "OpenBot vs Claude Cowork", external: false, to: "/compare/$slug", slug: "claude-cowork" },
      { label: "OpenBot vs Devin", external: false, to: "/compare/$slug", slug: "devin" },
      { label: "Best AI agent apps", external: false, to: "/compare/$slug", slug: "best-ai-agent-apps" },
      { label: "All comparisons", external: false, to: "/compare" },
    ],
  },
];
