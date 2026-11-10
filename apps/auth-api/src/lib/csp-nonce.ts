import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestUrl } from "@tanstack/solid-start/server";
import { NEAR_SIGN_PATH } from "./near-sign-csp";

/** The pages whose `Content-Security-Policy` allows only the inline scripts that carry the nonce. */
const NONCE_PATHS = new Set([NEAR_SIGN_PATH, `${NEAR_SIGN_PATH}/`]);

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The script nonce of the page being rendered. The router gives it to every script that it and Solid
 * write in the HTML, and the page's route puts it in the `Content-Security-Policy` header. It is made
 * only for the pages in `NONCE_PATHS`: on other pages the browser would compare the attribute when it
 * looks for a head script, and add the script a second time. The browser reads it back from the
 * `csp-nonce` meta tag that the router writes, so the client half returns nothing.
 *
 * Only the router imports this, for the same reason as `servingSiteUrl`.
 */
export const cspNonce = createIsomorphicFn()
  .server(() => (NONCE_PATHS.has(getRequestUrl().pathname) ? randomNonce() : undefined))
  .client(() => undefined);
