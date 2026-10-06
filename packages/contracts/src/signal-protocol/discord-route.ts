// The Discord route: how a Discord event finds the host that answers it, and how that host calls
// Discord.
//
// The OpenBot Discord app is one bot for every guild that installs it. Only Signal holds its bot
// token: Signal keeps the bot's Gateway connection, and does each Discord API call for a host.
// Signal passes an event of a guild to the `ingress` socket that holds a route ticket for that
// guild, and accepts an API call only for a guild that is routed to the caller's socket.
//
// The route ticket is an ES256 JWT that `apps/auth-api` mints for a host that proves its machine
// token. It names only the guilds that the account service links to that host, and it expires: the
// host asks for a new one each time its `ingress` socket connects.

export const DISCORD_ROUTE_AUDIENCE = "openbot-discord-route";

// The host calls Discord through this Signal path, with the `discord-session` token of its socket.
export const DISCORD_API_PATH = "/v1/discord/api";

// How long a route ticket stays valid. Signal checks it only when an `ingress` socket connects.
export const DISCORD_ROUTE_TTL_SECONDS = 5 * 60;

// The most guilds one host can link.
export const DISCORD_ROUTE_GUILDS_LIMIT = 32;

export interface DiscordRouteClaims {
  aud: typeof DISCORD_ROUTE_AUDIENCE;
  // The remote host that receives the events.
  hid: string;
  // The Discord guilds linked to that host.
  guilds: DiscordRouteGuild[];
  iat: number;
  exp: number;
}

export interface DiscordRouteGuild {
  // The Discord guild ID (a snowflake).
  id: string;
  // When the account service linked the guild to the host, in milliseconds. Signal keeps a guild
  // with its newest link, so a host that lost the guild cannot take it back with an older ticket.
  linkedAt: number;
}
