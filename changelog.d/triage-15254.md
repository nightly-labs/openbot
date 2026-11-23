### Fixed

- When you edit a custom endpoint that runs on Pi while Pi does a task, a message to an agent on that
  endpoint now waits until Pi loads the new endpoint settings, and then runs. Before, the agent said
  "The endpoint this agent used was removed" and the chat changed to a different model. The server must
  also be on the new version.
