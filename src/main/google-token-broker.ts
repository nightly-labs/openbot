// The OpenBot Google sign-in app, and how this host sends its token requests to Signal.
//
// The client ID is public: a sign-in sends it to Google in the browser. The client secret is only in
// Signal (`GOOGLE_OAUTH_CLIENTS` in `remote/api`), so the code exchange and the refresh go there with
// this host's remote ticket. See `src/backend/google-mcp-sign-in.ts`.

import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { GOOGLE_CLIENT_ID_PATTERN, GOOGLE_OAUTH_TOKEN_PATH } from "@openbot/contracts/signal-protocol/google-oauth";
import { sourceText } from "@openbot/i18n/source";
import type { GoogleSignIn, GoogleTokenBroker } from "../backend/google-mcp-sign-in";

/**
 * The "OpenBot Desktop" client (Desktop app, marked for an AI-powered agent) of the Google Cloud
 * project `openbot-a3328`. Its secret is in Signal's `GOOGLE_OAUTH_CLIENTS`.
 */
const GOOGLE_CLIENT_ID = "1006722609038-u9dutshmpumvkl7tgipiv7gkvd2lnf7n.apps.googleusercontent.com";

/** How this host reaches Signal for a Google token request. */
export interface GoogleHost {
  /** Whether this host has an OpenBot account and a host ID, so it can get a ticket. */
  available: () => boolean;
  /** A new ticket of this host for Signal, and the Signal address. `null` when this host has none. */
  ticket: (signal: AbortSignal) => Promise<{ ticket: string; signalUrl: string } | null>;
}

/** The OpenBot Google sign-in, or null. `OPENBOT_GOOGLE_CLIENT_ID` overrides the client ID. */
export function googleSignIn(host: GoogleHost, env: NodeJS.ProcessEnv = process.env): GoogleSignIn | null {
  const clientId = env.OPENBOT_GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) return null;
  return { clientId, broker: googleTokenBroker(host), available: host.available };
}

function googleTokenBroker(host: GoogleHost): GoogleTokenBroker {
  return async (request, signal) => {
    const ticket = await host.ticket(signal).catch(() => null);
    signal.throwIfAborted();
    if (!ticket) throw new Error(sourceText("error.backend.googleSignInNeedsAccount"));
    const response = await fetch(googleTokenUrl(ticket.signalUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${ticket.ticket}`,
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal,
    });
    // Signal's own refusals (no secret configured, a bad ticket, the rate limit) are not OAuth errors,
    // and the SDK would show them with no text. Google's answers pass on as they are.
    if (!response.ok && (await isBrokerRefusal(response)))
      throw new Error(sourceText("error.backend.googleSignInUnavailable"));
    return response;
  };
}

async function isBrokerRefusal(response: Response): Promise<boolean> {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return isDynamicRecord(body) && body.error === "openbot_broker";
}

/** Signal's Google path on the origin of its socket: `wss:` becomes `https:`, and `ws:` (local) `http:`. */
function googleTokenUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = GOOGLE_OAUTH_TOKEN_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
