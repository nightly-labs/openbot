### Fixed

- On a Linux Wayland desktop, an agent that used Computer Use no longer leaves a blank OpenBot window
  of the full screen size in the dock. Before, you could not close this window: it came back at once.
  On Wayland, OpenBot no longer draws the frame around the window that the agent works in, or its own
  agent pointer, because Wayland does not let OpenBot place them there. When the agent dock or the
  Dynamic Island shows above other apps, OpenBot still draws them.
