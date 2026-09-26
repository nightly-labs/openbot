import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type AuthService, AuthServiceError } from "./auth-service";
import { sha256 } from "./crypto";
import { readJsonObject } from "./json-body";
import { type RemoteControlPlane, RemoteControlPlaneError } from "./remote-control-plane";
import { sendTeamInviteEmail } from "./team-invite-email";
import type { AuthUser, TeamInviteEmailDelivery } from "./types";

const COOKIE = "__Host-openbot-web";
const PREFIX = "/api/browser/";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

export interface BrowserApiServices {
  auth: Pick<AuthService, "startEmailSignIn" | "verifyEmailCode" | "authenticate" | "enforceTeamInviteRateLimit">;
  remote: Pick<
    RemoteControlPlane,
    | "listHosts"
    | "startSession"
    | "issueSessionTicket"
    | "endSession"
    | "endAccountSession"
    | "previewInvite"
    | "acceptInvite"
    | "listMembers"
    | "listInvites"
    | "createInvite"
    | "revokeInvite"
    | "changeMembership"
  >;
  inviteEmailDelivery: () => TeamInviteEmailDelivery | null;
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

/** The same checks and messages as the bearer member and invite routes. */
function invalidRemoteRequest(message: string): RemoteControlPlaneError {
  return new RemoteControlPlaneError(400, "invalid_remote_request", message);
}

function json<T>(value: T, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** The same `{ error: { code, message } }` shape as every other account API refusal. */
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
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

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PATCH", "DELETE"]);

/**
 * A closed list of account operations. Chat traffic never passes through this handler.
 *
 * The member and invite operations are the bearer `/v2/remote/...` routes for a signed-in browser:
 * they call the same control-plane methods, so the host role checks there are the only gate.
 */
export async function handleBrowserApi(request: Request, services: BrowserApiServices): Promise<Response> {
  const path = new URL(request.url).pathname.slice(PREFIX.length).replace(/\/$/u, "");
  if (!METHODS.has(request.method)) return failure(405, "method_not_allowed", "This method is not supported.");
  if (
    request.method !== "GET" &&
    (request.headers.get("Origin") !== new URL(request.url).origin ||
      request.headers.get("X-OpenBot-Browser") !== "1" ||
      !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
  )
    return failure(403, "browser_request_refused", "The browser request was refused.");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    return failure(403, "browser_request_refused", "The browser request was refused.");
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
    if (!token || !user) return failure(401, "sign_in_required", "Sign in is required.");
    if (path === "session" && request.method === "GET") return json({ user });
    if (path === "v2/remote/hosts" && request.method === "GET")
      return json({ hosts: await services.remote.listHosts(user.id) });
    const administration = await handleAdministration(request, path, user, services);
    if (administration) return administration;
    if (request.method !== "POST")
      return failure(404, "browser_operation_not_found", "This browser operation is not available.");
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
    if (path === "v1/team-invitations/email") {
      await sendTeamInviteEmail(
        { auth: services.auth, delivery: services.inviteEmailDelivery },
        user,
        body,
        services.sourceIp(request),
      );
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    return failure(404, "browser_operation_not_found", "This browser operation is not available.");
  } catch (error) {
    return services.errorResponse(error);
  }
}

/** Members and invites of one host. Returns null when the path and method are not one of them. */
async function handleAdministration(
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
): Promise<Response | null> {
  const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const [, encodedInviteId] = /^v2\/remote\/invites\/([^/]+)$/u.exec(path) ?? [];
  if (encodedInviteId !== undefined && request.method === "DELETE") {
    await services.remote.revokeInvite(user.id, decodeURIComponent(encodedInviteId));
    return noContent();
  }
  const [, encodedHostId, collection, encodedMembershipId] =
    /^v2\/remote\/hosts\/([^/]+)\/(members|invites)(?:\/([^/]+))?$/u.exec(path) ?? [];
  if (encodedHostId === undefined) return null;
  const hostId = decodeURIComponent(encodedHostId);
  if (collection === "members" && encodedMembershipId === undefined && request.method === "GET")
    return json({ members: await services.remote.listMembers(user.id, hostId) });
  if (collection === "invites" && encodedMembershipId === undefined && request.method === "GET")
    return json({ invites: await services.remote.listInvites(user.id, hostId) });
  if (collection === "invites" && encodedMembershipId === undefined && request.method === "POST") {
    const body = await readJsonObject(request);
    if (
      (body.role !== "admin" && body.role !== "member") ||
      !(body.email === undefined || body.email === null || isString(body.email)) ||
      !(body.expiresInSeconds === undefined || isNumber(body.expiresInSeconds)) ||
      !(body.permanent === undefined || isBoolean(body.permanent))
    )
      throw invalidRemoteRequest("The invitation is invalid.");
    return json(
      await services.remote.createInvite(user, {
        hostId,
        role: body.role,
        email: body.email,
        expiresInSeconds: body.expiresInSeconds,
        permanent: body.permanent,
      }),
      201,
    );
  }
  if (collection !== "members" || encodedMembershipId === undefined) return null;
  const membershipId = decodeURIComponent(encodedMembershipId);
  if (request.method === "DELETE") {
    await services.remote.changeMembership(user.id, { hostId, membershipId, revoke: true });
    return noContent();
  }
  if (request.method !== "PATCH") return null;
  const body = await readJsonObject(request);
  if (body.role !== "admin" && body.role !== "member") throw invalidRemoteRequest("The member role is invalid.");
  if (body.reactivate !== undefined && body.reactivate !== true)
    throw invalidRemoteRequest("The member status is invalid.");
  await services.remote.changeMembership(user.id, {
    hostId,
    membershipId,
    role: body.role,
    reactivate: body.reactivate === true,
  });
  return noContent();
}
