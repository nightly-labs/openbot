### Added

- Connect to a joined server directly over Tailscale when both computers are in the same tailnet.
  The host owner turns on **Direct connection over Tailscale** in the server settings. Members use
  it with no setup, and the OpenBot cloud stays the fallback. The server menu shows which way the
  connection goes. The remote desktop still uses the OpenBot cloud connection.
- A member's OpenBot keeps the direct session, encrypted, between starts. The next start connects over
  Tailscale at once, with no new sign-in at the host and no request to the OpenBot cloud for it.
