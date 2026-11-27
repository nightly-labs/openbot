import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { GOOGLE_TOKEN_ENDPOINT, type GoogleOAuthTokenRequest } from "@openbot/contracts/signal-protocol/google-oauth";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/";

function scopes(...names: string[]): string {
  return names.map((name) => `${GOOGLE_SCOPE}${name}`).join(" ");
}

export const GOOGLE_MCP_SCOPES: Readonly<Record<string, string>> = {
  "https://gmailmcp.googleapis.com/mcp/v1": scopes("gmail.readonly", "gmail.compose", "gmail.modify"),
  "https://drivemcp.googleapis.com/mcp/v1": scopes("drive.readonly", "drive.file"),
  "https://docsmcp.googleapis.com/mcp/v1": scopes("drive.readonly", "drive.file", "documents.readonly", "documents"),
  "https://sheetsmcp.googleapis.com/mcp/v1": scopes(
    "drive.readonly",
    "drive.file",
    "spreadsheets.readonly",
    "spreadsheets",
  ),
  "https://slidesmcp.googleapis.com/mcp/v1": scopes(
    "drive.readonly",
    "drive.file",
    "presentations.readonly",
    "presentations",
  ),
  "https://calendarmcp.googleapis.com/mcp/v1": scopes(
    "calendar.calendarlist.readonly",
    "calendar.events.freebusy",
    "calendar.events.readonly",
    "calendar.events",
  ),
};

export type GoogleTokenBroker = (request: GoogleOAuthTokenRequest, signal: AbortSignal) => Promise<Response>;

export interface GoogleSignIn {
  clientId: string;
  broker: GoogleTokenBroker;
  available: () => boolean;
}

export function isGoogleSignInApp(resource: string, app: { clientSecret?: string | undefined }): boolean {
  return Object.hasOwn(GOOGLE_MCP_SCOPES, resource) && app.clientSecret === undefined;
}

export function withGoogleTokenBroker(fetch: FetchLike, google: GoogleSignIn, signal: AbortSignal): FetchLike {
  return async (input, init) => {
    const url = input instanceof URL ? input.href : String(input);
    if (init?.method !== "POST" || url !== GOOGLE_TOKEN_ENDPOINT || !(init.body instanceof URLSearchParams))
      return fetch(input, init);
    const form = init.body;
    if (form.get("client_id") !== google.clientId) return fetch(input, init);
    const request = tokenRequest(form, google.clientId);
    if (!request) return fetch(input, init);
    return google.broker(request, init.signal ?? signal);
  };
}

function tokenRequest(form: URLSearchParams, clientId: string): GoogleOAuthTokenRequest | null {
  const resource = form.get("resource");
  const optional = resource ? { resource } : {};
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = form.get("code");
    const codeVerifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !codeVerifier || !redirectUri) return null;
    return { grant, clientId, code, codeVerifier, redirectUri, ...optional };
  }
  if (grant === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return null;
    return { grant, clientId, refreshToken, ...optional };
  }
  return null;
}
