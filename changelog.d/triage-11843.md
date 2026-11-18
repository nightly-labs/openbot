### Fixed

- Queued messages to ChatGPT agents start by themselves after ChatGPT restarts or reconnects. Before,
  a message that started while ChatGPT stopped failed with "ChatGPT did not answer in time" or
  "Codex App Server is not running". Now it waits and tries again up to 3 times. When it still
  cannot start, the message says that ChatGPT stopped and that you can send it again.
