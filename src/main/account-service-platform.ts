import { Context, Effect, Layer, Schema } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";

export interface AccountRequestClient {
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError>;
}

class AccountRequestFailure extends Schema.TaggedError<AccountRequestFailure>()("AccountRequestFailure", {
  cause: Schema.Defect(),
}) {}
class AccountPageFailure extends Schema.TaggedError<AccountPageFailure>()("AccountPageFailure", {
  cause: Schema.Defect(),
}) {}
export type AccountServiceFailure = AccountRequestFailure | AccountPageFailure;

/** Desktop account services share these injected I/O boundaries, including test implementations. */
export class AccountServicePlatform extends Context.Service<
  AccountServicePlatform,
  {
    request<T>(
      path: string,
      init: RequestInit,
      decode: (value: unknown) => T,
      timeoutMs?: number,
    ): Effect.Effect<T, AccountRequestFailure>;
    openPage(url: string): Effect.Effect<void, AccountPageFailure>;
  }
>()("openbot/main/AccountServicePlatform") {
  static layer(auth: AccountRequestClient, openExternal: (url: string) => Promise<void>) {
    return Layer.succeed(
      AccountServicePlatform,
      AccountServicePlatform.of({
        request: <T>(path: string, init: RequestInit, decode: (value: unknown) => T, timeoutMs?: number) =>
          auth
            .requestAuthorized(path, init, decode, timeoutMs)
            .pipe(Effect.mapError((error) => new AccountRequestFailure({ cause: error.cause }))),
        openPage: (url) =>
          Effect.tryPromise({ try: () => openExternal(url), catch: (cause) => new AccountPageFailure({ cause }) }),
      }),
    );
  }
}
