export const GITHUB_ROUTE_AUDIENCE = "openbot-github-route";

export const GITHUB_EVENTS_PATH = "/v1/github/events";

export const GITHUB_ROUTE_TTL_SECONDS = 5 * 60;

export const GITHUB_ROUTE_REPOSITORIES_LIMIT = 100;

export const GITHUB_DELIVERY_BODY_BYTES_LIMIT = 512 * 1024;

export const GITHUB_ROUTE_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "check_suite",
] as const;

export const GITHUB_EVENT_HEADER = "x-github-event";
export const GITHUB_DELIVERY_HEADER = "x-github-delivery";
export const GITHUB_SIGNATURE_HEADER = "x-hub-signature-256";

export const GITHUB_EVENT_PATTERN = /^[a-z_]{1,64}$/u;
export const GITHUB_DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
export const GITHUB_SIGNATURE_PATTERN = /^sha256=[A-Fa-f0-9]{64}$/u;
export const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

export interface GitHubRouteRepository {
  id: number;
  installationId: number;
}

export interface GitHubRouteClaims {
  aud: typeof GITHUB_ROUTE_AUDIENCE;
  hid: string;
  repositories: GitHubRouteRepository[];
  iat: number;
  exp: number;
}

export type GitHubDeliveryStatus = 202 | 400 | 404 | 503;
