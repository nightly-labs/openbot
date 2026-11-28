### Fixed

- With a VPN or Tailscale on, the iPhone app now checks the connection about 1 second after the phone moves between Wi-Fi and mobile data, and reconnects when the old path stopped. Before, the app did not see the move, and a server could show as disconnected for many seconds (#17876).
