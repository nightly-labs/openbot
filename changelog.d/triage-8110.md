### Fixed

- On Linux with Wayland, the OpenBot window now opens when OpenBot draws without the GPU, for example
  after an earlier start did not finish. Before, no window opened: KDE showed only a very small entry
  in the taskbar, and starting OpenBot again did not help. OpenBot now opens its window through
  XWayland in this case.
