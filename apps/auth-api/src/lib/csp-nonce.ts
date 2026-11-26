import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestUrl } from "@tanstack/solid-start/server";
import { NEAR_SIGN_PATH } from "./near-sign-csp";

const NONCE_PATHS = new Set([NEAR_SIGN_PATH, `${NEAR_SIGN_PATH}/`]);

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

export const cspNonce = createIsomorphicFn()
  .server(() => (NONCE_PATHS.has(getRequestUrl().pathname) ? randomNonce() : undefined))
  .client(() => undefined);
