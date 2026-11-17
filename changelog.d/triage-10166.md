### Fixed

- When the model provider of an OpenCode agent refuses a request, and OpenCode has a key for that
  provider, the chat now says that the provider refused the request. It also says that a VPN, a
  proxy or a blocked country can be the cause, and what to do. Before, the chat said "OpenCode has no
  sign-in for the model provider", also when the key was saved and correct, for example when the
  provider's firewall blocked a VPN address. For an agent on a joined server, the server must also be
  on the new version.
