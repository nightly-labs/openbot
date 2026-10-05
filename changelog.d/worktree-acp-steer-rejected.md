### Fixed

- A steered message to a custom ACP agent that accepts one prompt at a time is not lost. Before, the
  agent refused it with "A prompt is already running for this session", OpenBot showed a provider
  error, and the message was not sent. Now OpenBot sends the message when the running reply ends.
