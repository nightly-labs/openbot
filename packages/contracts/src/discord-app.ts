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
 * The Gateway intents Signal always asks for: guilds, guild messages and direct messages. Without a
 * privileged intent, Discord gives a bot the text of a message that mentions it, and of a direct message.
 */
export const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

/**
 * The privileged Message Content intent. Signal adds it unless `DISCORD_MESSAGE_CONTENT` is `false`, so
 * that the message a person replies to, and the conversation history, have their text. When the
 * Developer Portal has it off, Discord refuses it and Signal connects without it.
 */
export const DISCORD_MESSAGE_CONTENT_INTENT = 1 << 15;

/** The avatar of the Discord Orchestrator agent that OpenBot adds. */
export const DISCORD_ORCHESTRATOR_AVATAR = { avatarSeed: "discord-orchestrator", avatarHue: 245 } as const;
