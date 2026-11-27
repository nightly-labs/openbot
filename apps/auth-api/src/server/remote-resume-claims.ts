import { z } from "zod";

export const remoteResumeClaimsSchema = z.object({
  sessionId: z.string().min(1).max(256),
  hostId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  membershipId: z.string().min(1).max(256),
  role: z.enum(["host", "owner", "admin", "member"]),
  authEpoch: z.number().int().nonnegative(),
  sessionExpiresAt: z.number().int().positive(),
});
