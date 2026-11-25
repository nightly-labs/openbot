### Fixed

- The Android app does not stop when it starts. Before, two threads of React Native could make the
  main thread handler at the same time.
- The Android app does not stop when a screen changes after you go back from it. Before, the views
  that the closing screen removed kept their parent, and React Native could not add them again.
- The Android app does not stop when Android closes it while it removes a screen.
