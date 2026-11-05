### Fixed

- OpenBot uses less energy when it is open with no task. Before, the app woke the processor many
  times each second while it did nothing. The main process measured its own response time all the
  time, the Computer Use highlight checked the screen 30 times each second for the whole session,
  and the agent avatar and the sample turn of an empty chat kept moving when another app had the
  focus. These now rest until a window has the focus or an agent starts a turn.
