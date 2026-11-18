### Fixed

- When ChatGPT (Codex) cannot connect to its service at start, for example before the network is
  ready, OpenBot now says so in plain words and starts ChatGPT again by itself after a few seconds.
  Before, the app showed only "workspace routing discovery failed", and ChatGPT stayed off until a
  new message or a refresh started it. A joined server must also be on this version.
