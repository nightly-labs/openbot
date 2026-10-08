### Added

- Set up the direct Tailscale connection of a server with no screen from OpenBot on another
  computer. The server owner sees five steps in the server settings, and each step checks itself:
  Tailscale on this computer, Tailscale on the server, the same tailnet, HTTPS certificates and the
  direct connection switch. A self-hosted server installs Tailscale with
  `sudo openbot tailscale setup`. A member in another tailnet gets a link that explains node sharing.
