import { Effect, Result } from "effect";
import { type SmtpConnector, sendRelayedEmail } from "./smtp-email-delivery";

/**
 * The fetch handler of the `openbot-email-relay` Worker. It answers 204 when the mail host took the
 * message, and 502 with the failure message otherwise. `sendThroughRelay` reads that answer.
 */
export function createEmailRelayHandler(connector?: SmtpConnector) {
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const result = await Effect.runPromise(Effect.result(sendRelayedEmail(request, connector)), {
        signal: request.signal,
      });
      if (Result.isSuccess(result)) return new Response(null, { status: 204 });
      return Response.json({ error: result.failure.message }, { status: 502 });
    },
  };
}
