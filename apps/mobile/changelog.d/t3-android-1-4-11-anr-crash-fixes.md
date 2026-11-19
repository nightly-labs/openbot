### Fixed

- The Android app does not stop when a chat updates its message list. Before, a view that React
  Native made early could be removed twice.
- The Android app does not stop when Android starts it again while a sheet is open.
- The Android app does not stop when it closes before it is fully started.
- On Android 17 Pixel phones, the app does not freeze when a long chat opens. The app now turns off
  Content Capture, so the system does not read the text of each screen.
- The Android app does not freeze when a chat shows a large SVG image. The app now draws the SVG
  once in the background.
- The Android app does not freeze when it returns to the foreground on a slow phone. It no longer asks
  Google Play for the install referrer, which it did not send.
