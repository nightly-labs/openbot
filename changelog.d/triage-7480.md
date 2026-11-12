### Fixed

- Sign in to the Alibaba Cloud (Aliyun) OpenAPI MCP server now works. Before, Aliyun showed
  `redirect_uri_mismatch` on its sign-in page, and the server stayed at "Sign-in needed" after each
  try. OpenBot now registers the callback address `http://127.0.0.1:<port>/callback`, which most MCP
  clients use. A sign-in app keeps its callback URL. For a joined server, the server must also be on
  this version. If the desktop app is older than the server, the app asks you to paste the browser
  address after the sign-in.
