// The OpenBot Discord app: one bot for every guild. `apps/discord-app/README.md` lists the same
// permissions and intents for the Developer Portal.

/**
 * The permissions OpenBot asks for in a guild, as Discord's bit field: view channels, send messages,
 * send messages in threads, embed links, attach files, read message history and add reactions.
 */
export const DISCORD_BOT_PERMISSIONS = (
  (1n << 6n) |
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n) |
  (1n << 16n) |
  (1n << 38n)
).toString();

/**
 * The Gateway intents Signal asks for: guilds, guild messages and direct messages. No privileged
 * intent: Discord gives a bot the text of a message that mentions it, and of a direct message.
 */
export const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

/** The avatar of the Discord Orchestrator agent that OpenBot adds. */
export const DISCORD_ORCHESTRATOR_AVATAR = { avatarSeed: "discord-orchestrator", avatarHue: 245 } as const;
