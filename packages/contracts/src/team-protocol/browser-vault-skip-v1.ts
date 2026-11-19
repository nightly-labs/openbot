import { isDynamicRecord, isOneOf } from "../runtime-values";
import { mapBrowserTakeoverRequests } from "./browser-secret-v1";
import type { TeamProtocolV4BaseJsonValue } from "./v4-base";

export const BROWSER_VAULT_SKIP_CAPABILITY = "browser-vault-skip-v1";

const VAULT_SKIP_REASONS = ["agent-script", "field-kind", "login-choice", "no-secret", "vault-unreadable"] as const;

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
