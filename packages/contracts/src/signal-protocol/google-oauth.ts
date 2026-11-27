export const GOOGLE_OAUTH_TOKEN_PATH = "/v1/google/oauth/token";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]{1,30}-[a-z0-9]{1,64}\.apps\.googleusercontent\.com$/u;

export const GOOGLE_OAUTH_REDIRECT_PATTERN = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/mcp-auth$/u;

export type GoogleOAuthTokenRequest =
  | {
      grant: "authorization_code";
      clientId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
      resource?: string;
    }
  | {
      grant: "refresh_token";
      clientId: string;
      refreshToken: string;
      resource?: string;
    };

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
