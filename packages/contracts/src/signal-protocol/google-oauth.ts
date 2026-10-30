// The Google token broker: how a host signs in to Google's MCP servers with the OpenBot Google
// sign-in app.
//
// Google's MCP servers (Gmail, Drive, Docs, Sheets, Slides, Calendar) do not let a client register
// itself, and Google's token endpoint wants the client secret of a sign-in app. Only Signal holds that secret.
// The host does the rest of the sign-in itself: it opens Google's page, receives the code on its
// loopback address, and keeps the tokens. It sends only the two token requests through Signal, with
// its remote host ticket as the bearer. Signal adds the secret, passes the request to Google, and
// returns Google's status and body. It stores nothing. The MCP traffic goes from the host to Google
// directly; Signal never sees it.

// The host posts JSON to this Signal path.
export const GOOGLE_OAUTH_TOKEN_PATH = "/v1/google/oauth/token";

// Google's token endpoint, as Google's authorization server metadata names it. The host sends only the
// requests to this address through Signal, and Signal sends them on to it.
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// The shape of a Google OAuth client ID. The host and Signal accept the same IDs.
export const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]{1,30}-[a-z0-9]{1,64}\.apps\.googleusercontent\.com$/u;

// The only address a code can come back to: the host's loopback listener (`mcp-oauth-redirect-server.ts`).
export const GOOGLE_OAUTH_REDIRECT_PATTERN = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/mcp-auth$/u;

export type GoogleOAuthTokenRequest =
  | {
      grant: "authorization_code";
      clientId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
      /** The RFC 8707 resource indicator, when the host's OAuth client sends one. */
      resource?: string;
    }
  | {
      grant: "refresh_token";
      clientId: string;
      refreshToken: string;
      resource?: string;
    };

// What Signal answers when it does not pass the request to Google. Google's own answers keep
// Google's status and body, so the host reads `invalid_grant` and the others as Google sent them.
export type GoogleOAuthBrokerErrorCode =
  | "unavailable"
  | "unauthorized"
  | "invalid_request"
  | "unknown_client"
  | "rate_limited"
  | "upstream_failed";

export interface GoogleOAuthBrokerErrorBody {
  error: "openbot_broker";
  code: GoogleOAuthBrokerErrorCode;
}
