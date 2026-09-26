import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isCanonicalInviteUrl } from "@openbot/contracts/invite-links";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
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

/** The desktop bearer route and the browser cookie route send an invitation email the same way. */
export async function sendTeamInviteEmail(
  services: TeamInviteEmailServices,
  user: Pick<AuthUser, "id" | "email">,
  body: DynamicRecord,
  sourceIp: string,
): Promise<void> {
  if (
    !isString(body.email) ||
    !isString(body.serverName) ||
    !isString(body.inviteUrl) ||
    (body.role !== "admin" && body.role !== "member") ||
    body.serverName.trim().length < INPUT_LIMITS.serverNameMin ||
    body.serverName.trim().length > INPUT_LIMITS.serverName ||
    /[\r\n]/u.test(body.serverName) ||
    !isValidInviteUrl(body.inviteUrl)
  ) {
    throw new AuthServiceError(400, "invalid_invitation", "The invitation details are invalid.");
  }
  const email = normalizeEmail(body.email);
  await services.auth.enforceTeamInviteRateLimit(user.id, email, sourceIp);
  const delivery = services.delivery();
  if (!delivery) throw new AuthServiceError(503, "email_delivery_not_configured", "Email delivery is unavailable.");
  try {
    await delivery.send({
      email,
      inviterEmail: user.email,
      serverName: body.serverName,
      inviteUrl: body.inviteUrl,
      role: body.role,
    });
  } catch (error) {
    if (isEmailDeliveryFailure(error))
      throw emailDeliveryFailure(error.message, "OpenBot could not send the invitation.");
    throw error;
  }
}

function isValidInviteUrl(value: string): boolean {
  if (value.length > 4_096 || /[\r\n]/u.test(value)) return false;
  try {
    return isCanonicalInviteUrl(value);
  } catch {
    return false;
  }
}
