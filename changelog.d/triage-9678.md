### Fixed

- On a Linux Wayland desktop, Computer Use can now read the window of an app that runs natively on Wayland, for
  example a browser. Before, the agent stopped with "No windows found for pid … Provide window_id", although the
  window was open. OpenBot now ships version 0.43.2 of the Computer Use driver. A joined server must also be on
  the new version.
