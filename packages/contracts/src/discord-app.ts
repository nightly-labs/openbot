export const DISCORD_BOT_PERMISSIONS = (
  (1n << 6n) |
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n) |
  (1n << 16n) |
  (1n << 38n)
).toString();

export const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

export const DISCORD_MESSAGE_CONTENT_INTENT = 1 << 15;

export const DISCORD_ORCHESTRATOR_AVATAR = { avatarSeed: "discord-orchestrator", avatarHue: 245 } as const;
