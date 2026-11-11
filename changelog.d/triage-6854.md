### Fixed

- Sign in to an MCP server whose sign-in server gives plain OAuth information at its OpenID address,
  such as the TikTok organic connector. Before, the sign-in stopped before the login page opened, and
  the server card showed `invalid_type` errors for `jwks_uri` and two other fields.
