// `wrangler.jsonc` sets the four non-secret SMTP variables in the top-level `vars`, which is what
// local `vite dev` reads, so a local run inherits four fifths of a mail configuration and
// `readSmtpConfig` rejects it as incomplete. They are listed here so a development env file can
// blank all five and turn email delivery off locally instead of dialling the real mail host.
const LOCAL_RUNTIME_KEYS = [
  "AUTH_EXPOSE_DEVELOPMENT_CODE",
  "EMAIL_SMTP_HOST",
  "EMAIL_SMTP_PORT",
  "EMAIL_SMTP_USERNAME",
  "EMAIL_FROM",
  "EMAIL_SMTP_PASSWORD",
  "SITE_REPORT_HASH_SECRET",
  "SITE_PUBLISH_ENABLED",
  "SITE_COOKIE_ISOLATION_READY",
  "SITE_LOCAL_ORIGIN",
  "REMOTE_TICKET_PRIVATE_JWK",
  "REMOTE_TICKET_PUBLIC_JWKS",
  "REMOTE_TICKET_KEY_ID",
  "REMOTE_SIGNAL_URL",
  "REMOTE_AUTH_WEBHOOK_URL",
  "REMOTE_AUTH_WEBHOOK_SECRET",
  "SLACK_ROUTE_PRIVATE_JWK",
  "SLACK_ROUTE_KEY_ID",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_STATE_SECRET",
  "SLACK_DEV_PUBLIC_ORIGIN",
  "DISCORD_ROUTE_PRIVATE_JWK",
  "DISCORD_ROUTE_KEY_ID",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_STATE_SECRET",
  "DISCORD_DEV_PUBLIC_ORIGIN",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "HOSTED_SERVERS_ENABLED",
  "HOSTED_SERVERS_ALLOWED_USER_IDS",
  "HOSTED_SERVER_TEMPLATE",
  "BOAT_API_KEY",
  "BOAT_WEBHOOK_SECRET",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "APNS_PRIVATE_KEY",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_TOPIC",
] as const;

const BOOLEAN_RUNTIME_KEYS = new Set<(typeof LOCAL_RUNTIME_KEYS)[number]>([
  "AUTH_EXPOSE_DEVELOPMENT_CODE",
  "SITE_PUBLISH_ENABLED",
  "SITE_COOKIE_ISOLATION_READY",
  "HOSTED_SERVERS_ENABLED",
]);

export function readLocalRuntimeVars(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of LOCAL_RUNTIME_KEYS) {
    const value = environment[key];
    // A development loader may leave ciphertext when a developer has no key for the shared file.
    if (value === undefined || value.startsWith("encrypted:")) continue;
    result[key] = BOOLEAN_RUNTIME_KEYS.has(key) ? (normalizeBooleanFlag(value) ? "true" : "false") : value;
  }
  return result;
}

function normalizeBooleanFlag(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
