import { type InviteLinkPayload, isCanonicalInviteUrl, parseInviteUrl } from "@openbot/contracts/invite-links";
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
import { type RemoteControlPlane, RemoteControlPlaneError } from "./remote-control-plane";
import type { AuthUser, TeamInviteEmailDelivery } from "./types";

export interface TeamInviteEmailServices {
  auth: Pick<AuthService, "enforceTeamInviteRateLimit">;
  remote: Pick<RemoteControlPlane, "emailableInvite">;
  delivery: () => TeamInviteEmailDelivery | null;
}

const Invitation = Schema.Struct({
  email: Schema.String,
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
  const link = inviteLink(body.inviteUrl);
  if (!link) return yield* invalid();
  const email = yield* Effect.try({
    try: () => normalizeEmail(body.email),
    catch: (error) => (error instanceof AuthServiceError ? error : invalid()),
  });
  const invite = yield* services.remote
    .emailableInvite(user.id, { hostId: link.serverId, token: link.token, email, role: body.role })
    .pipe(
      Effect.mapError((error) =>
        error instanceof RemoteControlPlaneError
          ? invalid()
          : new AuthOperationError({ message: "Account operation failed." }),
      ),
    );
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
      serverName: invite.hostName.replace(/[\r\n]+/gu, " "),
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

function inviteLink(value: string): InviteLinkPayload | null {
  if (value.length > 4_096 || /[\r\n]/u.test(value)) return null;
  try {
    return isCanonicalInviteUrl(value) ? parseInviteUrl(value) : null;
  } catch {
    return null;
  }
}
