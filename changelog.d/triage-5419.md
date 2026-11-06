### Fixed

- Sign in to MCP servers, such as ActiveCampaign, that let OpenBot ask only for the scope it
  registered. Before, the authorization page showed `invalid_scope` for `offline_access`, and the
  sign-in did not finish. OpenBot now registers `offline_access` with the other scopes, and registers
  again when an earlier registration does not have it.
