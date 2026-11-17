### Fixed

- A Claude agent gets the tools of an MCP server that has no sign-in and no key again. Before, Claude
  could keep an old "requires authentication" mark for such a server, while the server test said
  that it was ready, and the agent did not get its tools.
- When an MCP server asks you to sign in on its web page during a request, the chat now shows a card
  with the address of the page and a Sign in link. Sign in on the page, then choose Continue: the
  agent tries the request again. Before, OpenBot declined the request and told you to sign in under Marketplace,
  Apps, where such a server has no sign-in. Only https pages get a link. For an agent on a joined
  server, the server must also be on the new version.
