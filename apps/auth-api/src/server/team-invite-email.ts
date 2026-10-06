import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isCanonicalInviteUrl } from "@openbot/contracts/invite-links";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import {
  AuthOperationError,
  type AuthService,
  AuthServiceError,
  emailDeliveryFailure,
  isEmailDeliveryFailure,
  normalizeEmail,
} from "./auth-service";
import type { AuthUser, TeamInviteEmailDelivery } from "./types";

export interface TeamInviteEmailServices {
  auth: Pick<AuthService, "enforceTeamInviteRateLimit">;
  delivery: () => TeamInviteEmailDelivery | null;
}

const Invitation = Schema.Struct({
  email: Schema.String,
  serverName: Schema.String,
  inviteUrl: Schema.String,
  role: Schema.Literals(["admin", "member"]),
});

export const sendTeamInviteEmail = Effect.fn("TeamInviteEmail.send")(function* (
  services: TeamInviteEmailServices,
  user: Pick<AuthUser, "id" | "email">,
  input: DynamicRecord,
  sourceIp: string,
) {
  const invalid = () => new AuthServiceError(400, "invalid_invitation", "The invitation details are invalid.");
  const body = yield* Schema.decodeUnknownEffect(Invitation)(input).pipe(Effect.mapError(invalid));
  if (
    body.serverName.trim().length < INPUT_LIMITS.serverNameMin ||
    body.serverName.trim().length > INPUT_LIMITS.serverName ||
    /[\r\n]/u.test(body.serverName) ||
    !isValidInviteUrl(body.inviteUrl)
  )
    return yield* invalid();
  const email = yield* Effect.try({
    try: () => normalizeEmail(body.email),
    catch: (error) => (error instanceof AuthServiceError ? error : invalid()),
  });
  yield* services.auth
    .enforceTeamInviteRateLimit(user.id, email, sourceIp)
    .pipe(
      Effect.mapError((error) =>
        error instanceof AuthServiceError ? error : new AuthOperationError({ message: "Account operation failed." }),
      ),
    );
  const delivery = services.delivery();
  if (!delivery)
    return yield* new AuthServiceError(503, "email_delivery_not_configured", "Email delivery is unavailable.");
  yield* delivery
    .send({
      email,
      inviterEmail: user.email,
      serverName: body.serverName,
      inviteUrl: body.inviteUrl,
      role: body.role,
    })
    .pipe(
      Effect.mapError((error) =>
        isEmailDeliveryFailure(error)
          ? emailDeliveryFailure(error.message, "OpenBot could not send the invitation.")
          : new AuthOperationError({ message: "Account operation failed." }),
      ),
    );
});

/** The bearer and cookie routes share the same invitation workflow. */

function isValidInviteUrl(value: string): boolean {
  if (value.length > 4_096 || /[\r\n]/u.test(value)) return false;
  try {
    return isCanonicalInviteUrl(value);
  } catch {
    return false;
  }
}
