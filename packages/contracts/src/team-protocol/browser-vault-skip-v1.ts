// Frozen optional browser-vault-skip-v1 wire contract.
//
// A host adds `vaultSkip` beside the frozen keys of a takeover request, in a `browser-takeover-requested`
// event and in the `pendingBrowserTakeovers` of a `runtime-snapshot`, when the host did not fill a saved
// login and asks the user for the password or code. The value says why:
//
// - `agent-script`: a script that the agent ran can still run in a page of this site.
// - `field-kind`: the agent's target is not a password field, or not a code field.
// - `login-choice`: several logins fit and the agent named none, or it named one that this site does not have.
// - `no-secret`: the login has no password, or no authenticator key.
// - `vault-unreadable`: the password manager could not be read.
//
// It names no login, account or value. The host adds it only for a client that advertises the
// capability, on protocol 9, so the wire of every released client stays as it was; such a client shows
// the card with no reason. A host without the capability never sends the field, so a client accepts it
// whenever it is present. A value outside this list fails closed. Widening it needs a second capability
// string.
import { isDynamicRecord, isOneOf } from "../runtime-values";
import { mapBrowserTakeoverRequests } from "./browser-secret-v1";
import type { TeamProtocolV4BaseJsonValue } from "./v4-base";

export const BROWSER_VAULT_SKIP_CAPABILITY = "browser-vault-skip-v1";

const VAULT_SKIP_REASONS = ["agent-script", "field-kind", "login-choice", "no-secret", "vault-unreadable"] as const;

/** Adds the validated vault skip reason beside the frozen takeover projection. */
export function restoreBrowserVaultSkip(
  projected: TeamProtocolV4BaseJsonValue,
  source: unknown,
): TeamProtocolV4BaseJsonValue {
  return mapBrowserTakeoverRequests(projected, source, (target, request) => {
    if (!isDynamicRecord(target) || !isDynamicRecord(request) || request.vaultSkip === undefined) return target;
    if (!isOneOf(VAULT_SKIP_REASONS, request.vaultSkip)) throw new Error("Invalid browser vault skip reason.");
    return { ...target, vaultSkip: request.vaultSkip };
  });
}
