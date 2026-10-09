import { TELEGRAM_BOT_ID_PATTERN } from "@openbot/contracts/signal-protocol/telegram-route";

export interface RemoteApiConfig {
  host: string;
  port: number;
  healthPort: number;
  tlsCertificatePath: string | null;
  tlsPrivateKeyPath: string | null;
  ticketJwks: string | null;
  ticketJwksUrl: string | null;
  controlPlaneUrl: string;
  sessionSecret: string;
  authWebhookSecret: string;
  turnSecret: string;
  turnHost: string;
  turnPort: number;
  turnTlsPort: number;
  metricsToken: string | null;
  maximumConnectionsPerUser: number;
  maximumConnectionsPerIp: number;
  maximumMessagesPerMinute: number;
  trustProxy: boolean;
  // The signing secret of each OpenBot Slack app, production and development, which share this
  // Signal. A request must name the app whose secret signed it. Without one, the Slack route answers 503.
  slackSigningSecrets: SlackSigningSecret[];
  // The OpenBot Telegram bots, production and development, which share this Signal. Without them,
  // the Telegram routes answer 404 and `ready` names no `telegram` capability.
  telegram: TelegramConfig | null;
  // The OpenBot Discord bot. Without it, Signal keeps no Gateway connection and the Discord API route
  // answers 503.
  discord: DiscordBotConfig | null;
}

export interface DiscordBotConfig {
  botToken: string;
  applicationId: string;
}

interface SlackSigningSecret {
  appId: string;
  secret: string;
}

interface TelegramBot {
  botId: string;
  // The bot token. Only Signal has it: never log it or put it in a frame.
  token: string;
}

export interface TelegramConfig {
  bots: TelegramBot[];
  // Signal derives the webhook secret of each bot from it (`telegramWebhookSecret`).
  webhookSecret: string;
  // The public https origin of this Signal. With it, Signal sets the webhook of each bot when it starts.
  webhookOrigin: string | null;
}

/**
 * `SLACK_SIGNING_SECRET` is a comma-separated list of `<app ID>:<signing secret>`. A malformed value
 * turns off only the Slack route, which then answers 503: the remote sessions keep running.
 */
function readSlackSigningSecrets(value: string | undefined): SlackSigningSecret[] {
  const secrets: SlackSigningSecret[] = [];
  for (const entry of (value ?? "").split(",").map((part) => part.trim())) {
    if (!entry) continue;
    const [appId, secret] = entry.split(":", 2).map((part) => part.trim());
    if (!appId || !secret || !/^A[A-Z0-9]{1,31}$/u.test(appId)) {
      console.error("SLACK_SIGNING_SECRET must list <app ID>:<signing secret> pairs. The Slack route is off.");
      return [];
    }
    secrets.push({ appId, secret });
  }
  return secrets;
}

/**
 * `TELEGRAM_BOT_TOKENS` is a comma-separated list of bot tokens, `<bot ID>:<secret>`. A malformed
 * value, or a missing or weak `TELEGRAM_WEBHOOK_SECRET`, turns off only Telegram: the remote sessions
 * and the Slack route keep running.
 */
function readTelegramConfig(environment: Record<string, string | undefined>): TelegramConfig | null {
  const off = (message: string) => {
    console.error(`${message} Telegram is off.`);
    return null;
  };
  const bots: TelegramBot[] = [];
  for (const token of (environment.TELEGRAM_BOT_TOKENS ?? "").split(",").map((part) => part.trim())) {
    if (!token) continue;
    const separator = token.indexOf(":");
    const botId = token.slice(0, separator);
    if (
      separator < 0 ||
      !TELEGRAM_BOT_ID_PATTERN.test(botId) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(token.slice(separator + 1)) ||
      bots.some((bot) => bot.botId === botId)
    )
      return off("TELEGRAM_BOT_TOKENS must list different <bot ID>:<secret> bot tokens.");
    bots.push({ botId, token });
  }
  if (bots.length === 0) return null;
  const webhookSecret = environment.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (new TextEncoder().encode(webhookSecret).byteLength < 32)
    return off("TELEGRAM_WEBHOOK_SECRET must contain at least 32 bytes.");
  const origin = optional(environment.TELEGRAM_WEBHOOK_ORIGIN);
  const webhookOrigin = origin ? httpsOrigin(origin) : null;
  if (origin && !webhookOrigin) return off("TELEGRAM_WEBHOOK_ORIGIN must be an https origin.");
  return { bots, webhookSecret, webhookOrigin };
}

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/+$/u, "") ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` turn on the Discord bot together. A missing or
 * malformed value turns off only Discord: the remote sessions and the Slack route keep running.
 */
function readDiscordBot(token: string | undefined, applicationId: string | undefined): DiscordBotConfig | null {
  const botToken = token?.trim();
  const id = applicationId?.trim();
  if (!botToken || !id) return null;
  if (!/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,256}$/u.test(botToken)) return null;
  if (!/^[0-9]{17,20}$/u.test(id)) return null;
  return { botToken, applicationId: id };
}

export function readRemoteApiConfig(environment: Record<string, string | undefined> = process.env): RemoteApiConfig {
  const tlsDisabled = environment.REMOTE_TLS_DISABLED === "true";
  const ticketJwks = optional(environment.REMOTE_TICKET_PUBLIC_KEYS ?? environment.REMOTE_TICKET_PUBLIC_JWKS);
  const ticketJwksUrl = optional(environment.REMOTE_TICKET_JWKS_URL);
  if (!ticketJwks && !ticketJwksUrl)
    throw new Error("REMOTE_TICKET_PUBLIC_KEYS or REMOTE_TICKET_JWKS_URL is required.");
  return {
    host: environment.REMOTE_SIGNAL_HOST ?? "0.0.0.0",
    port: positiveInteger(environment.REMOTE_SIGNAL_PORT, tlsDisabled ? 8081 : 8443),
    healthPort: positiveInteger(environment.REMOTE_HEALTH_PORT, 8080),
    tlsCertificatePath: tlsDisabled ? null : required(environment.REMOTE_TLS_CERT_PATH, "REMOTE_TLS_CERT_PATH"),
    tlsPrivateKeyPath: tlsDisabled ? null : required(environment.REMOTE_TLS_KEY_PATH, "REMOTE_TLS_KEY_PATH"),
    ticketJwks,
    ticketJwksUrl,
    controlPlaneUrl: required(environment.REMOTE_CONTROL_PLANE_URL, "REMOTE_CONTROL_PLANE_URL"),
    sessionSecret: strongSecret(environment.REMOTE_SESSION_SECRET, "REMOTE_SESSION_SECRET"),
    authWebhookSecret: strongSecret(environment.REMOTE_AUTH_WEBHOOK_SECRET, "REMOTE_AUTH_WEBHOOK_SECRET"),
    turnSecret: strongSecret(environment.TURN_SHARED_SECRET, "TURN_SHARED_SECRET"),
    turnHost: required(environment.TURN_HOST, "TURN_HOST"),
    turnPort: positiveInteger(environment.TURN_PORT, 3478),
    turnTlsPort: positiveInteger(environment.TURN_TLS_PORT, 5349),
    metricsToken: optional(environment.REMOTE_METRICS_TOKEN),
    maximumConnectionsPerUser: positiveInteger(environment.REMOTE_MAX_CONNECTIONS_PER_USER, 32),
    maximumConnectionsPerIp: positiveInteger(environment.REMOTE_MAX_CONNECTIONS_PER_IP, 32),
    maximumMessagesPerMinute: positiveInteger(environment.REMOTE_MAX_MESSAGES_PER_MINUTE, 600),
    trustProxy: environment.REMOTE_TRUST_PROXY === "true",
    slackSigningSecrets: readSlackSigningSecrets(environment.SLACK_SIGNING_SECRET),
    telegram: readTelegramConfig(environment),
    discord: readDiscordBot(environment.DISCORD_BOT_TOKEN, environment.DISCORD_APPLICATION_ID),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function optional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function strongSecret(value: string | undefined, name: string): string {
  const secret = required(value, name);
  if (new TextEncoder().encode(secret).byteLength < 32) throw new Error(`${name} must contain at least 32 bytes.`);
  return secret;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}
