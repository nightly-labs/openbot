import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type AuthService, AuthServiceError, normalizeEmail } from "./auth-service";
import type { RemoteControlPlane } from "./remote-control-plane";
import type { AuthUser, OwnerTransferEmailDelivery } from "./types";

export interface OwnerTransferServices {
  auth: Pick<AuthService, "enforceTeamInviteRateLimit">;
  remote: Pick<RemoteControlPlane, "createOwnerTransfer">;
  delivery: () => OwnerTransferEmailDelivery | null;
  schedule: (delivery: Effect.Effect<void>) => void;
}

export const startOwnerTransfer = Effect.fn("OwnerTransfer.start")(function* (
  services: OwnerTransferServices,
  user: AuthUser,
  input: { hostId: string; body: DynamicRecord; sourceIp: string; appUrl: string },
) {
  const invalidEmail = () => new AuthServiceError(400, "invalid_email", "Enter a valid email address.");
  const rawEmail = input.body.email;
  if (!isString(rawEmail)) return yield* invalidEmail();
  const email = yield* Effect.try({
    try: () => normalizeEmail(rawEmail),
    catch: (error) => (error instanceof AuthServiceError ? error : invalidEmail()),
  });
  yield* services.auth.enforceTeamInviteRateLimit(user.id, email, input.sourceIp);
  const transfer = yield* services.remote.createOwnerTransfer(user, { hostId: input.hostId, email });
  const delivery = services.delivery();
  if (delivery) {
    services.schedule(
      delivery
        .send({
          email: transfer.toEmail,
          fromEmail: user.email,
          serverName: transfer.hostName.replace(/[\r\n]+/gu, " "),
          appUrl: input.appUrl,
        })
        .pipe(Effect.catch(() => Effect.void)),
    );
  }
  return transfer;
});
