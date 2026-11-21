### Changed

- A Linux server no longer draws the desktop UI into its hidden main window. The owner drives it from
  the mobile app or `openbot.run/app`, so the renderer was work that nobody saw: about 350 MB of
  memory and 11% of one CPU on a small host.
