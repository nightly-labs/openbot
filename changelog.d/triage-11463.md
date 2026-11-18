### Fixed

- The app no longer freezes for seconds when a routine run ends in an agent chat with a long history.
  Before, the app read every message of the chat to find the answer of the run. Now it reads only the
  messages of that run.
