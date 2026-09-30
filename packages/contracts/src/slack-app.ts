// The OpenBot Slack app: one app for every workspace. `apps/slack-app/*/manifest.json` must list the
// same bot scopes and events.

/**
 * What OpenBot asks from a workspace. The Worker requests them in the OAuth install, and the host
 * compares them with what `auth.test` reports, so a missing one shows in the UI.
 */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "reactions:write",
  "users:read",
] as const;
