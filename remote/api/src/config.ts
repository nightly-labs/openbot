import { TELEGRAM_BOT_ID_PATTERN } from "@openbot/contracts/signal-protocol/telegram-route";

export interface RemoteApiConfig {
  host: string;
  port: number;
  healthHost: string;
  healthPort: number;
  tlsCertificatePath: string | null;
  tlsPrivateKeyPath: string | null;
  ticketJwks: string | null;
  ticketJwksUrl: string | null;
  controlPlaneUrl: string;
  sessionSecret: string;
  authWebhookSecret: string;
  turnSecret: string;
  turnHosts: string[];
  turnPort: number;
  turnTlsPort: number;
  metricsToken: string | null;
  maximumConnectionsPerUser: number;
  maximumConnectionsPerIp: number;
  maximumMessagesPerMinute: number;
  trustProxy: boolean;
  sourceCommit: string;
  slackSigningSecrets: SlackSigningSecret[];
  githubWebhookSecret: string | null;
  telegram: TelegramConfig | null;
  discord: DiscordBotConfig | null;
  signalId: string | null;
  entry: SignalEntryConfig | null;
}

export interface SignalEntryConfig {
  host: string;
  publicIpv4: string;
  checkIntervalMilliseconds: number;
  dnsServer: string | null;
}

export interface DiscordBotConfig {
  botToken: string;
  applicationId: string;
  messageContent: boolean;
}

interface SlackSigningSecret {
  appId: string;
  secret: string;
}

interface TelegramBot {
  botId: string;
  token: string;
}

export interface TelegramConfig {
  bots: TelegramBot[];
  webhookSecret: string;
  webhookOrigin: string | null;
  apiOrigin: string | null;
}

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
  const testOrigin = optional(environment.TELEGRAM_TEST_API_ORIGIN);
  const apiOrigin = testOrigin && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/u.test(testOrigin) ? testOrigin : null;
  if (testOrigin && !apiOrigin)
    console.error("TELEGRAM_TEST_API_ORIGIN must be http://127.0.0.1:<port>. It is ignored.");
  return { bots, webhookSecret, webhookOrigin, apiOrigin };
}

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/+$/u, "") ? url.origin : null;
  } catch {
    return null;
  }
}

function readDiscordBot(
  token: string | undefined,
  applicationId: string | undefined,
  messageContent: string | undefined,
): DiscordBotConfig | null {
  const botToken = token?.trim();
  const id = applicationId?.trim();
  if (!botToken || !id) return null;
  if (!/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,256}$/u.test(botToken)) return null;
  if (!/^[0-9]{17,20}$/u.test(id)) return null;
  return { botToken, applicationId: id, messageContent: messageContent !== "false" };
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
    healthHost: environment.REMOTE_HEALTH_HOST ?? "127.0.0.1",
    healthPort: positiveInteger(environment.REMOTE_HEALTH_PORT, 8080),
    tlsCertificatePath: tlsDisabled ? null : required(environment.REMOTE_TLS_CERT_PATH, "REMOTE_TLS_CERT_PATH"),
    tlsPrivateKeyPath: tlsDisabled ? null : required(environment.REMOTE_TLS_KEY_PATH, "REMOTE_TLS_KEY_PATH"),
    ticketJwks,
    ticketJwksUrl,
    controlPlaneUrl: required(environment.REMOTE_CONTROL_PLANE_URL, "REMOTE_CONTROL_PLANE_URL"),
    sessionSecret: strongSecret(environment.REMOTE_SESSION_SECRET, "REMOTE_SESSION_SECRET"),
    authWebhookSecret: strongSecret(environment.REMOTE_AUTH_WEBHOOK_SECRET, "REMOTE_AUTH_WEBHOOK_SECRET"),
    turnSecret: strongSecret(environment.TURN_SHARED_SECRET, "TURN_SHARED_SECRET"),
    turnHosts: readTurnHosts(required(environment.TURN_HOST, "TURN_HOST"), environment.TURN_EXTRA_HOSTS),
    turnPort: positiveInteger(environment.TURN_PORT, 3478),
    turnTlsPort: positiveInteger(environment.TURN_TLS_PORT, 5349),
    metricsToken: optional(environment.REMOTE_METRICS_TOKEN),
    maximumConnectionsPerUser: positiveInteger(environment.REMOTE_MAX_CONNECTIONS_PER_USER, 32),
    maximumConnectionsPerIp: positiveInteger(environment.REMOTE_MAX_CONNECTIONS_PER_IP, 32),
    maximumMessagesPerMinute: positiveInteger(environment.REMOTE_MAX_MESSAGES_PER_MINUTE, 600),
    trustProxy: environment.REMOTE_TRUST_PROXY === "true",
    sourceCommit: optional(environment.OPENBOT_SOURCE_COMMIT) ?? "unknown",
    slackSigningSecrets: readSlackSigningSecrets(environment.SLACK_SIGNING_SECRET),
    githubWebhookSecret: readGitHubWebhookSecret(environment.GITHUB_WEBHOOK_SECRET),
    telegram: readTelegramConfig(environment),
    discord: readDiscordBot(
      environment.DISCORD_BOT_TOKEN,
      environment.DISCORD_APPLICATION_ID,
      environment.DISCORD_MESSAGE_CONTENT,
    ),
    signalId: readSignalId(environment.SIGNAL_ID),
    entry: readEntryConfig(environment),
  };
}

function readGitHubWebhookSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  if (!secret) return null;
  if (new TextEncoder().encode(secret).byteLength < 32) {
    console.error("GITHUB_WEBHOOK_SECRET must contain at least 32 bytes. The GitHub route is off.");
    return null;
  }
  return secret;
}

function readSignalId(value: string | undefined): string | null {
  const id = optional(value);
  if (id && !/^[a-z0-9-]{1,32}$/u.test(id)) throw new Error("SIGNAL_ID must match ^[a-z0-9-]{1,32}$.");
  return id;
}

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/u;

function readEntryConfig(environment: Record<string, string | undefined>): SignalEntryConfig | null {
  const host = optional(environment.SIGNAL_ENTRY_HOST)?.toLowerCase() ?? null;
  const publicIpv4 = optional(environment.SIGNAL_PUBLIC_IPV4);
  if (!host && !publicIpv4) return null;
  if (!host || !publicIpv4) throw new Error("SIGNAL_ENTRY_HOST and SIGNAL_PUBLIC_IPV4 must be set together.");
  if (!TURN_HOST_PATTERN.test(host) || IPV4_PATTERN.test(host))
    throw new Error("SIGNAL_ENTRY_HOST must be a DNS name.");
  if (!IPV4_PATTERN.test(publicIpv4)) throw new Error("SIGNAL_PUBLIC_IPV4 must be an IPv4 address.");
  const dnsServer = optional(environment.SIGNAL_ENTRY_TEST_DNS_SERVER);
  if (dnsServer && !/^[0-9.]+:[0-9]{1,5}$/u.test(dnsServer))
    throw new Error("SIGNAL_ENTRY_TEST_DNS_SERVER must be <IPv4>:<port>.");
  return {
    host,
    publicIpv4,
    checkIntervalMilliseconds: positiveInteger(environment.SIGNAL_ENTRY_TEST_CHECK_SECONDS, 30) * 1_000,
    dnsServer,
  };
}

const TURN_HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u;

function readTurnHosts(primary: string, extra: string | undefined): string[] {
  const hosts = [primary, ...(extra ?? "").split(",").map((host) => host.trim())].filter(Boolean);
  for (const host of hosts) if (!TURN_HOST_PATTERN.test(host)) throw new Error(`Invalid TURN host: ${host}`);
  return [...new Set(hosts.map((host) => host.toLowerCase()))];
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
