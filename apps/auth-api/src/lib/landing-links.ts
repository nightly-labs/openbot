export const EXTERNAL_LINK_REL = "noopener noreferrer";

export const OPENBOT_DOWNLOAD_LINKS = {
  macos: "/download/macos",
  windows: "/download/windows",
} as const;

export const OPENBOT_LINKS = {
  contact: "https://x.com/OpenBot_",
  download: "#download",
  /** The same anchor from a page that is not the landing page. */
  downloadFromOtherPage: "/#download",
  news: "/news",
  releases: "https://github.com/NorbertBodziony/openbot/releases",
  repository: "https://github.com/NorbertBodziony/openbot",
  license: "https://github.com/NorbertBodziony/openbot/blob/main/LICENSE",
  privacy: "https://github.com/NorbertBodziony/openbot/blob/main/PRIVACY.md",
  documentation: "https://github.com/NorbertBodziony/openbot#readme",
  troubleshooting: "https://github.com/NorbertBodziony/openbot/blob/main/docs/TROUBLESHOOTING.md",
  architecture: "https://github.com/NorbertBodziony/openbot#architecture",
  contributing: "https://github.com/NorbertBodziony/openbot/blob/main/CONTRIBUTING.md",
  codex: "https://learn.chatgpt.com/docs/app-server",
  claude: "https://code.claude.com/docs/en/overview",
} as const;

/**
 * One entry in a footer column. An internal entry carries a route, not a string,
 * so the footer can render it as a client navigation. It also fixes a link that
 * only worked on one page: "#download" on its own finds nothing on /news, because
 * there is no download section there for it to scroll to.
 */
export type FooterLink =
  | { readonly label: string; readonly external: true; readonly href: string }
  | { readonly label: string; readonly external: false; readonly to: "/" | "/news"; readonly hash?: string };

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly FooterLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Download", external: false, to: "/", hash: "download" },
      { label: "News", external: false, to: "/news" },
      { label: "Releases", external: true, href: OPENBOT_LINKS.releases },
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
      { label: "Architecture", external: true, href: OPENBOT_LINKS.architecture },
      { label: "Contributing", external: true, href: OPENBOT_LINKS.contributing },
      { label: "Codex", external: true, href: OPENBOT_LINKS.codex },
      { label: "Claude Code", external: true, href: OPENBOT_LINKS.claude },
    ],
  },
];
