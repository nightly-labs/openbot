import { createHash, timingSafeEqual } from "node:crypto";
import { SIGNAL_GO_AWAY_WITHIN_MS_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import type { Server } from "bun";
import { z } from "zod";
import type { SignalService } from "./signal-service";

const GO_AWAY_BODY_BYTES_LIMIT = 1_024;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const goAwayRequestSchema = z
  .object({
    waveSize: z.int().min(1).max(10_000).default(50),
    waveIntervalMs: z.int().min(0).max(600_000).default(10_000),
    withinMs: z.int().min(0).max(SIGNAL_GO_AWAY_WITHIN_MS_LIMIT).default(60_000),
  })
  .strict();
type GoAwayRequest = z.infer<typeof goAwayRequestSchema>;

export function sameSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

export function goAwayRoute(signal: Pick<SignalService, "goAway">, adminToken: string | null) {
  return async (request: Request, server: Server<unknown>): Promise<Response> => {
    const address = server.requestIP(request)?.address ?? "";
    const authorization = request.headers.get("Authorization") ?? "";
    if (!adminToken || !LOOPBACK_ADDRESSES.has(address) || !sameSecret(authorization, `Bearer ${adminToken}`))
      return new Response("Not found", { status: 404 });
    const body = await request.arrayBuffer().catch(() => null);
    if (!body || body.byteLength > GO_AWAY_BODY_BYTES_LIMIT) return new Response("Bad request", { status: 400 });
    const waves = parseGoAwayRequest(new TextDecoder().decode(body));
    if (!waves) return new Response("Bad request", { status: 400 });
    return Response.json(signal.goAway(waves));
  };
}

function parseGoAwayRequest(text: string): GoAwayRequest | null {
  try {
    const parsed = goAwayRequestSchema.safeParse(text.trim() === "" ? {} : JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
