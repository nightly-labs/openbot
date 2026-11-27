import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { GOOGLE_CLIENT_ID_PATTERN, GOOGLE_OAUTH_TOKEN_PATH } from "@openbot/contracts/signal-protocol/google-oauth";
import { sourceText } from "@openbot/i18n/source";
import type { GoogleSignIn, GoogleTokenBroker } from "../backend/google-mcp-sign-in";

const GOOGLE_CLIENT_ID = "377728991172-kkk4955ok8li6dbav7al3pdu3cs55nft.apps.googleusercontent.com";

export interface GoogleHost {
  available: () => boolean;
  ticket: (signal: AbortSignal) => Promise<{ ticket: string; signalUrl: string } | null>;
}

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

function googleTokenUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = GOOGLE_OAUTH_TOKEN_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
