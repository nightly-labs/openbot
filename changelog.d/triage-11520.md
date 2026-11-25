### Fixed

- When the Pi that OpenBot downloaded does not start, OpenRouter, DeepSeek, Inception and Pi now say
  what to do in the app, not only "The Pi CLI could not start". A Pi that you installed yourself gets
  its own message. The provider log now keeps why the program did not start.
- OpenBot now checks at start that its Pi starts also when only OpenRouter, DeepSeek or Inception
  uses it. A Pi that does not start is no longer shown as ready: OpenBot downloads it again, or, while
  Pi is off, Connect tells you to turn Pi on first. For an agent on a joined server, the server must
  also be on the new version.
