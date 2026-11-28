import type { FirstTouch } from "@openbot/contracts/first-touch";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  isUuidV4,
  normalizeEmailAddress,
  normalizeOneTimeCode as normalizeSharedOneTimeCode,
  ONE_TIME_CODE_ALPHABET,
  ONE_TIME_CODE_LENGTH,
  validateProfileName,
} from "@openbot/contracts/validation";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { type AccessTokenCheck, checkAccessToken, type IssuedAccessToken, issueAccessToken } from "./access-tokens";
import { type AccountAnalytics, type AccountSurface, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import type { AccountAttribution } from "./account-attribution";
import { randomToken, sha256 } from "./crypto";
import type { AuthStoreError } from "./d1-auth-repository";
import type { Referrals } from "./referrals";
import type { RemoteFailure } from "./remote-control-plane";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import {
  AMBIGUOUS_DELIVERY_ERRORS,
  EMAIL_CODE_DELIVERY_BUDGET_MS,
  RATE_LIMITED_DELIVERY_ERROR,
} from "./smtp-email-delivery";
import type {
  AuthRepository,
  AuthUser,
  EmailChallengeRecord,
  EmailCodeDelivery,
  EmailVerificationResult,
  MobileAuthDevice,
  MobileAuthDeviceIdentity,
  MobileAuthSessionResult,
  SessionReads,
} from "./types";

const CHALLENGE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const TEAM_TICKET_TTL_MS = 2 * 60_000;
const SERVER_CLAIM_TTL_MS = 15 * 60_000;
const MOBILE_CONNECT_SERVER_ID = "00000000-0000-4000-8000-000000000002";
const MOBILE_CONNECT_HOST_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;
const RATE_WINDOW_MS = 15 * 60_000;
const DELIVERY_RATE_LIMIT_RETRY_SECONDS = 5 * 60;

interface AuthServiceOptions {
  repository: AuthRepository;
  delivery: EmailCodeDelivery | null;
  exposeDevelopmentCode?: boolean;
  storeReviewSignIn?: StoreReviewSignIn | null;
  now?: () => number;
  flushSessionRevocations?: () => Effect.Effect<void, RemoteFailure>;
  profileChanged?: (userId: string) => Effect.Effect<void, RemoteFailure>;
  analytics?: AccountAnalytics;
  attribution?: AccountAttribution;
  referrals?: Referrals;
  usesCompanySignIn?: (email: string) => Effect.Effect<boolean, AuthOperationError>;
  accessTokenSecret?: string | undefined;
}

export interface StoreReviewSignIn {
  email: string;
  code: string;
}

export interface EmailSignInStart {
  challengeId: string;
  expiresAt: number;
  resendAt: number;
  developmentCode?: string;
}

type AuthWorkflowFailure =
  | AuthServiceError
  | AuthOperationError
  | AuthStoreError
  | RemoteFailure
  | Effect.Error<ReturnType<typeof sha256>>;

class AuthDependencies extends Context.Service<
  AuthDependencies,
  {
    repository: AuthRepository;
    delivery: EmailCodeDelivery | null;
    exposeDevelopmentCode: boolean;
    storeReviewSignIn: StoreReviewSignIn | null;
    now: () => number;
    flushSessionRevocations: () => Effect.Effect<void, RemoteFailure>;
    profileChanged: (userId: string) => Effect.Effect<void, RemoteFailure>;
    analytics: AccountAnalytics;
    attribution: AccountAttribution | null;
    referrals: Referrals | null;
    usesCompanySignIn: (email: string) => Effect.Effect<boolean, AuthOperationError>;
    accessTokenSecret: string | null;
  }
>()("@openbot/auth-api/AuthDependencies") {}

export interface AnalyticsAnswer {
  enabled: boolean;
  ageMs: number;
}

export function readAnalyticsAnswer(body: DynamicRecord): AnalyticsAnswer | null {
  if (!isBoolean(body.enabled)) return null;
  if (body.ageMs === undefined) return { enabled: body.enabled, ageMs: 0 };
  return isNumber(body.ageMs) && Number.isSafeInteger(body.ageMs) && body.ageMs >= 0
    ? { enabled: body.enabled, ageMs: body.ageMs }
    : null;
}

export function readChatColor(body: DynamicRecord): AvatarColor | null | undefined {
  if (body.chatColor === null) return null;
  return isAvatarColor(body.chatColor) ? body.chatColor : undefined;
}

export function sessionReadsFor(request: Request): SessionReads {
  return request.method === "GET" || request.method === "HEAD" ? "replica" : "primary";
}

export class AuthService {
  readonly #layer: Layer.Layer<AuthDependencies>;
  readonly #configured: boolean;
  readonly #issuesAccessTokens: boolean;

  constructor(options: AuthServiceOptions) {
    this.#configured = options.delivery !== null || (options.exposeDevelopmentCode ?? false);
    this.#layer = Layer.succeed(AuthDependencies)({
      repository: options.repository,
      delivery: options.delivery,
      exposeDevelopmentCode: options.exposeDevelopmentCode ?? false,
      storeReviewSignIn: options.storeReviewSignIn ?? null,
      now: options.now ?? Date.now,
      flushSessionRevocations: options.flushSessionRevocations ?? (() => Effect.void),
      profileChanged: options.profileChanged ?? (() => Effect.void),
      analytics: options.analytics ?? NO_ACCOUNT_ANALYTICS,
      attribution: options.attribution ?? null,
      referrals: options.referrals ?? null,
      usesCompanySignIn: options.usesCompanySignIn ?? (() => Effect.succeed(false)),
      accessTokenSecret: options.accessTokenSecret || null,
    });
    this.#issuesAccessTokens = Boolean(options.accessTokenSecret);
  }

  get configured(): boolean {
    return this.#configured;
  }

  get issuesAccessTokens(): boolean {
    return this.#issuesAccessTokens;
  }

  readonly startEmailSignIn = Effect.fn("AuthService.startEmailSignIn")(
    function* (
      this: AuthService,
      emailInput: string,
      sourceIp: string,
      idempotencyKey?: string,
    ): Effect.fn.Return<EmailSignInStart, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!this.configured) {
        return yield* new AuthServiceError(
          503,
          "email_delivery_not_configured",
          "Email sign-in delivery is not configured.",
        );
      }
      const email = yield* authValidate(() => normalizeEmail(emailInput));
      if (yield* dependencies.usesCompanySignIn(email)) {
        return yield* new AuthServiceError(
          409,
          "company_sign_in_required",
          "This email signs in with your company account.",
        );
      }
      const now = dependencies.now();
      if (idempotencyKey !== undefined && !isUuidV4(idempotencyKey)) {
        return yield* new AuthServiceError(
          400,
          "invalid_idempotency_key",
          "The sign-in request identifier is invalid.",
        );
      }
      const challengeId = idempotencyKey ?? randomToken();
      const challengeHash = yield* sha256(challengeId);
      if (idempotencyKey) {
        const existing = yield* dependencies.repository.findEmailChallenge(challengeHash);
        if (existing) return yield* this.#replayEmailSignIn(existing, email, challengeId, now);
      }

      yield* this.#enforceRateLimit(`start:email:${email}`, 5, now);
      yield* this.#enforceRateLimit(`start:ip:${normalizeSourceIp(sourceIp)}`, 20, now);

      if (idempotencyKey) {
        const existing = yield* dependencies.repository.findEmailChallenge(challengeHash);
        if (existing) return yield* this.#replayEmailSignIn(existing, email, challengeId, now);
      }

      const latestChallenge = yield* dependencies.repository.latestEmailChallengeAt(email);
      if (latestChallenge !== null && latestChallenge > now - RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.max(1, Math.ceil((latestChallenge + RESEND_COOLDOWN_MS - now) / 1_000));
        return yield* new AuthServiceError(
          429,
          "code_recently_sent",
          `Wait ${retryAfterSeconds} seconds before requesting another code.`,
          retryAfterSeconds,
        );
      }

      const storeReviewCode = storeReviewCodeFor(dependencies.storeReviewSignIn, email);
      const code =
        storeReviewCode ??
        (dependencies.exposeDevelopmentCode ? yield* developmentOneTimeCode(challengeId) : generateOneTimeCode());
      const expiresAt = now + CHALLENGE_TTL_MS;
      const codeHash = yield* sha256(normalizeOneTimeCode(code));
      const sourceIpHash = yield* sha256(normalizeSourceIp(sourceIp));
      const created = yield* dependencies.repository.createEmailChallenge({
        idHash: challengeHash,
        email,
        codeHash,
        sourceIpHash,
        createdAt: now,
        expiresAt,
        maxAttempts: 5,
      });
      if (!created) {
        const existing = yield* dependencies.repository.findEmailChallenge(challengeHash);
        if (!existing) return yield* new AuthOperationError({ message: "Account operation failed." });
        return yield* this.#replayEmailSignIn(existing, email, challengeId, now);
      }
      const delivery = dependencies.delivery;
      const deliveryResult = yield* Effect.result(
        delivery && storeReviewCode === null
          ? delivery.send({ email, code, expiresAt }).pipe(Effect.mapError(safeDeliveryError))
          : Effect.void,
      );
      if (Result.isFailure(deliveryResult)) {
        const deliveryError = deliveryResult.failure;
        console.error("Email code delivery failed:", deliveryError);
        if (AMBIGUOUS_DELIVERY_ERRORS.has(deliveryError)) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((now + EMAIL_CODE_DELIVERY_BUDGET_MS - dependencies.now()) / 1_000),
          );
          return yield* new AuthServiceError(
            409,
            "email_delivery_pending",
            "OpenBot could not confirm delivery. Check again when the countdown ends.",
            retryAfterSeconds,
          );
        }
        yield* dependencies.repository.completeEmailChallengeDelivery(challengeHash, "failed", dependencies.now());
        return yield* emailDeliveryFailure(deliveryError, "OpenBot could not send the sign-in code.");
      }
      yield* dependencies.repository.completeEmailChallengeDelivery(challengeHash, "sent", dependencies.now());

      return {
        challengeId,
        expiresAt,
        resendAt: now + RESEND_COOLDOWN_MS,
        ...(dependencies.exposeDevelopmentCode ? { developmentCode: code } : {}),
      };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly #replayEmailSignIn = Effect.fn("AuthService.replayEmailSignIn")(function* (
    this: AuthService,
    challenge: EmailChallengeRecord,
    email: string,
    challengeId: string,
    now: number,
  ): Effect.fn.Return<EmailSignInStart, AuthWorkflowFailure, AuthDependencies> {
    const dependencies = yield* AuthDependencies;
    if (challenge.email !== email) {
      return yield* new AuthServiceError(
        409,
        "idempotency_conflict",
        "This sign-in request identifier was already used for another email address.",
      );
    }
    if (challenge.deliveryState === "failed") {
      return yield* new AuthServiceError(502, "email_delivery_failed", "OpenBot could not send the sign-in code.");
    }
    if (challenge.deliveryState === "pending") {
      const remainingMs = challenge.createdAt + EMAIL_CODE_DELIVERY_BUDGET_MS - now;
      if (remainingMs > 0) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
        return yield* new AuthServiceError(
          409,
          "email_delivery_pending",
          "OpenBot is still confirming delivery. Check again when the countdown ends.",
          retryAfterSeconds,
        );
      }
    }
    if (challenge.consumedAt !== null) {
      return yield* new AuthServiceError(
        409,
        "idempotency_key_completed",
        "This sign-in request has already completed.",
      );
    }
    if (challenge.expiresAt <= now) {
      return yield* new AuthServiceError(410, "sign_in_code_expired", "The sign-in code expired. Request a new code.");
    }
    return {
      challengeId,
      expiresAt: challenge.expiresAt,
      resendAt: challenge.createdAt + RESEND_COOLDOWN_MS,
      ...(dependencies.exposeDevelopmentCode ? { developmentCode: yield* developmentOneTimeCode(challengeId) } : {}),
    };
  });

  readonly verifyEmailCode = Effect.fn("AuthService.verifyEmailCode")(
    function* (
      this: AuthService,
      input: {
        challengeId: string;
        code: string;
        sourceIp: string;
        surface: Exclude<AccountSurface, "mobile">;
        firstTouch?: FirstTouch | null;
        referralCode?: string | null;
      },
    ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, AuthWorkflowFailure, AuthDependencies> {
      return yield* this.#verifyEmailChallenge(input);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly verifyMobileEmailCode = Effect.fn("AuthService.verifyMobileEmailCode")(
    function* (
      this: AuthService,
      input: {
        challengeId: string;
        code: string;
        sourceIp: string;
        device: MobileAuthDeviceIdentity;
        referralCode?: string | null;
      },
    ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const device = yield* authValidate(() => normalizeMobileDevice(input.device));
      const session = yield* this.#verifyEmailChallenge({ ...input, device, surface: "mobile" });
      yield* dependencies.flushSessionRevocations();
      return session;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly #verifyEmailChallenge = Effect.fn("AuthService.verifyEmailChallenge")(function* (
    this: AuthService,
    input: {
      challengeId: string;
      code: string;
      sourceIp: string;
      surface: AccountSurface;
      firstTouch?: FirstTouch | null;
      referralCode?: string | null;
      device?: MobileAuthDeviceIdentity;
    },
  ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, AuthWorkflowFailure, AuthDependencies> {
    const dependencies = yield* AuthDependencies;
    const now = dependencies.now();
    yield* this.#enforceRateLimit(`verify:ip:${normalizeSourceIp(input.sourceIp)}`, 30, now);
    if (!input.challengeId || input.challengeId.length > 128 || input.code.length > 32) {
      return yield* new AuthServiceError(400, "invalid_sign_in_code", "The sign-in code is invalid.");
    }
    const idHash = yield* sha256(input.challengeId);
    const normalizedCode = yield* authValidate(() => safeNormalizeCode(input.code));
    const codeHash = yield* sha256(normalizedCode);
    const result = yield* dependencies.repository.verifyEmailChallenge({
      idHash,
      codeHash,
      now,
      session: {
        id: crypto.randomUUID(),
        token: randomToken(),
        expiresAt: PERSISTENT_SESSION_EXPIRES_AT,
      },
      ...(input.device ? { device: input.device } : {}),
    });
    const session = yield* authValidate(() => verificationResult(result));
    const firstTouch = input.firstTouch ?? null;
    const { attribution } = dependencies;
    if (firstTouch && attribution) {
      yield* attribution
        .record(session.user.id, firstTouch, "sign_in")
        .pipe(Effect.catch(() => Effect.sync(() => console.warn("Account attribution save failed."))));
    }
    if (result.status === "verified" && result.created) {
      dependencies.analytics.track(session.user.id, { name: "account_created", surface: input.surface, firstTouch });
      const { referrals } = dependencies;
      if (input.referralCode && referrals) {
        yield* referrals
          .record(session.user.id, input.referralCode)
          .pipe(Effect.catch(() => Effect.sync(() => console.warn("Invite link save failed."))));
      }
    }
    return session;
  });

  readonly authenticate = Effect.fn("AuthService.authenticate")(
    function* (
      this: AuthService,
      sessionToken: string,
      reads: SessionReads = "primary",
    ): Effect.fn.Return<AuthUser | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      return yield* dependencies.repository.authenticate(sessionToken, dependencies.now(), reads);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly authenticateDesktopSession = Effect.fn("AuthService.authenticateDesktopSession")(
    function* (
      this: AuthService,
      sessionToken: string,
      reads: SessionReads = "primary",
    ): Effect.fn.Return<AuthUser | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      return yield* dependencies.repository.authenticateDesktopSession(sessionToken, dependencies.now(), reads);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly checkAccessToken = Effect.fn("AuthService.checkAccessToken")(
    function* (this: AuthService, accessToken: string): Effect.fn.Return<AccessTokenCheck, never, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!dependencies.accessTokenSecret) return { status: "invalid" } satisfies AccessTokenCheck;
      return yield* checkAccessToken(dependencies.accessTokenSecret, accessToken, dependencies.now());
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly authenticateAccessToken = Effect.fn("AuthService.authenticateAccessToken")(
    function* (
      this: AuthService,
      accessToken: string,
      reads: SessionReads = "primary",
    ): Effect.fn.Return<AuthUser | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const check = yield* this.checkAccessToken(accessToken);
      if (check.status !== "valid") return null;
      return yield* dependencies.repository.authenticateSessionId(
        check.sessionId,
        check.userId,
        dependencies.now(),
        reads,
      );
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueAccessToken = Effect.fn("AuthService.issueAccessToken")(
    function* (
      this: AuthService,
      sessionToken: string,
    ): Effect.fn.Return<IssuedAccessToken, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!dependencies.accessTokenSecret) {
        return yield* new AuthServiceError(404, "not_found", "The route was not found.");
      }
      const now = dependencies.now();
      const session = yield* dependencies.repository.sessionForToken(sessionToken, now);
      if (!session) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      return yield* issueAccessToken(
        dependencies.accessTokenSecret,
        { sessionId: session.sessionId, userId: session.user.id, expiresAt: session.expiresAt },
        now,
      ).pipe(Effect.mapError(() => new AuthOperationError({ message: "Account operation failed." })));
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateName = Effect.fn("AuthService.updateName")(
    function* (
      this: AuthService,
      sessionToken: string,
      nameInput: string,
    ): Effect.fn.Return<AuthUser, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticate(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const validation = validateProfileName(nameInput);
      if (validation.error) {
        return yield* new AuthServiceError(400, "invalid_profile_name", "Enter a valid display name.");
      }
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`profile:user:${user.id}`, 20, now);
      const updated = yield* dependencies.repository.updateUserName(user.id, validation.name, now);
      if (user.name !== updated.name) yield* dependencies.profileChanged(user.id).pipe(Effect.catch(() => Effect.void));
      return updated;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateAnalytics = Effect.fn("AuthService.updateAnalytics")(
    function* (
      this: AuthService,
      sessionToken: string,
      answer: AnalyticsAnswer,
    ): Effect.fn.Return<AuthUser, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticate(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`profile:user:${user.id}`, 20, now);
      const updated = yield* dependencies.repository.updateUserAnalytics(
        user.id,
        answer.enabled,
        now - answer.ageMs,
        now,
      );
      if (user.analyticsEnabled !== updated.analyticsEnabled) {
        yield* dependencies.profileChanged(user.id).pipe(Effect.catch(() => Effect.void));
      }
      return updated;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateChatColor = Effect.fn("AuthService.updateChatColor")(
    function* (
      this: AuthService,
      sessionToken: string,
      chatColor: AvatarColor | null,
    ): Effect.fn.Return<AuthUser, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticate(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`profile:user:${user.id}`, 20, now);
      const updated = yield* dependencies.repository.updateUserChatColor(user.id, chatColor, now);
      if (user.chatColor !== updated.chatColor) {
        yield* dependencies.profileChanged(user.id).pipe(Effect.catch(() => Effect.void));
      }
      return updated;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateAvatar = Effect.fn("AuthService.updateAvatar")(
    function* (
      this: AuthService,
      sessionToken: string,
      avatarUrl: string | null,
      expectedAvatarUrl: string | null,
    ): Effect.fn.Return<AuthUser, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticate(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`avatar:user:${user.id}`, 20, now);
      const updated = yield* dependencies.repository.updateUserAvatar(user.id, avatarUrl, expectedAvatarUrl, now);
      if (!updated) {
        return yield* new AuthServiceError(
          409,
          "avatar_conflict",
          "The account avatar changed during this request. Try again.",
        );
      }
      if (user.avatarUrl !== updated.avatarUrl)
        yield* dependencies.profileChanged(user.id).pipe(Effect.catch(() => Effect.void));
      return updated;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly enforceTeamInviteRateLimit = Effect.fn("AuthService.enforceTeamInviteRateLimit")(
    function* (
      this: AuthService,
      userId: string,
      recipientEmail: string,
      sourceIp: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const now = dependencies.now();
      const email = yield* authValidate(() => normalizeEmail(recipientEmail));
      yield* this.#enforceRateLimit(`invite:user:${userId}`, 20, now);
      yield* this.#enforceRateLimit(`invite:email:${email}`, 5, now);
      yield* this.#enforceRateLimit(`invite:ip:${normalizeSourceIp(sourceIp)}`, 30, now);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly enforceTeamTunnelRateLimit = Effect.fn("AuthService.enforceTeamTunnelRateLimit")(
    function* (
      this: AuthService,
      userId: string,
      sourceIp: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`team-tunnel:user:${userId}`, 20, now);
      yield* this.#enforceRateLimit(`team-tunnel:ip:${normalizeSourceIp(sourceIp)}`, 60, now);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly enforceHostedServerClaimRateLimit = Effect.fn("AuthService.enforceHostedServerClaimRateLimit")(
    function* (this: AuthService, sourceIp: string): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      yield* this.#enforceRateLimit(`hosted-claim:ip:${normalizeSourceIp(sourceIp)}`, 30, dependencies.now());
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly createServerClaim = Effect.fn("AuthService.createServerClaim")(
    function* (
      this: AuthService,
      emailInput: string,
    ): Effect.fn.Return<{ claim: string; expiresAt: number }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const email = yield* authValidate(() => normalizeEmail(emailInput));
      const now = dependencies.now();
      const claim = randomToken();
      const expiresAt = now + SERVER_CLAIM_TTL_MS;
      yield* dependencies.repository.createServerClaim({
        claimHash: yield* sha256(claim),
        email,
        createdAt: now,
        expiresAt,
      });
      return { claim, expiresAt };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly createServerClaimForUser = Effect.fn("AuthService.createServerClaimForUser")(
    function* (
      this: AuthService,
      userId: string,
    ): Effect.fn.Return<{ claim: string; expiresAt: number }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`server-claim:user:${userId}`, 20, now);
      const claim = randomToken();
      const expiresAt = now + SERVER_CLAIM_TTL_MS;
      yield* dependencies.repository.createServerClaimForUser({
        claimHash: yield* sha256(claim),
        userId,
        createdAt: now,
        expiresAt,
      });
      return { claim, expiresAt };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemServerClaim = Effect.fn("AuthService.redeemServerClaim")(
    function* (
      this: AuthService,
      claim: unknown,
      sourceIp: string,
    ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`server-claim:ip:${normalizeSourceIp(sourceIp)}`, 30, now);
      if (!isString(claim) || claim.length < 16 || claim.length > 128) return yield* invalidServerClaim();
      const session = yield* dependencies.repository.redeemServerClaim({
        claimHash: yield* sha256(claim),
        now,
        session: { id: crypto.randomUUID(), token: randomToken(), expiresAt: PERSISTENT_SESSION_EXPIRES_AT },
      });
      return session ?? (yield* invalidServerClaim());
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueTeamAuthTicket = Effect.fn("AuthService.issueTeamAuthTicket")(
    function* (
      this: AuthService,
      sessionToken: string,
      serverId: string,
      sourceIp: string,
    ): Effect.fn.Return<{ ticket: string; expiresAt: number }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      yield* authValidate(() => validateTeamServerId(serverId));
      const user = yield* this.authenticate(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`team-ticket:user:${user.id}`, 30, now);
      yield* this.#enforceRateLimit(`team-ticket:ip:${normalizeSourceIp(sourceIp)}`, 60, now);
      const ticket = randomToken();
      const expiresAt = now + TEAM_TICKET_TTL_MS;
      const ticketHash = yield* sha256(ticket);
      yield* dependencies.repository.createTeamAuthTicket({
        ticketHash,
        userId: user.id,
        serverId,
        createdAt: now,
        expiresAt,
      });
      return { ticket, expiresAt };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemTeamAuthTicket = Effect.fn("AuthService.redeemTeamAuthTicket")(
    function* (
      this: AuthService,
      ticket: string,
      serverId: string,
      sourceIp: string,
    ): Effect.fn.Return<AuthUser | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      yield* authValidate(() => validateTeamServerId(serverId));
      if (!ticket || ticket.length > 128) return null;
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`team-ticket-redeem:ip:${normalizeSourceIp(sourceIp)}`, 120, now);
      const ticketHash = yield* sha256(ticket);
      return yield* dependencies.repository.redeemTeamAuthTicket({
        ticketHash,
        serverId,
        now,
      });
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueMobileAuthTicket = Effect.fn("AuthService.issueMobileAuthTicket")(
    function* (
      this: AuthService,
      sessionToken: string,
      sourceIp: string,
      host?: MobileConnectHostBinding,
    ): Effect.fn.Return<{ ticket: string; expiresAt: number }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticateDesktopSession(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`mobile-ticket:user:${user.id}`, 30, now);
      yield* this.#enforceRateLimit(`mobile-ticket:ip:${normalizeSourceIp(sourceIp)}`, 60, now);
      const ticket = randomToken();
      const expiresAt = now + TEAM_TICKET_TTL_MS;
      const ticketHash = yield* sha256(ticket);
      yield* dependencies.repository.replaceMobileAuthTicket({
        host,
        ticketHash,
        userId: user.id,
        serverId: MOBILE_CONNECT_SERVER_ID,
        createdAt: now,
        expiresAt,
      });
      return { ticket, expiresAt };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly cancelMobileAuthTickets = Effect.fn("AuthService.cancelMobileAuthTickets")(
    function* (
      this: AuthService,
      sessionToken: string,
      hostId: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!MOBILE_CONNECT_HOST_ID_PATTERN.test(hostId)) {
        return yield* new AuthServiceError(400, "invalid_mobile_host", "The Mobile Connect host ID is invalid.");
      }
      const user = yield* this.authenticateDesktopSession(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      yield* dependencies.repository.cancelMobileAuthTickets({
        userId: user.id,
        serverId: MOBILE_CONNECT_SERVER_ID,
        hostId,
        now: dependencies.now(),
      });
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemMobileAuthTicket = Effect.fn("AuthService.redeemMobileAuthTicket")(
    function* (
      this: AuthService,
      ticket: string,
      deviceInput: MobileAuthDeviceIdentity,
      sourceIp: string,
    ): Effect.fn.Return<MobileAuthSessionResult | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!ticket || ticket.length > 128) return null;
      const device = yield* authValidate(() => normalizeMobileDevice(deviceInput));
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`mobile-ticket-redeem:ip:${normalizeSourceIp(sourceIp)}`, 60, now);
      const ticketHash = yield* sha256(ticket);
      const redeemed =
        (yield* dependencies.repository.redeemMobileAuthTicket({
          ticketHash,
          serverId: MOBILE_CONNECT_SERVER_ID,
          now,
          session: newMobileSession(),
          device,
        })) ??
        (yield* dependencies.repository.redeemMobileConnectLink({
          linkHash: ticketHash,
          now,
          session: newMobileSession(),
          device,
        }));
      yield* dependencies.flushSessionRevocations();
      return redeemed;
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly createMobileConnectLink = Effect.fn("AuthService.createMobileConnectLink")(
    function* (
      this: AuthService,
      sessionToken: string,
      sourceIp: string,
      host: MobileConnectHostBinding,
    ): Effect.fn.Return<{ link: string; createdAt: number }, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticateDesktopSession(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      const now = dependencies.now();
      yield* this.#enforceRateLimit(`mobile-link:user:${user.id}`, 30, now);
      yield* this.#enforceRateLimit(`mobile-link:ip:${normalizeSourceIp(sourceIp)}`, 60, now);
      const link = randomToken();
      const created = yield* dependencies.repository.replaceMobileConnectLink({
        linkHash: yield* sha256(link),
        desktopSessionToken: sessionToken,
        userId: user.id,
        host,
        createdAt: now,
      });
      if (!created) {
        return yield* new AuthServiceError(
          409,
          "mobile_host_mismatch",
          "The Mobile Connect host identity does not match.",
        );
      }
      return { link, createdAt: now };
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeMobileConnectLink = Effect.fn("AuthService.revokeMobileConnectLink")(
    function* (
      this: AuthService,
      sessionToken: string,
      hostId: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!MOBILE_CONNECT_HOST_ID_PATTERN.test(hostId)) {
        return yield* new AuthServiceError(400, "invalid_mobile_host", "The Mobile Connect host ID is invalid.");
      }
      const user = yield* this.authenticateDesktopSession(sessionToken);
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      yield* dependencies.repository.revokeMobileConnectLink({ userId: user.id, hostId, now: dependencies.now() });
      yield* dependencies.flushSessionRevocations();
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly listMobileAuthDevices = Effect.fn("AuthService.listMobileAuthDevices")(
    function* (
      this: AuthService,
      sessionToken: string,
      hostId: string | null,
    ): Effect.fn.Return<MobileAuthDevice[], AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (hostId !== null && !MOBILE_CONNECT_HOST_ID_PATTERN.test(hostId)) {
        return yield* new AuthServiceError(400, "invalid_mobile_host", "The Mobile Connect host ID is invalid.");
      }
      const user = yield* this.authenticate(sessionToken, "strict");
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      return yield* dependencies.repository.listMobileAuthDevices(user.id, dependencies.now(), hostId);
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly authenticateMobileSession = Effect.fn("AuthService.authenticateMobileSession")(
    function* (
      this: AuthService,
      sessionToken: string,
    ): Effect.fn.Return<AuthUser | null, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      return yield* dependencies.repository.authenticateMobileSession(sessionToken, dependencies.now());
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeMobileAuthDevice = Effect.fn("AuthService.revokeMobileAuthDevice")(
    function* (
      this: AuthService,
      sessionToken: string,
      sessionId: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!isUuidV4(sessionId)) {
        return yield* new AuthServiceError(400, "invalid_mobile_session", "The mobile session ID is invalid.");
      }
      const user = yield* this.authenticate(sessionToken, "strict");
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      yield* dependencies.repository.revokeMobileAuthDevice(user.id, sessionId, dependencies.now());
      yield* dependencies.flushSessionRevocations();
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly listAccountSessions = Effect.fn("AuthService.listAccountSessions")(
    function* (
      this: AuthService,
      sessionToken: string,
    ): Effect.fn.Return<
      Effect.Success<ReturnType<AuthRepository["listAccountSessions"]>>,
      AuthWorkflowFailure,
      AuthDependencies
    > {
      const dependencies = yield* AuthDependencies;
      const user = yield* this.authenticate(sessionToken, "strict");
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      return yield* dependencies.repository.listAccountSessions(user.id, sessionToken, dependencies.now());
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeAccountSession = Effect.fn("AuthService.revokeAccountSession")(
    function* (
      this: AuthService,
      sessionToken: string,
      sessionId: string,
    ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      if (!isUuidV4(sessionId))
        return yield* new AuthServiceError(400, "invalid_session", "The session ID is invalid.");
      const user = yield* this.authenticate(sessionToken, "strict");
      if (!user) return yield* new AuthServiceError(401, "unauthorized", "The session is invalid.");
      if (!(yield* this.authenticateDesktopSession(sessionToken, "strict"))) {
        const sessions = yield* dependencies.repository.listAccountSessions(user.id, sessionToken, dependencies.now());
        if (sessions.some((session) => session.sessionId === sessionId && session.kind === "desktop")) {
          return yield* new AuthServiceError(
            403,
            "desktop_session_protected",
            "Desktop sessions cannot be disconnected from mobile.",
          );
        }
      }
      yield* dependencies.repository.revokeAccountSession(user.id, sessionId, dependencies.now());
      yield* dependencies.flushSessionRevocations();
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly sessionEnded = Effect.fn("AuthService.sessionEnded")(
    function* (this: AuthService, sessionToken: string): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      yield* dependencies.repository.forgetSessionToken(sessionToken, dependencies.now());
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly logout = Effect.fn("AuthService.logout")(
    function* (this: AuthService, sessionToken: string): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      yield* dependencies.repository.revokeSession(sessionToken, dependencies.now());
      yield* dependencies.flushSessionRevocations();
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly logoutMobileSession = Effect.fn("AuthService.logoutMobileSession")(
    function* (this: AuthService, sessionToken: string): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
      const dependencies = yield* AuthDependencies;
      const revoked = yield* dependencies.repository.revokeMobileSession(sessionToken, dependencies.now());
      if (!revoked) return yield* new AuthServiceError(401, "unauthorized", "The mobile session is invalid.");
      yield* dependencies.flushSessionRevocations();
    },
    (operation) => operation.pipe(Effect.mapError(authFailure), Effect.provide(this.#layer)),
  ).bind(this);

  readonly #enforceRateLimit = Effect.fn("AuthService.enforceRateLimit")(function* (
    this: AuthService,
    key: string,
    limit: number,
    now: number,
  ): Effect.fn.Return<void, AuthWorkflowFailure, AuthDependencies> {
    const dependencies = yield* AuthDependencies;
    const keyHash = yield* sha256(key);
    const result = yield* dependencies.repository.incrementRateLimit(
      keyHash,
      Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS,
      limit,
    );
    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.windowStart + RATE_WINDOW_MS - now) / 1_000));
      return yield* new AuthServiceError(
        429,
        "rate_limited",
        "Too many sign-in attempts. Try again later.",
        retryAfterSeconds,
      );
    }
  });
}

function safeDeliveryError(error: unknown): string {
  return isEmailDeliveryFailure(error) ? error.message : "unknown_delivery_error";
}

export function isEmailDeliveryFailure(error: unknown): error is Error {
  return error instanceof Error && /^(?:smtp|email_delivery)_[a-z_]+$/u.test(error.message);
}

export function emailDeliveryFailure(deliveryError: string, permanentMessage: string): AuthServiceError {
  if (deliveryError === RATE_LIMITED_DELIVERY_ERROR) {
    return new AuthServiceError(
      429,
      "email_delivery_rate_limited",
      "OpenBot cannot send more email right now. Try again when the countdown ends.",
      DELIVERY_RATE_LIMIT_RETRY_SECONDS,
    );
  }
  return new AuthServiceError(502, "email_delivery_failed", permanentMessage);
}

export class AuthServiceError extends Schema.TaggedError<AuthServiceError>()("AuthServiceError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
  retryAfterSeconds: Schema.optional(Schema.Number),
}) {
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super({ status, code, message, retryAfterSeconds });
  }
}

export class AuthOperationError extends Schema.TaggedError<AuthOperationError>()("AuthOperationError", {
  message: Schema.String,
}) {}

function invalidServerClaim(): AuthServiceError {
  return new AuthServiceError(401, "server_claim_invalid", "The server claim is invalid or used.");
}

function authFailure(error: unknown): AuthServiceError | AuthOperationError {
  return error instanceof AuthServiceError ? error : new AuthOperationError({ message: "Account operation failed." });
}

function authValidate<A>(operation: () => A): Effect.Effect<A, AuthServiceError | AuthOperationError> {
  return Effect.try({ try: operation, catch: authFailure });
}

function storeReviewCodeFor(review: StoreReviewSignIn | null, email: string): string | null {
  return review?.email === email ? review.code : null;
}

export function readStoreReviewSignIn(email: string | undefined, code: string | undefined): StoreReviewSignIn | null {
  if (!email || !code) return null;
  const normalizedEmail = normalizeEmailAddress(email);
  const normalizedCode = normalizeSharedOneTimeCode(code);
  return normalizedEmail && normalizedCode ? { email: normalizedEmail, code: normalizedCode } : null;
}

function generateOneTimeCode(): string {
  const bytes = new Uint8Array(ONE_TIME_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((byte) => ONE_TIME_CODE_ALPHABET[byte & 31]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const developmentOneTimeCode = Effect.fn("Auth.developmentCode")(function* (challengeId: string) {
  const digest = yield* sha256(`development-code:${challengeId}`);
  const raw = [...digest.slice(0, ONE_TIME_CODE_LENGTH)]
    .map((character) => ONE_TIME_CODE_ALPHABET[character.charCodeAt(0) & 31])
    .join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
});

function normalizeOneTimeCode(value: string): string {
  const normalized = normalizeSharedOneTimeCode(value);
  if (!normalized) {
    throw new AuthServiceError(400, "invalid_sign_in_code", "The sign-in code is invalid.");
  }
  return normalized;
}

export function normalizeEmail(value: string): string {
  const normalized = normalizeEmailAddress(value);
  if (!normalized) {
    throw new AuthServiceError(400, "invalid_email", "Enter a valid email address.");
  }
  return normalized;
}

function safeNormalizeCode(value: string): string {
  try {
    return normalizeOneTimeCode(value);
  } catch {
    return "INVALIDCODE";
  }
}

function normalizeSourceIp(value: string): string {
  const normalized = value.trim();
  return normalized && normalized.length <= 64 ? normalized : "unknown";
}

function validateServerId(value: string): void {
  if (!isUuidV4(value)) {
    throw new AuthServiceError(400, "invalid_server_id", "The team server ID is invalid.");
  }
}

function validateTeamServerId(value: string): void {
  validateServerId(value);
  if (value === MOBILE_CONNECT_SERVER_ID) {
    throw new AuthServiceError(400, "invalid_server_id", "The team server ID is invalid.");
  }
}

function newMobileSession(): { id: string; token: string; expiresAt: number } {
  return { id: crypto.randomUUID(), token: randomToken(), expiresAt: PERSISTENT_SESSION_EXPIRES_AT };
}

export function normalizeMobileDevice(input: MobileAuthDeviceIdentity): MobileAuthDeviceIdentity {
  if (!isUuidV4(input.id)) {
    throw new AuthServiceError(400, "invalid_mobile_device", "The mobile device ID is invalid.");
  }
  const name = input.name.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new AuthServiceError(400, "invalid_mobile_device", "The mobile device name is invalid.");
  }
  if (input.platform !== "ios" && input.platform !== "android" && input.platform !== "unknown") {
    throw new AuthServiceError(400, "invalid_mobile_device", "The mobile device platform is invalid.");
  }
  return { id: input.id, name, platform: input.platform };
}

function verificationResult(result: EmailVerificationResult): {
  sessionToken: string;
  user: AuthUser;
} {
  if (result.status === "verified") return result.session;
  if (result.status === "too_many_attempts") {
    throw new AuthServiceError(429, "too_many_code_attempts", "Too many incorrect codes. Request a new code.");
  }
  if (result.status === "expired") {
    throw new AuthServiceError(401, "sign_in_code_expired", "The sign-in code expired.");
  }
  throw new AuthServiceError(401, "invalid_sign_in_code", "The sign-in code is incorrect.");
}
