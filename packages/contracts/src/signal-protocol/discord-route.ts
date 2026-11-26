export const DISCORD_ROUTE_AUDIENCE = "openbot-discord-route";

export const DISCORD_API_PATH = "/v1/discord/api";

export const DISCORD_ROUTE_TTL_SECONDS = 5 * 60;

export const DISCORD_ROUTE_GUILDS_LIMIT = 32;

export interface DiscordRouteClaims {
  aud: typeof DISCORD_ROUTE_AUDIENCE;
  hid: string;
  guilds: DiscordRouteGuild[];
  iat: number;
  exp: number;
}

export interface DiscordRouteGuild {
  id: string;
  linkedAt: number;
}
