import { type SpawnedMspConnection, spawnMspConnection } from "@muse-code/sdk";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Option, Schema } from "effect";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "../cli";
import { providerCall, providerFailure, providerSync } from "../provider-client-effects";
import { CliCodeLoginFailed, type CliCodePrompt } from "./cli-code-login";
import type { CliLoginProcess } from "./cli-login-flow";

const INITIALIZE_TIMEOUT_MS = 30_000;
/** The same bound as the prompt of a CLI code sign-in (`PROMPT_TIMEOUT_MS`). */
const LOGIN_START_TIMEOUT_MS = 30_000;
/** The SDK ends the host itself after its 10 s shutdown window; this bounds the cancel before it. */
const CANCEL_TIMEOUT_MS = 15_000;

const LoginStartResult = Schema.Struct({ verificationUrl: Schema.String, userCode: Schema.String });
const LoginCompleted = Schema.Struct({ outcome: Schema.String });

/**
 * Starts a Muse device-code sign-in: a `muse serve` host that asks Meta for a code, and that saves
 * the account when the user confirms the code on another device.
 *
 * The host can neither run a shell nor write files, and it gets no `META_API_KEY`: a saved key
 * would sign it in without the user. The login methods are experimental in MSP, so the host is
 * started with `experimentalApi`. The host stays up until Meta answers, and the login scope closes it.
 */
export const startMuseDeviceLogin = Effect.fn("MuseLogin.start")(function* (options: {
  cli: AgentCliInfo;
  timeoutMs: number;
  spawn?: typeof spawnMspConnection;
}) {
  const target = cliSpawnTarget(options.cli.executable, ["serve", "--disable-shell", "--disable-write"]);
  if (target.windowsVerbatimArguments) {
    return yield* new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.museNativeWindows")) });
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...cliPathEnvironment(options.cli),
    MUSE_NO_AUTO_UPDATE: "1",
  };
  for (const key of Object.keys(environment)) if (key.toUpperCase() === "META_API_KEY") delete environment[key];
  const handshake = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        (options.spawn ?? spawnMspConnection)({
          command: target.command,
          args: target.args,
          env: environment,
          shutdownTimeoutMs: 10_000,
        }),
      catch: (cause) => new CliCodeLoginFailed({ cause }),
    }),
    (handshake) => Effect.tryPromise(() => handshake.close()).pipe(Effect.ignore),
  );
  const host = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        handshake.initialize({
          clientInfo: { name: "openbot", version: "1" },
          capabilities: { experimentalApi: true },
        }),
      catch: (cause) => new CliCodeLoginFailed({ cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: INITIALIZE_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.museStartTimeout")) })),
      }),
    ),
    // A sign-in that Meta has not answered is cancelled first, so its code stops working.
    (host) =>
      Effect.tryPromise(async () => {
        if (!answered) await host.connection.request("account/loginCancel", {}).catch(() => undefined);
        await host.close();
      }).pipe(Effect.timeout(CANCEL_TIMEOUT_MS), Effect.ignore),
  );
  let answered = false;
  // Registered before the start, so a fast answer is not lost.
  const completed = waitForLoginCompleted(host, options.timeoutMs, () => {
    answered = true;
  });
  // The SDK request has no deadline of its own: a stalled answer would hold the provider queue.
  const started = yield* Effect.tryPromise({
    try: () => host.connection.request("account/loginStart", { type: "deviceCode" }),
    catch: (cause) => new CliCodeLoginFailed({ cause }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: LOGIN_START_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) })),
    }),
  );
  const prompt = Schema.decodeUnknownOption(LoginStartResult)(started).pipe(
    Option.filter((result) => isHttpsUrl(result.verificationUrl) && result.userCode.length > 0),
  );
  if (Option.isNone(prompt)) {
    return yield* new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) });
  }
  return {
    done: completed,
    prompt: Effect.succeed<CliCodePrompt>({
      flow: "device",
      userCode: prompt.value.userCode,
      verificationUrl: prompt.value.verificationUrl,
      verificationUrlComplete: null,
    }),
    submit() {
      throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
    },
  } satisfies CliLoginProcess;
});

/** Below the 5 s deadline of the provider runtime's `account/read`. */
const ACCOUNT_READ_TIMEOUT_MS = 4_000;
const AccountState = Schema.Struct({
  state: Schema.String,
  credentialRequired: Schema.Boolean,
  label: Schema.optional(Schema.String),
});

/**
 * Reads which Meta credential Muse uses, from a short-lived `muse serve` host.
 *
 * `account/read` is experimental in MSP. The session host does not opt in, because experimental
 * variants would reach its strict event decoders. This host gets the same `META_API_KEY` as the
 * session host, so a saved key counts, and it can neither run a shell nor write files.
 */
export const readMuseAccount = Effect.fn("MuseLogin.readAccount")(
  function* (options: { cli: AgentCliInfo; apiKey: string | null; extraEnv?: Record<string, string> }) {
    const target = cliSpawnTarget(options.cli.executable, ["serve", "--disable-shell", "--disable-write"]);
    if (target.windowsVerbatimArguments)
      return yield* providerFailure(new Error(sourceText("error.provider.museNativeWindows")));
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...cliPathEnvironment(options.cli),
      ...options.extraEnv,
      MUSE_NO_AUTO_UPDATE: "1",
    };
    for (const key of Object.keys(environment)) if (key.toUpperCase() === "META_API_KEY") delete environment[key];
    if (options.apiKey) environment.META_API_KEY = options.apiKey;
    const handshake = yield* Effect.acquireRelease(
      providerSync(() =>
        spawnMspConnection({ command: target.command, args: target.args, env: environment, shutdownTimeoutMs: 10_000 }),
      ),
      // Not awaited: a stalled host can take its shutdown window plus a 2 s SIGTERM grace to end,
      // which would hold the answer past the 5 s `account/read` deadline. The SDK still ends it.
      (handshake) => Effect.sync(() => void handshake.close().catch(() => undefined)),
    );
    const host = yield* providerCall(() =>
      handshake.initialize({
        clientInfo: { name: "openbot", version: "1" },
        capabilities: { experimentalApi: true },
      }),
    );
    const state = yield* providerCall(() => host.connection.request("account/read", {})).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(AccountState)(value).pipe(Effect.mapError(providerFailure))),
    );
    return {
      authenticated: state.state !== "loggedOut" || !state.credentialRequired,
      email: state.state === "accountLogin" ? (state.label ?? null) : null,
      planType: null,
    };
  },
  Effect.timeoutOrElse({
    duration: ACCOUNT_READ_TIMEOUT_MS,
    orElse: () => Effect.fail(providerFailure(new Error(sourceText("error.provider.museStartTimeout")))),
  }),
  Effect.scoped,
);

/** Settles on Meta's answer: success only when the user granted the code. */
function waitForLoginCompleted(host: SpawnedMspConnection, timeoutMs: number, onAnswer: () => void) {
  const outcome = new Promise<string>((resolve, reject) => {
    host.connection.onNotification((notification) => {
      if (notification.method !== "account/loginCompleted") return;
      onAnswer();
      resolve(Schema.is(LoginCompleted)(notification.params) ? notification.params.outcome : "failed");
    });
    void host.exited.then(() => reject(new Error(sourceText("error.provider.acpSignInFailed"))));
  });
  // A rejection before `done` runs must not be reported as unhandled.
  outcome.catch(() => undefined);
  return Effect.tryPromise({ try: () => outcome, catch: (cause) => new CliCodeLoginFailed({ cause }) }).pipe(
    Effect.flatMap((result) =>
      result === "granted"
        ? Effect.void
        : Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.acpSignInFailed")) })),
    ),
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.acpSignInFailed")) })),
    }),
  );
}

function isHttpsUrl(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === "https:";
}
