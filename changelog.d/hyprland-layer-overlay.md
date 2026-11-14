### Fixed

- On Hyprland, the Dynamic Island and the agent dock now show above every app and panel and on every
  workspace, as on the other platforms. Before, Hyprland showed them as ordinary windows: under other
  apps, on one workspace, and with a black area around the island. Where Quickshell is installed,
  OpenBot shows them as Wayland layers, with no restart on XWayland. Set `OPENBOT_LAYER_OVERLAY=0`
  to keep the windows.
