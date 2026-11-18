// Keeps the Google sign-in of an Antigravity account across the change from `agy_acp_server` 1.4 to
// the Antigravity CLI 1.5.
//
// The 1.4 server kept the token in `acp_token.json` in its folder. The 1.5 CLI reads
// `antigravity-oauth-token` in the same folder (with `WSL_DISTRO_NAME` set, see `provider-drivers.ts`)
// and does not read the old file. The refresh token of the old file signs the new CLI in, so OpenBot
// copies it once. The old file stays, so an earlier OpenBot still has its sign-in. A marker file stops
// a second copy: after a sign-out in the new CLI, the old token must not sign the account in again.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";

/** The 1.4 server's token file. */
const LEGACY_TOKEN_FILE = "acp_token.json";

/** The 1.5 CLI's token file, when it keeps the token in a file. */
export const ANTIGRAVITY_TOKEN_FILE = "antigravity-oauth-token";

/** Written when the account needs no copy, or got it. */
const IMPORTED_MARKER = "openbot-token-imported";

/** The Google account sign-in, the only method whose token OpenBot copies. */
const GOOGLE_SIGN_IN = "oauth-personal";

/**
 * Copies the refresh token of the 1.4 server in `appDataDir` to the 1.5 CLI's token file, once. The
 * copy has no access token, so the CLI gets a new one at its first call. A folder with no old token, a
 * sign-in that is not a Google account, or any failure leaves the account as it is: the user can sign
 * in again.
 */
export function importAntigravityToken(appDataDir: string): void {
  const marker = join(appDataDir, IMPORTED_MARKER);
  try {
    if (existsSync(marker)) return;
    const target = join(appDataDir, ANTIGRAVITY_TOKEN_FILE);
    if (existsSync(target)) {
      writeMarker(marker);
      return;
    }
    const refreshToken = legacyRefreshToken(appDataDir);
    if (!refreshToken) return;
    writeExclusive(
      target,
      JSON.stringify({
        token: { access_token: "", token_type: "Bearer", refresh_token: refreshToken, expiry: "2000-01-01T00:00:00Z" },
        auth_method: "consumer",
        id_token_email: "",
      }),
    );
    const cache = join(appDataDir, "cache");
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    const authState = join(cache, "acp-auth-state.json");
    if (!existsSync(authState)) writeExclusive(authState, JSON.stringify({ methodId: GOOGLE_SIGN_IN }));
    writeMarker(marker);
  } catch {
    // The CLI then reports no sign-in, and the user signs in again.
  }
}

/** The 1.4 server's `settings.json`: the chosen sign-in method. */
const LegacySettings = Schema.Struct({
  auth: Schema.optional(Schema.Struct({ type: Schema.optional(Schema.String) })),
});

/** The 1.4 server's `acp_token.json`. Its other fields are not copied. */
const LegacyToken = Schema.Struct({ refresh_token: Schema.String });

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(LegacySettings));
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(LegacyToken));

/** The refresh token of the 1.4 server's Google sign-in, or `null`. */
function legacyRefreshToken(appDataDir: string): string | null {
  const settings = Option.getOrNull(decodeSettings(readText(join(appDataDir, "settings.json"))));
  const method = settings?.auth?.type;
  if (method !== undefined && method !== GOOGLE_SIGN_IN) return null;
  return Option.getOrNull(decodeToken(readText(join(appDataDir, LEGACY_TOKEN_FILE))))?.refresh_token || null;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Writes a new file that only this user can read. It fails when the file exists. */
function writeExclusive(path: string, text: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
}

function writeMarker(marker: string): void {
  writeFileSync(marker, "", { mode: 0o600 });
}
