import { createHash } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import type { AcpSavedSignInCheck } from "./acp-client";
import { type KimiSavedSignIn, readKimiSavedSignIn } from "./kimi-usage";

const KIMI_SIGN_IN_CHECK_TIMEOUT_MS = 5_000;

const MANAGED_MODEL_PREFIX = "kimi-code/";

class KimiSignInCheckFailed extends Schema.TaggedError<KimiSignInCheckFailed>()("KimiSignInCheckFailed", {
  cause: Schema.Defect(),
}) {}

const refusedSignIns = new Map<string, string>();

function tokenHash(signIn: KimiSavedSignIn): string {
  return createHash("sha256")
    .update(signIn.refreshToken ?? signIn.accessToken)
    .digest("hex");
}

export const kimiSavedSignInVersion = Effect.fn("Kimi.savedSignInVersion")(function* (
  python: boolean,
  env: NodeJS.ProcessEnv,
) {
  const signIn = yield* readKimiSavedSignIn(python, env);
  return Option.isSome(signIn) ? tokenHash(signIn.value) : null;
});

const modelsStatus = Effect.fn("Kimi.modelsStatus")(function* (signIn: KimiSavedSignIn) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(`${signIn.apiUrl}/models`, {
        headers: { Authorization: `Bearer ${signIn.accessToken}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(KIMI_SIGN_IN_CHECK_TIMEOUT_MS)]),
      }),
    catch: (cause) => new KimiSignInCheckFailed({ cause }),
  });
  yield* Effect.tryPromise({
    try: () => response.body?.cancel() ?? Promise.resolve(),
    catch: (cause) => new KimiSignInCheckFailed({ cause }),
  }).pipe(Effect.ignore);
  return response.status;
});

export function kimiSavedSignInCheck(env: () => NodeJS.ProcessEnv): AcpSavedSignInCheck {
  return {
    refusedAfterEmptyAnswer: (model) =>
      Effect.gen(function* () {
        if (!model?.startsWith(MANAGED_MODEL_PREFIX)) return null;
        const signIn = yield* readKimiSavedSignIn(true, env());
        if (Option.isNone(signIn) || !signIn.value.managed) return null;
        if ((yield* modelsStatus(signIn.value)) !== 401) return null;
        const { expiresAt } = signIn.value;
        if (expiresAt !== null && expiresAt * 1_000 <= Date.now()) return "turn" as const;
        refusedSignIns.set(signIn.value.path, tokenHash(signIn.value));
        return "lasting" as const;
      }).pipe(Effect.catch(() => Effect.succeed(null))),
    refusedAtStart: () =>
      readKimiSavedSignIn(true, env()).pipe(
        Effect.map((signIn) => {
          if (Option.isNone(signIn) || !signIn.value.managed) return false;
          const refused = refusedSignIns.get(signIn.value.path);
          if (refused === undefined) return false;
          if (refused === tokenHash(signIn.value)) return true;
          refusedSignIns.delete(signIn.value.path);
          return false;
        }),
      ),
  };
}
