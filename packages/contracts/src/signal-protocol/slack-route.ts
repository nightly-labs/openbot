// The Slack route: how a Slack request finds the host that answers it.
//
// The OpenBot Slack app has one request URL for every workspace that installs it,
// `https://signal.openbot.run/v1/slack/events`. Signal checks Slack's signature, reads the workspace
// ID (`team_id`) from the body, and passes the request to the `ingress` socket that holds a route
// ticket for that workspace.
//
// The route ticket is an ES256 JWT that `apps/auth-api` mints for a host that proves its machine
// token. It names only the workspaces that the account service links to that host, so a host cannot
// claim another host's workspace. It is signed with its own key, not the ticket key, and it expires:
// the host asks for a new one each time its `ingress` socket connects.

export const SLACK_ROUTE_AUDIENCE = "openbot-slack-route";

export const SLACK_EVENTS_PATH = "/v1/slack/events";

// How long a route ticket stays valid. Signal checks it only when an `ingress` socket connects, and
// the host asks for one just before it connects.
export const SLACK_ROUTE_TTL_SECONDS = 5 * 60;

// The most workspaces one host can link.
export const SLACK_ROUTE_TEAMS_LIMIT = 32;

export interface SlackRouteClaims {
  aud: typeof SLACK_ROUTE_AUDIENCE;
  // The remote host that receives the requests.
  hid: string;
  // The Slack workspaces linked to that host.
  teams: SlackRouteTeam[];
  iat: number;
  exp: number;
}

export interface SlackRouteTeam {
  // The Slack workspace ID.
  id: string;
  // When the account service linked the workspace to the host, in milliseconds. Signal keeps a
  // workspace with its newest link, so a host that lost the workspace cannot take it back with an
  // older ticket.
  linkedAt: number;
}
