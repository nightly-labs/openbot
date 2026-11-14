// A Kimi sign-in that Kimi's server refuses (#8555).
//
// Kimi CLI 1.52.0 opens a session when its token file holds a token, and it does not ask the server
// (`kimi_cli/acp/server.py`). When the server then refuses the token, with a 401 or a refused
// refresh, the model step fails, and Kimi ends the prompt as `end_turn` with no answer and no error
// (`kimi_cli/soul/kimisoul.py`). OpenBot thus showed Kimi as signed in and each turn as one with no
// answer, and the user could not see that a new sign-in was necessary.
//
// After such a turn, OpenBot asks Kimi's API for the models with the saved token, as the CLI does
// after its sign-in (`GET <base_url>/models`). A 401 means that the server refuses the token. Any
// other answer, or no answer, keeps the turn's own message. The CLI keeps the refused token, and its
// next process opens sessions again. Thus this module keeps the refusal for that token, and a new
// sign-in, which writes a new token, clears it. It keeps only the refusal of a token that has not
// expired. An expired token is refused also when its refresh failed for a short time only, such as
// with no network, and the next turn can refresh it.

import { createHash } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import type { AcpSavedSignInCheck } from "./acp-client";
import { type KimiSavedSignIn, readKimiSavedSignIn } from "./kimi-usage";

const KIMI_SIGN_IN_CHECK_TIMEOUT_MS = 5_000;

/**
 * The CLI names each model of the managed Kimi Code provider `kimi-code/<model>`, with `,thinking`
 * for its thinking variant (`managed_model_key`). Only these models use the saved sign-in.
 */
const MANAGED_MODEL_PREFIX = "kimi-code/";

class KimiSignInCheckFailed extends Schema.TaggedError<KimiSignInCheckFailed>()("KimiSignInCheckFailed", {
  cause: Schema.Defect(),
}) {}

/** The token file of each refused sign-in, and a hash of the refused token. */
const refusedSignIns = new Map<string, string>();

/** The refresh token identifies a sign-in: the access token changes each 15 minutes. */
function tokenHash(signIn: KimiSavedSignIn): string {
  return createHash("sha256")
    .update(signIn.refreshToken ?? signIn.accessToken)
    .digest("hex");
}

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

/**
 * The check of the Python CLI's saved sign-in. `env` gives the environment of the CLI process, as for
 * `readKimiSavedSignIn`. A check that cannot tell answers false.
 */
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
