import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

const LEGACY_TOKEN_FILE = "acp_token.json";

export const ANTIGRAVITY_TOKEN_FILE = "antigravity-oauth-token";

const IMPORTED_MARKER = "openbot-token-imported";

const GOOGLE_SIGN_IN = "oauth-personal";

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
  } catch {}
}

const LegacySettings = Schema.Struct({
  auth: Schema.optional(Schema.Struct({ type: Schema.optional(Schema.String) })),
});

const LegacyToken = Schema.Struct({ refresh_token: Schema.String });

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(LegacySettings));
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(LegacyToken));

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

const TokenFileEmail = Schema.Struct({ id_token_email: Schema.optional(Schema.String) });

const decodeTokenFileEmail = Schema.decodeUnknownOption(Schema.fromJsonString(TokenFileEmail));

export const readAntigravityEmail = Effect.fn("AntigravityToken.readEmail")(function* (tokenFile: string) {
  return yield* Effect.tryPromise(() => readFile(tokenFile, "utf8")).pipe(
    Effect.map((text) => Option.getOrNull(decodeTokenFileEmail(text))?.id_token_email?.trim() || null),
    Effect.orElseSucceed(() => null),
  );
});
