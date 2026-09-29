### Fixed

- When an OpenCode model request fails, the error tells why: a rate limit, a billing problem with
  the provider account, a failure on the provider's side, or no network connection. Each error
  tells you what to do, and whether waiting helps. Before, every cause showed as
  "Internal error:" followed by the provider's text (#1163).
