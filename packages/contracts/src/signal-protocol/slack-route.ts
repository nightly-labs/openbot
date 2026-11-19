export const SLACK_ROUTE_AUDIENCE = "openbot-slack-route";

export const SLACK_EVENTS_PATH = "/v1/slack/events";

export const SLACK_ROUTE_TTL_SECONDS = 5 * 60;

export const SLACK_ROUTE_TEAMS_LIMIT = 32;

export interface SlackRouteClaims {
  aud: typeof SLACK_ROUTE_AUDIENCE;
  hid: string;
  teams: SlackRouteTeam[];
  iat: number;
  exp: number;
}

export interface SlackRouteTeam {
  id: string;
  appId: string;
  linkedAt: number;
}
