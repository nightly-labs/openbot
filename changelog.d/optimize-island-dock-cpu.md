### Fixed

- The Dynamic Island and the agent dock no longer animate a working agent while you use other apps.
  Their loops made macOS draw the screen again on each frame, so other apps could stutter while an
  agent worked. Motion starts again when you move the pointer over the island or the dock, or open a
  chat from the dock.
