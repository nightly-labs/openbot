import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { parseBillingPortalRequest } from "@openbot/contracts/billing";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type AuthService, AuthServiceError } from "./auth-service";
import { AvatarUploadError, readAvatarUpload, removeAccountAvatar, storeAccountAvatar } from "./avatar-storage";
import { BILLING_UNAVAILABLE_STATE, BillingError, type BillingService } from "./billing-service";
import { sha256 } from "./crypto";
import type { HostedServerService } from "./hosted-server-service";
import { HOSTED_SITE_LIMITS, HostedSiteInputError, requireIdempotencyKey } from "./hosted-site-contract";
import type { HostedSiteService } from "./hosted-site-service";
import { readJsonObject } from "./json-body";
import { type RemoteControlPlane, RemoteControlPlaneError } from "./remote-control-plane";
import { sendTeamInviteEmail } from "./team-invite-email";
import type { AuthUser, TeamInviteEmailDelivery } from "./types";

const COOKIE = "__Host-openbot-web";
const PREFIX = "/api/browser/";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

export interface BrowserApiServices {
  auth: Pick<
    AuthService,
    | "startEmailSignIn"
    | "verifyEmailCode"
    | "authenticate"
    | "enforceTeamInviteRateLimit"
    | "updateName"
    | "updateAvatar"
    | "listAccountSessions"
    | "revokeAccountSession"
  >;
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
    | "hostAsset"
  >;
  /** The stored logo of one host version, or null. The handler checks membership and the version first. */
  hostLogo: (hostId: string, version: string) => Promise<Response | null>;
  hosting: () => Pick<HostedServerService, "list" | "plans" | "create" | "checkout" | "delete" | "wake">;
  inviteEmailDelivery: () => TeamInviteEmailDelivery | null;
  /** The billing service, or null when this deployment has no Stripe key. */
  billing: () => Pick<BillingService, "getState" | "createPortal"> | null;
  avatarBucket: () => R2Bucket;
  hostedSites: () => Pick<HostedSiteService, "list" | "delete">;
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

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const AVATAR_PATH = "v1/me/avatar";

/**
 * Every write sends JSON, except an avatar upload, which sends the image bytes as the bearer route
 * does. The `X-OpenBot-Browser` header and the same-origin check still apply to it: a cross-site
 * page cannot send that header without a CORS preflight, which this API never answers.
 */
function browserWriteContentTypeAllowed(request: Request, path: string): boolean {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (path === AVATAR_PATH && request.method === "PUT")
    return isAvatarMimeType(contentType.split(";", 1)[0]?.trim() ?? "");
  return contentType.startsWith("application/json");
}

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
      !browserWriteContentTypeAllowed(request, path))
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
    const [, encodedLogoHostId] = /^v2\/remote\/hosts\/([^/]+)\/logo$/u.exec(path) ?? [];
    if (encodedLogoHostId !== undefined && request.method === "GET") {
      const hostId = decodeURIComponent(encodedLogoHostId);
      // Any member may read the logo. The version keeps a cached image from outliving a logo change.
      const { logoKey } = await services.remote.hostAsset(user.id, hostId);
      const logo =
        logoKey && new URL(request.url).searchParams.get("v") === logoKey
          ? await services.hostLogo(hostId, logoKey)
          : null;
      return logo ?? failure(404, "host_logo_not_found", "The host has no logo.");
    }
    const account = await handleAccount(request, path, token, user, services);
    if (account) return account;
    const hosting = await handleHosting(request, path, user, services);
    if (hosting) return hosting;
    const hostedSites = await handleHostedSites(request, path, user, services);
    if (hostedSites) return hostedSites;
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

/**
 * The signed-in account's profile, avatar and sessions: the bearer `/v1/me/...` and
 * `/v1/mobile-auth/devices?includeDesktop=true` routes for a browser. Returns null for any other path.
 */
async function handleAccount(
  request: Request,
  path: string,
  token: string,
  user: AuthUser,
  services: BrowserApiServices,
): Promise<Response | null> {
  if (path === "v1/me/profile" && request.method === "PATCH") {
    const body = await readJsonObject(request);
    if (!isString(body.name)) throw new AuthServiceError(400, "invalid_profile_name", "Enter a valid display name.");
    return json(await services.auth.updateName(token, body.name));
  }
  if (path === AVATAR_PATH && request.method === "PUT") {
    try {
      const upload = await readAvatarUpload(request);
      return json(await storeAccountAvatar(services.auth, services.avatarBucket(), token, user, upload));
    } catch (error) {
      if (error instanceof AvatarUploadError) return failure(error.status, error.code, error.message);
      throw error;
    }
  }
  if (path === AVATAR_PATH && request.method === "DELETE")
    return json(await removeAccountAvatar(services.auth, services.avatarBucket(), token, user));
  if (path === "v1/me/sessions" && request.method === "GET")
    return json({ sessions: await services.auth.listAccountSessions(token) });
  if (path.startsWith("v1/me/billing")) return handleBilling(request, path, user, services);
  // A session ID is a UUID, so the segment needs no decoding; the service refuses any other value.
  const [, sessionId] = /^v1\/me\/sessions\/([^/]+)$/u.exec(path) ?? [];
  if (sessionId !== undefined && request.method === "DELETE") {
    await services.auth.revokeAccountSession(token, sessionId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/**
 * The bearer `/v1/me/billing...` routes for a browser. Stripe sends the user back to `/app`, not to the
 * desktop return page. Returns null for any other path.
 */
async function handleBilling(
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
): Promise<Response | null> {
  const origin = new URL(request.url).origin;
  const billing = services.billing();
  try {
    if (path === "v1/me/billing" && request.method === "GET")
      return json(billing ? await billing.getState(user.id) : BILLING_UNAVAILABLE_STATE);
    if (path === "v1/me/billing/portal" && request.method === "POST") {
      if (!billing) return failure(503, "billing_unavailable", "Billing is not available.");
      const input = parseBillingPortalRequest(await readJsonObject(request));
      if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
      return json({ url: await billing.createPortal(user.id, input, "web", origin) });
    }
  } catch (error) {
    if (error instanceof BillingError) return failure(error.status, error.code, error.message);
    throw error;
  }
  return null;
}

/** The hosted servers of the account. Returns null when the path is not one of them. */
async function handleHosting(
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
): Promise<Response | null> {
  // Stripe sends the user back to `/app` on this origin, not to the desktop return page.
  const returnTo = { target: "web", origin: new URL(request.url).origin } as const;
  if (path === "v2/hosting/plans" && request.method === "GET") return json(await services.hosting().plans(user));
  if (path === "v2/hosting/servers") {
    if (request.method === "GET") return json(await services.hosting().list(user));
    if (request.method !== "POST") return null;
    const body = await readJsonObject(request);
    return json(
      await services
        .hosting()
        .create(
          user,
          { name: body.name, plan: body.plan, interval: body.interval, currency: body.currency },
          request.headers.get("Idempotency-Key"),
          returnTo,
        ),
      201,
    );
  }
  const [, encodedServerId, action] = /^v2\/hosting\/servers\/([^/]+)(?:\/(wake|checkout))?$/u.exec(path) ?? [];
  if (encodedServerId === undefined) return null;
  const serverId = decodeURIComponent(encodedServerId);
  if (action === "wake" && request.method === "POST") return json(await services.hosting().wake(user, serverId));
  if (action === "checkout" && request.method === "POST") {
    return json(await services.hosting().checkout(user, serverId, returnTo));
  }
  if (action === undefined && request.method === "DELETE") {
    const body = await readJsonObject(request);
    await services.hosting().delete(user, serverId, body.confirmName);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/**
 * The account's published sites: the bearer `/v1/sites/` list and delete routes for a browser.
 * Publishing reads a local folder, so it stays on the desktop. Returns null for any other path.
 */
async function handleHostedSites(
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
): Promise<Response | null> {
  try {
    if (path === "v1/sites" && request.method === "GET")
      return json({ sites: await services.hostedSites().list(user.id), limit: HOSTED_SITE_LIMITS.activeSites });
    const [, encodedSiteId] = /^v1\/sites\/([^/]+)$/u.exec(path) ?? [];
    if (encodedSiteId === undefined || request.method !== "DELETE") return null;
    const key = requireIdempotencyKey(request);
    await services.hostedSites().delete(user.id, decodeURIComponent(encodedSiteId), key);
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof HostedSiteInputError) return failure(error.status, error.code, error.message);
    throw error;
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
