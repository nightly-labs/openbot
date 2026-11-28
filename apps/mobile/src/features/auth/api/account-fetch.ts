import { runTeamEffect } from "@openbot/team-client";
import { accountAccessTokens } from "@openbot/team-client/account-access-token";
import { Effect } from "effect";
import { fetch } from "../../support/model/logged-fetch";

interface MobileAccountCredential {
  apiUrl: string;
  sessionToken: string;
}

interface MobileAccountFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

export function fetchMobileAccount(
  credential: MobileAccountCredential,
  path: string,
  init: MobileAccountFetchInit = {},
) {
  const url = new URL(path, credential.apiUrl).toString();
  return runTeamEffect(
    accountAccessTokens.send(
      {
        apiUrl: credential.apiUrl,
        sessionToken: credential.sessionToken,
        path,
        method: init.method,
        fetch: (input, request) => fetch(input, request),
      },
      (bearer) =>
        Effect.tryPromise({
          try: () => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } }),
          catch: (error) => error,
        }),
    ),
  );
}

export function forgetMobileAccountAccess(sessionToken: string): void {
  accountAccessTokens.forget(sessionToken);
}
