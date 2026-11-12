### Fixed

- Connect the TradingView app, and other MCP servers whose firewall blocks sign-in pages that name
  `127.0.0.1` or `localhost`. When the browser does not come back on either address, try the sign-in
  again: OpenBot then returns through the `openbot://` link, and the browser can ask to open OpenBot.
  Before, every attempt opened a blocked page.
