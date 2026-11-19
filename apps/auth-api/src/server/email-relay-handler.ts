import { Effect, Result } from "effect";
import { type SmtpConnector, sendRelayedEmail } from "./smtp-email-delivery";

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
