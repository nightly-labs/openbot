### Fixed

- Sign in and connect to teams on a company network that inspects TLS, such as Fortinet. OpenBot
  now trusts the root certificates of the operating system, as a browser does.
- Show which host a company firewall or proxy blocked when sign-in cannot reach the account service.
  Before, OpenBot asked you to check that the API was running, and a proxy's block page could sign
  you out.
