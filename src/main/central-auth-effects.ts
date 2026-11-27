import { accountBookmarkHeaders, rememberAccountBookmark } from "@openbot/team-client/account-bookmark";
import { Context, Effect, Layer, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class CentralAuthOperationError extends Schema.TaggedError<CentralAuthOperationError>()(
  "CentralAuthOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export const { io: authCall, sync: authDecode } = causeHelpers(CentralAuthOperationError);

export class CentralAuthTransport extends Context.Service<
  CentralAuthTransport,
  {
    fetch(input: string | URL | Request, init?: RequestInit): Effect.Effect<Response, CentralAuthOperationError>;
  }
>()("openbot/main/CentralAuthTransport") {
  static layer(fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
    return Layer.succeed(
      CentralAuthTransport,
      CentralAuthTransport.of({
        fetch: (input, init) =>
          Effect.tryPromise({
            try: (signal) =>
              fetcher(input, {
                ...init,
                ...accountBookmarkInit(input, init),
                signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
              }).then((response) => {
                if (!(input instanceof Request)) rememberAccountBookmark(input, response);
                return response;
              }),
            catch: (cause) => new CentralAuthOperationError({ cause }),
          }),
      }),
    );
  }
}

function accountBookmarkInit(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Pick<RequestInit, "headers"> {
  if (input instanceof Request) return {};
  const bookmark = Object.entries(accountBookmarkHeaders(input));
  if (bookmark.length === 0) return {};
  const headers = new Headers(init?.headers);
  for (const [name, value] of bookmark) headers.set(name, value);
  return { headers };
}
