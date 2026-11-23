import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Result, Schema } from "effect";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("claude-stored-sign-in");

const KEYCHAIN_TIMEOUT_MS = 3_000;
const KEYCHAIN_ITEM_NOT_FOUND = 44;
const CREDENTIAL_MANAGER_NAME = "claude-code-user";
const CRED_TYPE_GENERIC = 1;
const CREDENTIAL_MANAGER_MAX_PARTS = 256;

const execFileAsync = promisify(execFile);
const requireModule = createRequire(import.meta.url);

class ClaudeStoredSignInFailed extends Schema.TaggedError<ClaudeStoredSignInFailed>()("ClaudeStoredSignInFailed", {
  cause: Schema.Defect(),
}) {}

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

const CredentialManagerParts = Schema.Struct({ n: Schema.Int, l: Schema.Int });

type CredentialRead = (target: string) => string | null;

let windowsCredentialRead: CredentialRead | undefined;

function loadWindowsCredentialRead(): CredentialRead {
  if (windowsCredentialRead) return windowsCredentialRead;
  const koffi: typeof Koffi = requireModule("koffi");
  const advapi32 = koffi.load("advapi32.dll");
  const credentialType = koffi.struct({
    Flags: "uint32_t",
    Type: "uint32_t",
    TargetName: "void *",
    Comment: "void *",
    LastWritten: koffi.struct({ dwLowDateTime: "uint32_t", dwHighDateTime: "uint32_t" }),
    CredentialBlobSize: "uint32_t",
    CredentialBlob: "void *",
    Persist: "uint32_t",
    AttributeCount: "uint32_t",
    Attributes: "void *",
    TargetAlias: "void *",
    UserName: "void *",
  });
  const credRead: (target: string, type: number, flags: number, credential: [bigint | null]) => number = advapi32.func(
    "int __stdcall CredReadW(const char16_t *target, uint32_t type, uint32_t flags, _Out_ void **credential)",
  );
  const credFree: (buffer: bigint) => void = advapi32.func("void __stdcall CredFree(void *buffer)");
  windowsCredentialRead = (target) => {
    const credential: [bigint | null] = [null];
    if (!credRead(target, CRED_TYPE_GENERIC, 0, credential) || !credential[0]) return null;
    try {
      const { CredentialBlob: blob, CredentialBlobSize: size } = koffi.decode(credential[0], credentialType);
      if (!blob || !size) return null;
      return Buffer.from(new Uint8Array(koffi.view(blob, size))).toString("utf8");
    } finally {
      credFree(credential[0]);
    }
  };
  return windowsCredentialRead;
}

function readCredentialManager(service: string, read: CredentialRead): string | null {
  const target = `${service}/${CREDENTIAL_MANAGER_NAME}`;
  const parts = Schema.decodeUnknownOption(Schema.fromJsonString(CredentialManagerParts))(read(`${target}#m`) ?? "");
  if (Option.isNone(parts) || parts.value.n < 1 || parts.value.n > CREDENTIAL_MANAGER_MAX_PARTS) return read(target);
  const texts = Array.from({ length: parts.value.n }, (_, index) => read(`${target}#${index}`));
  const joined = texts.join("");
  if (texts.some((text) => text === null) || joined.length !== parts.value.l) return null;
  return Buffer.from(joined, "base64").toString("utf8");
}

const readText = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => new ClaudeStoredSignInFailed({ cause }),
  }).pipe(Effect.option);

function keychainAccount(environment: NodeJS.ProcessEnv): string {
  let name: string;
  try {
    name = environment.USER || userInfo().username;
  } catch {
    name = "claude-code-user";
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
}

const readCredentialText = Effect.fn("ClaudeStoredSignIn.readCredentialText")(function* (
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
  customConfigDirectory: boolean,
  credentialManager: boolean,
) {
  const suffix = customConfigDirectory
    ? `-${createHash("sha256").update(configDirectory).digest("hex").slice(0, 8)}`
    : "";
  if (platform() === "win32" && credentialManager) {
    const stored = yield* Effect.try({
      try: () => readCredentialManager(`Claude Code-credentials${suffix}`, loadWindowsCredentialRead()),
      catch: (cause) => new ClaudeStoredSignInFailed({ cause }),
    }).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() =>
          logger.warn("Unable to read the Claude sign-in in Windows Credential Manager:", toLogValue(failure.cause)),
        ),
      ),
      Effect.option,
    );
    if (Option.isSome(stored) && stored.value !== null) return Option.some(stored.value);
  }
  if (platform() === "darwin") {
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
      return Option.some(/^(?:[0-9a-f]{2})+$/iu.test(text) ? Buffer.from(text, "hex").toString("utf8") : text);
    }
    const cause = keychain.failure.cause;
    const missing =
      typeof cause === "object" && cause !== null && "code" in cause && cause.code === KEYCHAIN_ITEM_NOT_FOUND;
    if (!missing) return Option.none<string>();
  }
  return yield* readText(join(configDirectory, ".credentials.json"));
});

const readSettings = Effect.fn("ClaudeStoredSignIn.readSettings")(function* (
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
) {
  const legacy = yield* readText(join(configDirectory, ".config.json"));
  const text =
    Option.isSome(legacy) && legacy.value.length > 0
      ? legacy
      : yield* readText(join(environment.CLAUDE_CONFIG_DIR || homedir(), ".claude.json"));
  const settings = Option.flatMap(text, Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown)));
  if (Option.isNone(settings)) return { account: null, credentialManager: false };
  const account = Schema.decodeUnknownOption(StoredAccount)(settings.value);
  const flags = isDynamicRecord(settings.value) ? settings.value.cachedGrowthBookFeatures : undefined;
  return {
    account: Option.isSome(account) ? (account.value.oauthAccount ?? null) : null,
    credentialManager: isDynamicRecord(flags) && flags.tengu_windows_credman === true,
  };
});

const settingsSignIn = Effect.fn("ClaudeStoredSignIn.settingsSignIn")(function* (configDirectory: string) {
  const text = yield* readText(join(configDirectory, "settings.json"));
  const settings = Option.flatMap(text, Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown)));
  if (Option.isNone(settings) || !isDynamicRecord(settings.value)) return false;
  const { apiKeyHelper, env } = settings.value;
  return (
    (typeof apiKeyHelper === "string" && apiKeyHelper.length > 0) ||
    (isDynamicRecord(env) && AUTH_OVERRIDE_VARIABLES.some((name) => env[name]))
  );
});

export const readClaudeStoredSignIn = Effect.fn("ClaudeStoredSignIn.read")(function* (environment: NodeJS.ProcessEnv) {
  if (AUTH_OVERRIDE_VARIABLES.some((name) => environment[name])) return Option.none<DynamicRecord>();
  const customConfigDirectory = Boolean(environment.CLAUDE_CONFIG_DIR);
  const configDirectory = (environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")).normalize("NFC");
  if (yield* settingsSignIn(configDirectory)) return Option.none<DynamicRecord>();
  const settings = yield* readSettings(environment, configDirectory);
  const text = yield* readCredentialText(
    environment,
    configDirectory,
    customConfigDirectory,
    settings.credentialManager,
  );
  if (Option.isNone(text)) return Option.none<DynamicRecord>();
  const credential = Schema.decodeUnknownOption(Schema.fromJsonString(StoredCredential))(text.value);
  if (Option.isNone(credential)) return Option.none<DynamicRecord>();
  const oauth = credential.value.claudeAiOauth;
  const refreshExpiresAt = oauth.refreshTokenExpiresAt ?? null;
  if (!oauth.refreshToken || (refreshExpiresAt !== null && refreshExpiresAt <= Date.now()))
    return Option.none<DynamicRecord>();
  const { account } = settings;
  return Option.some<DynamicRecord>({
    loggedIn: true,
    authMethod: "claude.ai",
    email: account?.emailAddress ?? null,
    orgId: account?.organizationUuid ?? null,
    orgName: account?.organizationName ?? null,
    subscriptionType: oauth.subscriptionType ?? null,
  });
});
