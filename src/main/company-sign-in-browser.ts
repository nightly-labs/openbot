import { randomBytes } from "node:crypto";
import { Deferred, Effect, Schema } from "effect";
import type { LanguageService } from "./language-service";
import { startLoopbackCallbackServer } from "./loopback-callback-server";

const COMPANY_SIGN_IN_PATH = "/company-sign-in";
const COMPANY_SIGN_IN_WAIT_MS = 10 * 60_000;

export interface CompanySignInBrowser {
  open: (url: string) => Promise<void>;
  language: () => Pick<LanguageService, "locale" | "translate">;
}

export class CompanySignInBrowserError extends Schema.TaggedError<CompanySignInBrowserError>()(
  "CompanySignInBrowserError",
  {
    code: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const awaitCompanySignIn = Effect.fn("CompanySignIn.awaitBrowser")(function* <E, R>(
  browser: CompanySignInBrowser,
  cancel: Deferred.Deferred<void>,
  start: (returnTo: string, clientState: string) => Effect.Effect<string, E, R>,
) {
  const clientState = randomBytes(24).toString("base64url");
  const received = Deferred.makeUnsafe<URLSearchParams>();
  const server = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        startLoopbackCallbackServer({
          paths: [COMPANY_SIGN_IN_PATH],
          port: {},
          language: {
            get locale() {
              return browser.language().locale;
            },
            get translate() {
              return browser.language().translate;
            },
          },
          noPort: () => new Error("The company sign-in listener was given no port."),
          receive: (url) => {
            if (url.searchParams.get("state") !== clientState) {
              return { status: 400, message: "error.mcp.redirectNoSignIn" };
            }
            Deferred.doneUnsafe(received, Effect.succeed(url.searchParams));
            return url.searchParams.has("error")
              ? { status: 400, message: "error.mcp.redirectRefused" }
              : { status: 200, message: "error.mcp.redirectSignedIn" };
          },
        }),
      catch: (cause) => new CompanySignInBrowserError({ code: "listener_failed", cause }),
    }),
    (listener) => Effect.promise(() => listener.close()),
  );
  const pageUrl = yield* start(`http://127.0.0.1:${server.port}${COMPANY_SIGN_IN_PATH}`, clientState);
  if (yield* Deferred.isDone(cancel)) return yield* new CompanySignInBrowserError({ code: "cancelled" });
  yield* Effect.tryPromise({
    try: () => browser.open(pageUrl),
    catch: (cause) => new CompanySignInBrowserError({ code: "browser_failed", cause }),
  });
  const params = yield* Deferred.await(received).pipe(
    Effect.raceFirst(
      Deferred.await(cancel).pipe(Effect.andThen(Effect.fail(new CompanySignInBrowserError({ code: "cancelled" })))),
    ),
    Effect.timeoutOrElse({
      duration: COMPANY_SIGN_IN_WAIT_MS,
      orElse: () => Effect.fail(new CompanySignInBrowserError({ code: "timeout" })),
    }),
  );
  const error = params.get("error");
  if (error) return yield* new CompanySignInBrowserError({ code: error });
  return params;
}, Effect.scoped);
