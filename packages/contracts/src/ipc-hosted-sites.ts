export type HostedSiteFramework = "vanilla" | "astro";
export type HostedSiteStatus = "active" | "deleted" | "expired" | "blocked";

export interface HostedSiteSummary {
  id: string;
  hostname: string;
  url: string;
  title: string;
  description: string;
  framework: HostedSiteFramework;
  status: HostedSiteStatus;
  fileCount: number;
  size: number;
  expiresAt: string | null;
  updatedAt: string;
  /** The server that published the site, or null when no server was proven. */
  serverId: string | null;
}

/** The sites of one server, and how many of its plan's site slots are in use. */
export interface HostedSiteList {
  sites: HostedSiteSummary[];
  limit: number;
  used: number;
}

export interface PublishHostedSiteInput {
  sourcePath: string;
  title: string;
  description: string;
  spaFallback?: boolean;
}

export interface ReplaceHostedSiteInput extends PublishHostedSiteInput {
  siteId: string;
}

export interface DeleteHostedSiteInput {
  siteId: string;
}
