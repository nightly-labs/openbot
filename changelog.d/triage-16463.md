### Fixed

- On Hyprland, the Dynamic Island and the agent dock "Above other apps" now show on each workspace, without blur or shadow. Before, they showed only on the workspace where they opened, and Hyprland blurred the area around them, unless you added a window rule.
- On Wayland, when the launcher starts OpenBot with `--ozone-platform=wayland` and XWayland is available, Settings now shows the Restart button for the Dynamic Island and the agent dock. Before, it said "On Wayland without XWayland…", which was not true, and you had to change the launcher. After Restart, OpenBot starts on XWayland while the island is on or the dock is "Above other apps".
