### Fixed

- On Hyprland, the Dynamic Island and the agent dock show above every app and panel, on every
  workspace, and take the pointer and the keys. Before, Hyprland treated them as ordinary windows:
  under other apps, on one workspace, and black around the island. Where Quickshell is installed,
  OpenBot now renders them offscreen and shows them as Wayland layers. The island also opens for a
  moment when an agent starts a task or needs you. Set `OPENBOT_LAYER_OVERLAY=0` to keep the windows.
