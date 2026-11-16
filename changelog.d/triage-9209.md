### Fixed

- Connect the TradingView app for an agent on a joined server from the desktop app. TradingView's
  firewall blocks its sign-in page when the page returns to `127.0.0.1` or `localhost`, so each
  Connect showed "403 ERROR. Request blocked.". When the browser does not come back on either
  address, click Connect again: the page now returns through the `openbot://` link, and the browser
  can ask to open OpenBot. The server must also be on this version. The web client and the phone
  still use the two loopback addresses.
