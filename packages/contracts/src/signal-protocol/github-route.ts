// GitHub events of the OpenBot GitHub App. GitHub sends every event of every installation to one
// Signal URL; Signal checks the App's signature and passes the event to each `ingress` socket whose
// GitHub route ticket names the repository. The account service checks, with the host's GitHub
// sign-in, that the user can see each repository before it signs the ticket, and stores nothing:
// the ticket lives for `GITHUB_ROUTE_TTL_SECONDS`, and the host asks for a new one on every
// connection. A host that loses access keeps its events until its socket connects again.

export const GITHUB_ROUTE_AUDIENCE = "openbot-github-route";

export const GITHUB_EVENTS_PATH = "/v1/github/events";

export const GITHUB_ROUTE_TTL_SECONDS = 5 * 60;

// The repositories that the GitHub triggers of one host can watch.
export const GITHUB_ROUTE_REPOSITORIES_LIMIT = 100;

// The largest GitHub event body Signal passes to a host. Signal refuses a larger one with 413. An event can
// hold two texts of up to 65,536 characters each, such as an issue and its comment, and three repository
// objects. Images and files are links in the text.
export const GITHUB_DELIVERY_BODY_BYTES_LIMIT = 512 * 1024;

// The events that GitHub triggers need. The App's installation must send all of them.
export const GITHUB_ROUTE_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "check_suite",
] as const;

// GitHub's headers, as Signal reads them and passes them to the host.
export const GITHUB_EVENT_HEADER = "x-github-event";
export const GITHUB_DELIVERY_HEADER = "x-github-delivery";
export const GITHUB_SIGNATURE_HEADER = "x-hub-signature-256";

export const GITHUB_EVENT_PATTERN = /^[a-z_]{1,64}$/u;
export const GITHUB_DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
export const GITHUB_SIGNATURE_PATTERN = /^sha256=[A-Fa-f0-9]{64}$/u;
/** `owner/name`: up to 39 characters of owner and 100 of name, in the characters that GitHub allows. */
export const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

/** A repository as GitHub numbers it, with the installation of the OpenBot App that holds it. */
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
