### Fixed

- On Linux with GNOME, an OpenBot icon that you pinned from another launcher, such as one that
  AppImageLauncher made, now shows that OpenBot is open, and a click shows the open window. Before,
  OpenBot added its own second "OpenBot" launcher, the dock connected the window to that launcher,
  and a click on the pinned icon started OpenBot again with no effect. OpenBot now hides its own
  launcher when another launcher starts the same AppImage and you did not pin the OpenBot launcher.
  Links to OpenBot still open the app.
