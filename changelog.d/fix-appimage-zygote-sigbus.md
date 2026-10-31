### Fixed

- On Linux, restarting the OpenBot AppImage to install an update no longer shows a crash report for `openbot --type=zygote`. Before, a helper process that still ran after the restart stopped with `SIGBUS`.
