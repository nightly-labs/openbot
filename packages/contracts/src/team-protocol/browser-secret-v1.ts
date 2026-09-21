import { isBrowserSecretRequest } from "../ipc-browser-secret";
import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV4BaseJsonValue } from "./v4-base";

/** Add only validated public metadata beside the frozen takeover projection. */
export function restoreBrowserSecretMetadata(
  projected: TeamProtocolV4BaseJsonValue,
  source: unknown,
): TeamProtocolV4BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  if (projected.type === "browser-takeover-requested")
    return { ...projected, request: restoreRequest(projected.request, source.request) };
  if (
    projected.type === "runtime-snapshot" &&
    isDynamicRecord(projected.snapshot) &&
    isDynamicRecord(source.snapshot)
  ) {
    const targets = projected.snapshot.pendingBrowserTakeovers;
    const originals = source.snapshot.pendingBrowserTakeovers;
    if (Array.isArray(targets) && Array.isArray(originals)) {
      return {
        ...projected,
        snapshot: {
          ...projected.snapshot,
          pendingBrowserTakeovers: targets.map((target) =>
            isDynamicRecord(target)
              ? restoreRequest(
                  target,
                  originals.find((item) => isDynamicRecord(item) && item.requestId === target.requestId),
                )
              : target,
          ),
        },
      };
    }
  }
  return projected;
}

function restoreRequest(target: TeamProtocolV4BaseJsonValue, source: unknown): TeamProtocolV4BaseJsonValue {
  if (!isDynamicRecord(target) || !isDynamicRecord(source) || source.secret === undefined) return target;
  if (!isBrowserSecretRequest(source.secret)) throw new Error("Invalid secure authentication metadata.");
  return {
    ...target,
    secret: {
      method: source.secret.method,
      origin: source.secret.origin,
      digits: source.secret.digits,
      ...(source.secret.requiresReload ? { requiresReload: true } : {}),
    },
  };
}
