import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type AuthService, AuthServiceError } from "./auth-service";
import { sha256 } from "./crypto";
import { readJsonObject } from "./json-body";
import type { RemoteControlPlane } from "./remote-control-plane";

const COOKIE = "__Host-openbot-web";
const PREFIX = "/api/browser/";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

export interface BrowserApiServices {
  auth: Pick<AuthService, "startEmailSignIn" | "verifyEmailCode" | "authenticate">;
  remote: Pick<
    RemoteControlPlane,
    | "listHosts"
    | "startSession"
    | "issueSessionTicket"
    | "endSession"
    | "endAccountSession"
    | "previewInvite"
    | "acceptInvite"
  >;
  signalUrl: () => string;
  sourceIp: (request: Request) => string;
  errorResponse: (error: unknown) => Response;
}

function requiredString(value: DynamicRecord, field: string): string {
  const text = value[field];
  if (!isString(text) || !text.trim())
    throw new AuthServiceError(400, "invalid_browser_request", "The request is invalid.");
  return text;
}

function json<T>(value: T, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function failure(status: number, message: string): Response {
  return json({ error: { message } }, status);
}

export function browserSessionToken(request: Request): string | null {
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE}=`));
  const [value] = values;
  if (values.length !== 1 || value === undefined) return null;
  const token = value.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{20,512}$/u.test(token) ? token : null;
}

/** A closed list of account operations. Chat traffic never passes through this handler. */
export async function handleBrowserApi(request: Request, services: BrowserApiServices): Promise<Response> {
  const path = new URL(request.url).pathname.slice(PREFIX.length).replace(/\/$/u, "");
  if (request.method !== "GET" && request.method !== "POST") return failure(405, "This method is not supported.");
  if (
    request.method === "POST" &&
    (request.headers.get("Origin") !== new URL(request.url).origin ||
      request.headers.get("X-OpenBot-Browser") !== "1" ||
      !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
  )
    return failure(403, "The browser request was refused.");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return failure(403, "The browser request was refused.");
  try {
    if (path === "email/start" && request.method === "POST") {
      const body = await readJsonObject(request);
      return json(
        await services.auth.startEmailSignIn(
          requiredString(body, "email"),
          services.sourceIp(request),
          request.headers.get("Idempotency-Key") ?? undefined,
        ),
      );
    }
    if (path === "email/verify" && request.method === "POST") {
      const body = await readJsonObject(request);
      const result = await services.auth.verifyEmailCode({
        challengeId: requiredString(body, "challengeId"),
        code: requiredString(body, "code"),
        sourceIp: services.sourceIp(request),
      });
      const previous = browserSessionToken(request);
      if (previous) {
        const user = await services.auth.authenticate(previous);
        if (user) await services.remote.endAccountSession(user.id, await sha256(previous));
      }
      const response = json({ user: result.user });
      response.headers.set("Set-Cookie", `${COOKIE}=${result.sessionToken}; ${COOKIE_ATTRIBUTES}; Max-Age=34560000`);
      return response;
    }
    const token = browserSessionToken(request);
    const user = token ? await services.auth.authenticate(token) : null;
    if (path === "logout" && request.method === "POST") {
      if (token && user) await services.remote.endAccountSession(user.id, await sha256(token));
      const response = json({ signedOut: true });
      response.headers.set("Set-Cookie", `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);
      return response;
    }
    if (!token || !user) return failure(401, "Sign in is required.");
    if (path === "session" && request.method === "GET") return json({ user });
    if (path === "v2/remote/hosts" && request.method === "GET")
      return json({ hosts: await services.remote.listHosts(user.id) });
    if (request.method !== "POST") return failure(404, "This browser operation is not available.");
    const body = await readJsonObject(request);
    if (path === "v2/remote/sessions")
      return json(
        await services.remote.startSession(user.id, requiredString(body, "hostId"), await sha256(token)),
        201,
      );
    const [, encodedSessionId, sessionAction] = /^v2\/remote\/sessions\/([^/]+)\/(ticket|end)$/u.exec(path) ?? [];
    if (encodedSessionId !== undefined) {
      const sessionId = decodeURIComponent(encodedSessionId);
      if (sessionAction === "end") {
        await services.remote.endSession(user.id, sessionId, await sha256(token));
        return json({ ended: true });
      }
      return json({
        ...(await services.remote.issueSessionTicket(
          user.id,
          sessionId,
          requiredString(body, "clientPublicKey"),
          await sha256(token),
        )),
        signalUrl: services.signalUrl(),
      });
    }
    if (path === "v2/remote/invites/preview")
      return json(await services.remote.previewInvite(requiredString(body, "token")));
    if (path === "v2/remote/invites/accept")
      return json(await services.remote.acceptInvite(user, requiredString(body, "token")));
    return failure(404, "This browser operation is not available.");
  } catch (error) {
    return services.errorResponse(error);
  }
}
