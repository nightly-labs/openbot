import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { parseBillingPortalRequest } from "@openbot/contracts/billing";
import { WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM } from "@openbot/contracts/company-sign-in";
import { parseHostedServerLifecycleInput } from "@openbot/contracts/hosted-servers";
import {
  LICENSE_UNAVAILABLE_STATE,
  parseLicenseCheckoutRequest,
  parseLicensePlanRequest,
  parseLicenseRenewalRequest,
  parseLicenseUsersRequest,
} from "@openbot/contracts/license";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect } from "effect";
import { type AccountAttribution, requestFirstTouch } from "./account-attribution";
import { type AuthService, AuthServiceError, readAnalyticsAnswer, readChatColor } from "./auth-service";
import { AvatarUploadError, readAvatarUpload, removeAccountAvatar, storeAccountAvatar } from "./avatar-storage";
import { BILLING_UNAVAILABLE_STATE, BillingError, type BillingService } from "./billing-service";
import { companySignInApiOrigin } from "./canonical-redirect";
import { CompanySignInError, type CompanySignInService, WEB_RETURN_PATH } from "./company-sign-in";
import { randomToken, sha256 } from "./crypto";
import { runApiResponse } from "./effect-runtime";
import type { readHostLogo } from "./host-logo";
import type { HostedServerService } from "./hosted-server-service";
import { HostedSiteInputError, requireIdempotencyKey } from "./hosted-site-contract";
import type { HostedSiteService } from "./hosted-site-service";
import { readJsonObject } from "./json-body";
import { type RemoteControlPlane, RemoteControlPlaneError } from "./remote-control-plane";
import { sendTeamInviteEmail } from "./team-invite-email";
import type { AuthUser, TeamInviteEmailDelivery } from "./types";

const COOKIE = "__Host-openbot-web";
const PREFIX = "/api/browser/";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
/**
 * The company sign-in that this browser started: its state and verifier. Only this browser can finish
 * it, so a provider page that someone else opened cannot sign this browser in.
 */
const COMPANY_COOKIE = "__Host-openbot-company";
const COMPANY_FLOW_SECONDS = 600;

export interface BrowserApiServices {
  auth: Pick<
    AuthService,
    | "startEmailSignIn"
    | "verifyEmailCode"
    | "authenticate"
    | "enforceTeamInviteRateLimit"
    | "updateAnalytics"
    | "updateChatColor"
    | "updateName"
    | "updateAvatar"
    | "listAccountSessions"
    | "revokeAccountSession"
    | "createServerClaimForUser"
  >;
  remote: Pick<
    RemoteControlPlane,
    | "listHosts"
    | "removeOwnedHost"
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
    | "emailableInvite"
  >;
  /** The methods bind their service, so this is the whole service. */
  companySignIn: () => CompanySignInService;
  /** The stored logo of one host version, or null. The handler checks membership and the version first. */
  hostLogo: (hostId: string, version: string) => ReturnType<typeof readHostLogo>;
  hosting: () => Pick<
    HostedServerService,
    "list" | "plans" | "create" | "checkout" | "delete" | "wake" | "restart" | "status" | "lifecycle"
  >;
  inviteEmailDelivery: () => TeamInviteEmailDelivery | null;
  attribution: () => Pick<AccountAttribution, "recordCheckout">;
  /** The billing service, or null when this deployment has no Stripe key. */
  billing: () => Pick<BillingService, "getState" | "createPortal" | "license"> | null;
  avatarBucket: () => R2Bucket;
  hostedSites: () => Pick<HostedSiteService, "list" | "delete">;
  sourceIp: (request: Request) => string;
  errorResponse: (error: unknown) => Response;
}

function requiredString(value: DynamicRecord, field: string): Effect.Effect<string, AuthServiceError> {
  const text = value[field];
  return isString(text) && text.trim()
    ? Effect.succeed(text)
    : Effect.fail(new AuthServiceError(400, "invalid_browser_request", "The request is invalid."));
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

/** Answers one refusal class with its own status, whether the operation failed with it or threw it. */
function refuseWith(refusal: abstract new (...args: never) => { status: number; code: string; message: string }) {
  return <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    operation.pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return error instanceof refusal
          ? Effect.succeed(failure(error.status, error.code, error.message))
          : Effect.failCause(cause);
      }),
    );
}

function cookieValue(request: Request, name: string): string | null {
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  const [value] = values;
  if (values.length !== 1 || value === undefined) return null;
  return value.slice(name.length + 1);
}

function browserSessionToken(request: Request): string | null {
  const token = cookieValue(request, COOKIE);
  return token !== null && /^[A-Za-z0-9_-]{20,512}$/u.test(token) ? token : null;
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
export function handleBrowserApi(request: Request, services: BrowserApiServices): Promise<Response> {
  const path = new URL(request.url).pathname.slice(PREFIX.length).replace(/\/$/u, "");
  if (!METHODS.has(request.method))
    return Promise.resolve(failure(405, "method_not_allowed", "This method is not supported."));
  if (
    request.method !== "GET" &&
    (request.headers.get("Origin") !== new URL(request.url).origin ||
      request.headers.get("X-OpenBot-Browser") !== "1" ||
      !browserWriteContentTypeAllowed(request, path))
  )
    return Promise.resolve(failure(403, "browser_request_refused", "The browser request was refused."));
  // The company provider sends the browser here, so this navigation is cross-site. The flow cookie
  // of the browser that started the sign-in is its check.
  if (path === "company/return" && request.method === "GET")
    return runApiResponse(finishCompanySignIn(request, services), services.errorResponse);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    return Promise.resolve(failure(403, "browser_request_refused", "The browser request was refused."));
  return runApiResponse(handleBrowserOperation(request, path, services), services.errorResponse);
}

/**
 * The provider's return through the account service. A sign-in that finished gets the session cookie,
 * as an email code does. Every answer goes back to the web app and removes the flow cookie.
 */
const finishCompanySignIn = Effect.fn("BrowserApi.finishCompanySignIn")(function* (
  request: Request,
  services: BrowserApiServices,
) {
  const url = new URL(request.url);
  const cookies = [`${COMPANY_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`];
  const back = (error?: string) => {
    const target = new URL("/app", url.origin);
    if (error) target.searchParams.set(WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM, error);
    const headers = new Headers({
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  };
  const [clientState, verifier] = cookieValue(request, COMPANY_COOKIE)?.split(".") ?? [];
  if (!clientState || !verifier || url.searchParams.get("state") !== clientState)
    return back("invalid_company_sign_in_code");
  const error = url.searchParams.get("error");
  if (error) return back(/^[a-z_]{1,64}$/u.test(error) ? error : "company_sign_in_failed");
  const result = yield* services
    .companySignIn()
    .exchange({ code: url.searchParams.get("code") ?? "", codeVerifier: verifier })
    .pipe(
      Effect.map((session) => ({ session })),
      Effect.catchTag("CompanySignInError", (refusal) => Effect.succeed({ error: refusal.code })),
    );
  if ("error" in result) return back(result.error);
  const previous = browserSessionToken(request);
  if (previous) {
    const user = yield* services.auth.authenticate(previous);
    if (user) yield* services.remote.endAccountSession(user.id, yield* sha256(previous));
  }
  cookies.push(`${COOKIE}=${result.session.sessionToken}; ${COOKIE_ATTRIBUTES}; Max-Age=34560000`);
  return back();
});

const handleBrowserOperation = Effect.fn("BrowserApi.handleOperation")(function* (
  request: Request,
  path: string,
  services: BrowserApiServices,
) {
  if (path === "email/start" && request.method === "POST") {
    const body = yield* readJsonObject(request);
    return json(
      yield* services.auth.startEmailSignIn(
        yield* requiredString(body, "email"),
        services.sourceIp(request),
        request.headers.get("Idempotency-Key") ?? undefined,
      ),
    );
  }
  if (path === "email/verify" && request.method === "POST") {
    const body = yield* readJsonObject(request);
    const result = yield* services.auth.verifyEmailCode({
      challengeId: yield* requiredString(body, "challengeId"),
      code: yield* requiredString(body, "code"),
      sourceIp: services.sourceIp(request),
      surface: "web",
      firstTouch: requestFirstTouch(body.firstTouch),
    });
    const previous = browserSessionToken(request);
    if (previous) {
      const user = yield* services.auth.authenticate(previous);
      if (user) yield* services.remote.endAccountSession(user.id, yield* sha256(previous));
    }
    const response = json({ user: result.user });
    response.headers.set("Set-Cookie", `${COOKIE}=${result.sessionToken}; ${COOKIE_ATTRIBUTES}; Max-Age=34560000`);
    return response;
  }
  if (path === "company/start" && request.method === "POST") {
    // The email start answered `company_sign_in_required`. The page goes to the answer in this tab.
    const body = yield* readJsonObject(request);
    const email = yield* requiredString(body, "email");
    const site = new URL(request.url);
    const clientState = randomToken(24);
    const verifier = randomToken(32);
    return yield* services
      .companySignIn()
      .startSignIn(
        {
          email,
          returnTo: new URL(WEB_RETURN_PATH, site.origin).toString(),
          clientState,
          clientChallenge: yield* sha256(verifier),
          sourceIp: services.sourceIp(request),
        },
        companySignInApiOrigin(site),
        site.origin,
      )
      .pipe(
        Effect.map(({ authorizationUrl }) => {
          const response = json({ authorizationUrl });
          response.headers.set(
            "Set-Cookie",
            `${COMPANY_COOKIE}=${clientState}.${verifier}; ${COOKIE_ATTRIBUTES}; Max-Age=${COMPANY_FLOW_SECONDS}`,
          );
          return response;
        }),
        refuseWith(CompanySignInError),
      );
  }
  if (path === "checkout-attribution" && request.method === "POST") {
    // The page after a desktop checkout. The session ID that Stripe put in its URL is the only proof.
    const body = yield* readJsonObject(request);
    const firstTouch = requestFirstTouch(body.firstTouch);
    if (isString(body.sessionId) && firstTouch) {
      yield* services
        .attribution()
        .recordCheckout(body.sessionId, firstTouch)
        .pipe(Effect.catch(() => Effect.sync(() => console.warn("Account attribution save failed."))));
    }
    return json({ accepted: true });
  }
  const token = browserSessionToken(request);
  const user = token ? yield* services.auth.authenticate(token) : null;
  if (path === "logout" && request.method === "POST") {
    if (token && user) yield* services.remote.endAccountSession(user.id, yield* sha256(token));
    const response = json({ signedOut: true });
    response.headers.set("Set-Cookie", `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);
    return response;
  }
  if (!token || !user) return failure(401, "sign_in_required", "Sign in is required.");
  if (path === "session" && request.method === "GET") return json({ user });
  if (path === "v2/remote/hosts" && request.method === "GET")
    return json({ hosts: yield* services.remote.listHosts(user.id) });
  const [, removedHostId] = /^v2\/remote\/hosts\/([^/]+)$/u.exec(path) ?? [];
  if (removedHostId !== undefined && request.method === "DELETE") {
    yield* services.remote.removeOwnedHost(user.id, decodeURIComponent(removedHostId));
    return new Response(null, { status: 204 });
  }
  const [, encodedLogoHostId] = /^v2\/remote\/hosts\/([^/]+)\/logo$/u.exec(path) ?? [];
  if (encodedLogoHostId !== undefined && request.method === "GET") {
    const hostId = decodeURIComponent(encodedLogoHostId);
    // Any member may read the logo. The version keeps a cached image from outliving a logo change.
    const { logoKey } = yield* services.remote.hostAsset(user.id, hostId);
    const logo =
      logoKey && new URL(request.url).searchParams.get("v") === logoKey
        ? yield* services.hostLogo(hostId, logoKey)
        : null;
    return logo ?? failure(404, "host_logo_not_found", "The host has no logo.");
  }
  const account = yield* handleAccount(request, path, token, user, services);
  if (account) return account;
  const hosting = yield* handleHosting(request, path, user, services);
  if (hosting) return hosting;
  const hostedSites = yield* handleHostedSites(request, path, user, services);
  if (hostedSites) return hostedSites;
  const administration = yield* handleAdministration(request, path, user, services);
  if (administration) return administration;
  if (request.method !== "POST")
    return failure(404, "browser_operation_not_found", "This browser operation is not available.");
  const body = yield* readJsonObject(request);
  if (path === "v2/remote/sessions")
    return json(
      yield* services.remote.startSession(user.id, yield* requiredString(body, "hostId"), yield* sha256(token)),
      201,
    );
  const [, encodedSessionId, sessionAction] = /^v2\/remote\/sessions\/([^/]+)\/(ticket|end)$/u.exec(path) ?? [];
  if (encodedSessionId !== undefined) {
    const sessionId = decodeURIComponent(encodedSessionId);
    if (sessionAction === "end") {
      yield* services.remote.endSession(user.id, sessionId, yield* sha256(token));
      return json({ ended: true });
    }
    return json(
      yield* services.remote.issueSessionTicket(
        user.id,
        sessionId,
        yield* requiredString(body, "clientPublicKey"),
        yield* sha256(token),
      ),
    );
  }
  if (path === "v2/remote/invites/preview")
    return json(yield* services.remote.previewInvite(yield* requiredString(body, "token")));
  if (path === "v2/remote/invites/accept")
    return json(yield* services.remote.acceptInvite(user, yield* requiredString(body, "token")));
  if (path === "v1/team-invitations/email") {
    yield* sendTeamInviteEmail(
      { auth: services.auth, remote: services.remote, delivery: services.inviteEmailDelivery },
      user,
      body,
      services.sourceIp(request),
    );
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return failure(404, "browser_operation_not_found", "This browser operation is not available.");
});

/**
 * The signed-in account's profile, avatar and sessions: the bearer `/v1/me/...` and
 * `/v1/mobile-auth/devices?includeDesktop=true` routes for a browser. Returns null for any other path.
 */
const handleAccount = Effect.fn("BrowserApi.handleAccount")(function* (
  request: Request,
  path: string,
  token: string,
  user: AuthUser,
  services: BrowserApiServices,
) {
  if (path === "v1/me/profile" && request.method === "PATCH") {
    const body = yield* readJsonObject(request);
    if (!isString(body.name))
      return yield* new AuthServiceError(400, "invalid_profile_name", "Enter a valid display name.");
    return json(yield* services.auth.updateName(token, body.name));
  }
  if (path === "v1/me/analytics" && request.method === "PUT") {
    const answer = readAnalyticsAnswer(yield* readJsonObject(request));
    if (!answer)
      return yield* new AuthServiceError(400, "invalid_analytics_preference", "The analytics setting is not valid.");
    return json(yield* services.auth.updateAnalytics(token, answer));
  }
  if (path === "v1/me/chat-color" && request.method === "PUT") {
    const chatColor = readChatColor(yield* readJsonObject(request));
    if (chatColor === undefined)
      return yield* new AuthServiceError(400, "invalid_chat_color", "The chat color is not valid.");
    return json(yield* services.auth.updateChatColor(token, chatColor));
  }
  if (path === AVATAR_PATH && request.method === "PUT") {
    return yield* Effect.gen(function* () {
      const upload = yield* readAvatarUpload(request);
      return json(yield* storeAccountAvatar(services.auth, services.avatarBucket(), token, user, upload));
    }).pipe(refuseWith(AvatarUploadError));
  }
  if (path === AVATAR_PATH && request.method === "DELETE")
    return json(yield* removeAccountAvatar(services.auth, services.avatarBucket(), token, user));
  if (path === "v1/me/sessions" && request.method === "GET")
    return json({ sessions: yield* services.auth.listAccountSessions(token) });
  // The install command of a self-hosted server. Never log the claim.
  if (path === "v2/server-claims" && request.method === "POST")
    return json(yield* services.auth.createServerClaimForUser(user.id));
  if (path.startsWith("v1/me/billing") || path.startsWith("v1/me/license"))
    return yield* handleBilling(request, path, user, services);
  // A session ID is a UUID, so the segment needs no decoding; the service refuses any other value.
  const [, sessionId] = /^v1\/me\/sessions\/([^/]+)$/u.exec(path) ?? [];
  if (sessionId !== undefined && request.method === "DELETE") {
    yield* services.auth.revokeAccountSession(token, sessionId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return null;
});

/**
 * The bearer `/v1/me/billing...` and `/v1/me/license...` routes for a browser. Stripe sends the user back to `/app`, not to the
 * desktop return page. Returns null for any other path.
 */
const handleBilling = Effect.fn("BrowserApi.handleBilling")(function* (
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
) {
  const origin = new URL(request.url).origin;
  const billing = services.billing();
  if (path === "v1/me/billing" && request.method === "GET")
    return json(billing ? yield* billing.getState(user.id) : BILLING_UNAVAILABLE_STATE);
  if (path === "v1/me/billing/portal" && request.method === "POST") {
    if (!billing) return failure(503, "billing_unavailable", "Billing is not available.");
    const input = parseBillingPortalRequest(yield* readJsonObject(request));
    if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
    return json({ url: yield* billing.createPortal(user.id, input, "web", origin) });
  }
  if (path === "v1/me/license" && request.method === "GET")
    return json(billing ? yield* billing.license.getState(user.id) : LICENSE_UNAVAILABLE_STATE);
  if (!path.startsWith("v1/me/license/") || request.method !== "POST") return null;
  if (!billing) return failure(503, "billing_unavailable", "Billing is not available.");
  const body = yield* readJsonObject(request);
  if (path === "v1/me/license/checkout") {
    const input = parseLicenseCheckoutRequest(body);
    if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
    return json({ url: yield* billing.license.createCheckout(user, input, "web", origin) });
  }
  if (path === "v1/me/license/users") {
    const input = parseLicenseUsersRequest(body);
    if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
    return json(yield* billing.license.setUsers(user.id, input.users));
  }
  if (path === "v1/me/license/plan") {
    const input = parseLicensePlanRequest(body);
    if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
    return json(yield* billing.license.changePlan(user.id, input));
  }
  if (path === "v1/me/license/renewal") {
    const input = parseLicenseRenewalRequest(body);
    if (!input) return failure(400, "invalid_billing_request", "The billing request is invalid.");
    return json(yield* billing.license.setRenewal(user.id, input.cancel));
  }
  return null;
}, refuseWith(BillingError));

/** The hosted servers of the account. Returns null when the path is not one of them. */
const handleHosting = Effect.fn("BrowserApi.handleHosting")(function* (
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
) {
  // Stripe sends the user back to `/app` on this origin, not to the desktop return page.
  const returnTo = { target: "web", origin: new URL(request.url).origin } as const;
  if (path === "v2/hosting/plans" && request.method === "GET") return json(yield* services.hosting().plans(user));
  if (path === "v2/hosting/servers") {
    if (request.method === "GET") return json(yield* services.hosting().list(user));
    if (request.method !== "POST") return null;
    const body = yield* readJsonObject(request);
    return json(
      yield* services.hosting().create(
        user,
        {
          name: body.name,
          plan: body.plan,
          interval: body.interval,
          currency: body.currency,
          entryPoint: body.entryPoint,
          license: body.license,
        },
        request.headers.get("Idempotency-Key"),
        returnTo,
      ),
      201,
    );
  }
  const [, encodedServerId, action] =
    /^v2\/hosting\/servers\/([^/]+)(?:\/(wake|restart|checkout|status|lifecycle))?$/u.exec(path) ?? [];
  if (encodedServerId === undefined) return null;
  const serverId = decodeURIComponent(encodedServerId);
  if (action === "lifecycle" && request.method === "POST") {
    const body = yield* readJsonObject(request);
    const input = parseHostedServerLifecycleInput({ ...body, serverId });
    if (!input) return json({ error: "invalid_request", message: sourceText("error.billing.invalidRequest") }, 400);
    yield* services.hosting().lifecycle(user, serverId, input);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (action === "wake" && request.method === "POST") return json(yield* services.hosting().wake(user, serverId));
  if (action === "restart" && request.method === "POST") return json(yield* services.hosting().restart(user, serverId));
  if (action === "status" && request.method === "GET") return json(yield* services.hosting().status(user, serverId));
  if (action === "checkout" && request.method === "POST") {
    return json(yield* services.hosting().checkout(user, serverId, returnTo));
  }
  if (action === undefined && request.method === "DELETE") {
    const body = yield* readJsonObject(request);
    yield* services.hosting().delete(user, serverId, body.confirmName);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return null;
});

/**
 * The account's published sites: the bearer `/v1/sites/` list and delete routes for a browser.
 * Publishing reads a local folder, so it stays on the desktop. Returns null for any other path.
 */
const handleHostedSites = Effect.fn("BrowserApi.handleHostedSites")(function* (
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
) {
  if (path === "v1/sites" && request.method === "GET")
    return json(yield* services.hostedSites().list({ kind: "account", userId: user.id }));
  const [, encodedSiteId] = /^v1\/sites\/([^/]+)$/u.exec(path) ?? [];
  if (encodedSiteId === undefined || request.method !== "DELETE") return null;
  const key = requireIdempotencyKey(request);
  yield* services.hostedSites().delete({ kind: "account", userId: user.id }, decodeURIComponent(encodedSiteId), key);
  return json({ deleted: true });
}, refuseWith(HostedSiteInputError));

/** Members and invites of one host. Returns null when the path and method are not one of them. */
const handleAdministration = Effect.fn("BrowserApi.handleAdministration")(function* (
  request: Request,
  path: string,
  user: AuthUser,
  services: BrowserApiServices,
) {
  const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const [, encodedInviteId] = /^v2\/remote\/invites\/([^/]+)$/u.exec(path) ?? [];
  if (encodedInviteId !== undefined && request.method === "DELETE") {
    yield* services.remote.revokeInvite(user.id, decodeURIComponent(encodedInviteId));
    return noContent();
  }
  const [, encodedHostId, collection, encodedMembershipId] =
    /^v2\/remote\/hosts\/([^/]+)\/(members|invites)(?:\/([^/]+))?$/u.exec(path) ?? [];
  if (encodedHostId === undefined) return null;
  const hostId = decodeURIComponent(encodedHostId);
  if (collection === "members" && encodedMembershipId === undefined && request.method === "GET")
    return json({ members: yield* services.remote.listMembers(user.id, hostId) });
  if (collection === "invites" && encodedMembershipId === undefined && request.method === "GET")
    return json({ invites: yield* services.remote.listInvites(user.id, hostId) });
  if (collection === "invites" && encodedMembershipId === undefined && request.method === "POST") {
    const body = yield* readJsonObject(request);
    if (
      (body.role !== "admin" && body.role !== "member") ||
      !(body.email === undefined || body.email === null || isString(body.email)) ||
      !(body.expiresInSeconds === undefined || isNumber(body.expiresInSeconds)) ||
      !(body.permanent === undefined || isBoolean(body.permanent))
    )
      return yield* invalidRemoteRequest("The invitation is invalid.");
    return json(
      yield* services.remote.createInvite(user, {
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
    yield* services.remote.changeMembership(user.id, { hostId, membershipId, revoke: true });
    return noContent();
  }
  if (request.method !== "PATCH") return null;
  const body = yield* readJsonObject(request);
  if (body.role !== "admin" && body.role !== "member")
    return yield* invalidRemoteRequest("The member role is invalid.");
  if (body.reactivate !== undefined && body.reactivate !== true)
    return yield* invalidRemoteRequest("The member status is invalid.");
  yield* services.remote.changeMembership(user.id, {
    hostId,
    membershipId,
    role: body.role,
    reactivate: body.reactivate === true,
  });
  return noContent();
});
