### Fixed

- On Linux, OpenBot uses the GPU again when an earlier version turned it off by mistake after a
  reboot or a GPU reset. Before, OpenBot stayed slow and used much CPU, and on Wayland it also
  started on XWayland, until you deleted `~/.config/OpenBot/gpu-crash.json` by hand.
