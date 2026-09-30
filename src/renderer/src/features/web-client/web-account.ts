import type { AccountSession, AvatarImageInput } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { currentText } from "@openbot/ui/text";

/**
 * The desktop Settings > Profile calls for a signed-in browser. They use the
 * `/api/browser/v1/...` operations, which authenticate with the browser cookie instead of a bearer token.
 */
export interface WebAccountCalls {
  updateName: (name: string) => Promise<void>;
  updateAvatar: (image: AvatarImageInput | null) => Promise<void>;
  listSessions: () => Promise<AccountSession[]>;
  revokeSession: (sessionId: string) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 15_000;

export function createWebAccountCalls(
  accountFetch: typeof fetch,
  onAccountChanged: () => Promise<void>,
): WebAccountCalls {
  async function request(
    path: string,
    init: { method: string; body?: BodyInit; contentType?: string } = { method: "GET" },
  ): Promise<Response> {
    // As the team client's browser requests: a stalled request fails, so the panel does not stay busy.
    const response = await accountFetch(`/api/browser/${path}`, {
      method: init.method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers:
        init.method === "GET"
          ? {}
          : {
              "Content-Type": init.contentType ?? "application/json",
              "X-OpenBot-Browser": "1",
            },
      ...(init.body === undefined ? {} : { body: init.body }),
    }).catch(() => {
      throw new Error(errorMessage(null));
    });
    if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
    return response;
  }

  return {
    async updateName(name) {
      await request("v1/me/profile", { method: "PATCH", body: JSON.stringify({ name }) });
      await onAccountChanged();
    },
    async updateAvatar(image) {
      await request(
        "v1/me/avatar",
        image
          ? { method: "PUT", body: new Uint8Array(image.bytes), contentType: image.mimeType }
          : { method: "DELETE", body: "{}" },
      );
      await onAccountChanged();
    },
    async listSessions() {
      const value = await (await request("v1/me/sessions")).json().catch(() => null);
      if (!isDynamicRecord(value) || !Array.isArray(value.sessions)) throw new Error(errorMessage(null));
      return value.sessions.map(decodeSession);
    },
    async revokeSession(sessionId) {
      await request(`v1/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", body: "{}" });
    },
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message))
    return value.error.message;
  return currentText().t("webClient.error.requestFailed");
}

function decodeSession(value: unknown): AccountSession {
  if (
    !isDynamicRecord(value) ||
    !isString(value.sessionId) ||
    !isString(value.name) ||
    (value.kind !== "desktop" && value.kind !== "mobile") ||
    !isBoolean(value.current) ||
    !isNumber(value.connectedAt) ||
    !isNumber(value.lastActiveAt)
  )
    throw new Error(errorMessage(null));
  return {
    sessionId: value.sessionId,
    name: value.name,
    kind: value.kind,
    current: value.current,
    connectedAt: value.connectedAt,
    lastActiveAt: value.lastActiveAt,
  };
}
