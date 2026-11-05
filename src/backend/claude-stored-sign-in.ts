// The Claude sign-in as the Claude CLI stores it, read without starting the CLI.
//
// `claude auth status` starts an OAuth refresh when the access token is near its expiry, and exits
// after 2 s without saving the rotated tokens when the refresh is slower. The next Claude process
// then gets `invalid_grant` and clears the sign-in, so the user must sign in again
// (anthropics/claude-code#95822, #105645). A stored sign-in with a refresh token is read here instead,
// and the agent process that uses it refreshes the token itself. The format is the CLI's own
// (checked on 2.1.318): when it cannot be read, the caller asks `auth status` as before.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Option, Result, Schema } from "effect";

const KEYCHAIN_TIMEOUT_MS = 3_000;
/** `security` exits with this code when the Keychain has no such item. */
const KEYCHAIN_ITEM_NOT_FOUND = 44;

const execFileAsync = promisify(execFile);

class ClaudeStoredSignInFailed extends Schema.TaggedError<ClaudeStoredSignInFailed>()("ClaudeStoredSignInFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * Variables that sign the CLI in from outside its store, send it to another API backend, or move or
 * rename the store. `auth status` reports these, so the stored sign-in alone would give a wrong answer.
 */
const AUTH_OVERRIDE_VARIABLES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_HOST_CREDS_FILE",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "CLAUDE_CODE_FORCE_WINDOWS_CREDMAN",
  "USE_STAGING_OAUTH",
  "USE_LOCAL_OAUTH",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
];

const StoredCredential = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    refreshToken: Schema.String,
    refreshTokenExpiresAt: Schema.optional(Schema.NullOr(Schema.Finite)),
    subscriptionType: Schema.optional(Schema.NullOr(Schema.String)),
  }),
});

const StoredAccount = Schema.Struct({
  oauthAccount: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        emailAddress: Schema.optional(Schema.NullOr(Schema.String)),
        organizationUuid: Schema.optional(Schema.NullOr(Schema.String)),
        organizationName: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

const readText = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => new ClaudeStoredSignInFailed({ cause }),
  }).pipe(Effect.option);

/** The Keychain account name that the CLI uses. */
function keychainAccount(environment: NodeJS.ProcessEnv): string {
  let name: string;
  try {
    name = environment.USER || userInfo().username;
  } catch {
    name = "claude-code-user";
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
}

/**
 * The stored credential text. On macOS the Keychain item wins when it exists; the file is the CLI's
 * fallback store there, and its only store on other platforms. None when neither can be read.
 */
const readCredentialText = Effect.fn("ClaudeStoredSignIn.readCredentialText")(function* (
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
  customConfigDirectory: boolean,
) {
  if (platform() === "darwin") {
    const suffix = customConfigDirectory
      ? `-${createHash("sha256").update(configDirectory).digest("hex").slice(0, 8)}`
      : "";
    // The CLI writes the item with `/usr/bin/security`, so reading it with the same tool asks nothing.
    const keychain = yield* Effect.tryPromise({
      try: () =>
        execFileAsync(
          "/usr/bin/security",
          ["find-generic-password", "-a", keychainAccount(environment), "-w", "-s", `Claude Code-credentials${suffix}`],
          { timeout: KEYCHAIN_TIMEOUT_MS },
        ),
      catch: (cause) => new ClaudeStoredSignInFailed({ cause }),
    }).pipe(Effect.result);
    if (Result.isSuccess(keychain)) {
      const text = keychain.success.stdout.trim();
      // `security -w` prints a value that is not plain text as hex.
      return Option.some(/^(?:[0-9a-f]{2})+$/iu.test(text) ? Buffer.from(text, "hex").toString("utf8") : text);
    }
    const cause = keychain.failure.cause;
    const missing =
      typeof cause === "object" && cause !== null && "code" in cause && cause.code === KEYCHAIN_ITEM_NOT_FOUND;
    // A locked Keychain or a timeout does not say that the item is absent.
    if (!missing) return Option.none<string>();
  }
  return yield* readText(join(configDirectory, ".credentials.json"));
});

/** The account fields of the CLI's settings file, which holds the email and organization. */
const readAccount = Effect.fn("ClaudeStoredSignIn.readAccount")(function* (
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
) {
  const legacy = yield* readText(join(configDirectory, ".config.json"));
  const text =
    Option.isSome(legacy) && legacy.value.length > 0
      ? legacy
      : yield* readText(join(environment.CLAUDE_CONFIG_DIR || homedir(), ".claude.json"));
  if (Option.isNone(text)) return null;
  const account = Schema.decodeUnknownOption(Schema.fromJsonString(StoredAccount))(text.value);
  return Option.isSome(account) ? (account.value.oauthAccount ?? null) : null;
});

/**
 * A signed-in status in the shape of `claude auth status --json`, from the sign-in that the CLI stored
 * for the environment's `CLAUDE_CONFIG_DIR`. None when the environment signs the CLI in another way,
 * when the store cannot be read, or when it has no usable refresh token: the caller then asks the CLI.
 * With no refresh token stored, `auth status` has no token to spend.
 */
export const readClaudeStoredSignIn = Effect.fn("ClaudeStoredSignIn.read")(function* (environment: NodeJS.ProcessEnv) {
  if (AUTH_OVERRIDE_VARIABLES.some((name) => environment[name])) return Option.none<DynamicRecord>();
  const customConfigDirectory = Boolean(environment.CLAUDE_CONFIG_DIR);
  const configDirectory = (environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")).normalize("NFC");
  const text = yield* readCredentialText(environment, configDirectory, customConfigDirectory);
  if (Option.isNone(text)) return Option.none<DynamicRecord>();
  const credential = Schema.decodeUnknownOption(Schema.fromJsonString(StoredCredential))(text.value);
  if (Option.isNone(credential)) return Option.none<DynamicRecord>();
  const oauth = credential.value.claudeAiOauth;
  const refreshExpiresAt = oauth.refreshTokenExpiresAt ?? null;
  if (!oauth.refreshToken || (refreshExpiresAt !== null && refreshExpiresAt <= Date.now()))
    return Option.none<DynamicRecord>();
  const account = yield* readAccount(environment, configDirectory);
  return Option.some<DynamicRecord>({
    loggedIn: true,
    authMethod: "claude.ai",
    email: account?.emailAddress ?? null,
    orgId: account?.organizationUuid ?? null,
    orgName: account?.organizationName ?? null,
    subscriptionType: oauth.subscriptionType ?? null,
  });
});
